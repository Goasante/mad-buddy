"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import {
  ArrowDown,
  ArrowUp,
  EyeOff,
  Loader2,
  MapPin,
  MessageCircle,
  Send,
  CornerUpLeft
} from "lucide-react";
import {
  createConferenceReplyAction,
  deleteConferenceContentAction,
  hideConferenceVoiceAction,
  reportConferenceAction,
  voteConferenceAction
} from "@/app/(app)/conference-actions";
import { ConferenceLocationSync } from "@/components/conference/conference-location-sync";
import { useConferenceRealtime } from "@/hooks/use-conference-realtime";
import {
  ConferenceActionMenu,
  ConferenceDeleteMenuItem
} from "@/components/conference/conference-action-menu";
import { PageHeader } from "@/components/app-shell/page-header";
import { detectLocationRisk } from "@/lib/content/safety";
import { isConferenceVoiceCollapsed } from "@/lib/conference/ranking";
import type {
  ConferenceActionResult,
  ConferenceReply,
  ConferenceReportReason,
  ConferenceTopicDetail,
  ConferenceVote
} from "@/lib/conference/types";
import { cn } from "@/lib/utils";

const REPORT_REASONS: ReadonlyArray<[ConferenceReportReason, string]> = [
  ["harassment", "Harassment"],
  ["threat_or_violence", "Threat or violence"],
  ["sexual_content", "Sexual content"],
  ["hate_or_discrimination", "Hate or discrimination"],
  ["spam", "Spam"],
  ["scam", "Scam"],
  ["private_information", "Private information"],
  ["dangerous_location_sharing", "Dangerous location sharing"],
  ["other", "Other"]
];

function timeAgo(value: string) {
  const minutes = Math.max(0, Math.floor((Date.now() - Date.parse(value)) / 60_000));
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

function voiceCount(count: number) {
  return `${count} ${count === 1 ? "Voice" : "Voices"}`;
}

function mergeLiveReplies(current: ConferenceReply[], incoming: ConferenceReply[]) {
  const optimistic = current.filter((reply) => reply.id.startsWith("optimistic-"));
  if (!optimistic.length) return incoming;

  const canonical = incoming.filter(
    (reply) =>
      !optimistic.some(
        (draft) =>
          draft.body === reply.body &&
          (draft.replyTo?.id ?? null) === (reply.replyTo?.id ?? null) &&
          Math.abs(Date.parse(draft.createdAt) - Date.parse(reply.createdAt)) < 15_000
      )
  );
  return [...canonical, ...optimistic];
}

function nextVoteState(
  current: ConferenceVote | null,
  selected: ConferenceVote,
  hypeCount: number,
  passCount: number
) {
  if (current === selected) {
    return {
      vote: null,
      hypeCount: selected === "hype" ? Math.max(0, hypeCount - 1) : hypeCount,
      passCount: selected === "pass" ? Math.max(0, passCount - 1) : passCount
    };
  }

  return {
    vote: selected,
    hypeCount:
      hypeCount +
      (selected === "hype" ? 1 : 0) -
      (current === "hype" ? 1 : 0),
    passCount:
      passCount +
      (selected === "pass" ? 1 : 0) -
      (current === "pass" ? 1 : 0)
  };
}

function ReactionPair({
  targetType,
  targetId,
  initialVote,
  initialHypeCount,
  initialPassCount,
  onError,
  onStale,
  onVoteState
}: {
  targetType: "topic" | "reply";
  targetId: string;
  initialVote: ConferenceVote | null;
  initialHypeCount: number;
  initialPassCount: number;
  onError: (value: string) => void;
  onStale: () => void;
  onVoteState?: (state: {
    yourVote: ConferenceVote | null;
    hypeCount: number;
    passCount: number;
  }) => void;
}) {
  const [pending, startMutation] = useTransition();

  function react(selected: ConferenceVote) {
    const previous = {
      vote: initialVote,
      hypeCount: initialHypeCount,
      passCount: initialPassCount
    };
    const next = nextVoteState(
      initialVote,
      selected,
      initialHypeCount,
      initialPassCount
    );
    onVoteState?.({
      yourVote: next.vote,
      hypeCount: next.hypeCount,
      passCount: next.passCount
    });

    startMutation(async () => {
      const result = await voteConferenceAction(targetType, targetId, selected);
      if (!result.ok) {
        if (result.stale) {
          onStale();
          return;
        }
        onVoteState?.({
          yourVote: previous.vote,
          hypeCount: previous.hypeCount,
          passCount: previous.passCount
        });
        onError(result.message);
      }
    });
  }

  return (
    <>
      <button
        type="button"
        disabled={pending}
        aria-pressed={initialVote === "hype"}
        onClick={() => react("hype")}
        className={cn(
          "focus-ring inline-flex h-8 items-center gap-1 rounded-full px-2.5 text-xs font-semibold transition-colors",
          initialVote === "hype" ? "bg-primary/12 text-primary" : "bg-secondary/55 text-muted-foreground"
        )}
      >
        <ArrowUp className="h-3.5 w-3.5" />
        Hype {initialHypeCount}
      </button>
      <button
        type="button"
        disabled={pending}
        aria-pressed={initialVote === "pass"}
        onClick={() => react("pass")}
        className={cn(
          "focus-ring inline-flex h-8 items-center gap-1 rounded-full px-2.5 text-xs font-semibold transition-colors",
          initialVote === "pass" ? "bg-primary/12 text-primary" : "bg-secondary/55 text-muted-foreground"
        )}
      >
        <ArrowDown className="h-3.5 w-3.5" />
        Pass {initialPassCount}
      </button>
    </>
  );
}

function ReplyCard({
  reply,
  topicId,
  onRemove,
  onRestore,
  onReply,
  onVoteState,
  onError
}: {
  reply: ConferenceReply;
  topicId: string;
  onRemove: (id: string) => void;
  onRestore: (reply: ConferenceReply) => void;
  onReply: (reply: ConferenceReply) => void;
  onVoteState: (
    id: string,
    state: { yourVote: ConferenceVote | null; hypeCount: number; passCount: number }
  ) => void;
  onError: (message: string) => void;
}) {
  const [, startMutation] = useTransition();
  const optimistic = reply.id.startsWith("optimistic-");
  const [revealed, setRevealed] = useState(false);
  const communityCollapsed = !reply.isYours && isConferenceVoiceCollapsed(reply);

  function removeThen(task: () => Promise<ConferenceActionResult>) {
    onRemove(reply.id);
    startMutation(async () => {
      const result = await task();
      if (!result.ok && !result.stale) {
        onRestore(reply);
        onError(result.message);
      }
    });
  }

  return (
    <article id={reply.id} className="rounded-[16px] border border-border/65 bg-card/65 px-3 py-2.5">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-primary/10 font-semibold text-primary">V</span>
            <span className="font-semibold text-foreground">{reply.isYours ? "You" : reply.voiceLabel}</span>
            <span>·</span>
            <span>{timeAgo(reply.createdAt)}</span>
            {optimistic ? <span className="text-primary">Sending…</span> : null}
          </div>
          {communityCollapsed && !revealed ? (
            <button
              type="button"
              onClick={() => setRevealed(true)}
              className="focus-ring mt-2 w-full rounded-xl border border-dashed border-border/80 bg-secondary/30 px-3 py-2 text-left text-xs font-semibold text-muted-foreground transition-colors hover:text-foreground"
            >
              Voice hidden by community votes · Show Voice
            </button>
          ) : (
            <>
              {reply.replyTo ? (
                <div className="mt-2 rounded-xl border border-border/70 bg-secondary/35 px-2.5 py-2 text-xs text-muted-foreground">
                  <span className="font-semibold text-foreground">Replying to {reply.replyTo.voiceLabel}</span>
                  <p className="mt-0.5 truncate">{reply.replyTo.body}</p>
                </div>
              ) : null}
              <p className="mt-2 whitespace-pre-wrap text-sm leading-[1.45] text-foreground">{reply.body}</p>
            </>
          )}
        </div>

        {!optimistic ? (
          <ConferenceActionMenu label="Voice actions">
            {(close) =>
              reply.isYours ? (
                <ConferenceDeleteMenuItem
                  label="Delete Voice"
                  close={close}
                  onDelete={() => removeThen(() => deleteConferenceContentAction("reply", reply.id, topicId))}
                />
              ) : (
                <>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      close();
                      removeThen(() => hideConferenceVoiceAction("reply", reply.id, topicId));
                    }}
                    className="focus-ring flex min-h-10 w-full items-center gap-2 rounded-lg px-3 text-left text-sm hover:bg-secondary"
                  >
                    <EyeOff className="h-4 w-4" />
                    Hide this Voice
                  </button>
                  <div className="px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Flag Voice</div>
                  {REPORT_REASONS.map(([reason, label]) => (
                    <button
                      key={reason}
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        close();
                        removeThen(() => reportConferenceAction("reply", reply.id, reason, topicId));
                      }}
                      className="focus-ring block min-h-9 w-full rounded-lg px-3 text-left text-sm hover:bg-secondary"
                    >
                      {label}
                    </button>
                  ))}
                </>
              )
            }
          </ConferenceActionMenu>
        ) : null}
      </div>

      {!optimistic ? (
        <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
          {!reply.isYours ? (
            <ReactionPair
              targetType="reply"
              targetId={reply.id}
              initialVote={reply.yourVote}
              initialHypeCount={reply.hypeCount}
              initialPassCount={reply.passCount}
              onError={onError}
              onStale={() => window.location.assign("/conference?notice=unavailable")}
              onVoteState={(state) => onVoteState(reply.id, state)}
            />
          ) : (
            <span className="inline-flex h-8 items-center rounded-full bg-secondary/55 px-2.5 text-xs font-semibold text-muted-foreground">
              Your Voice
            </span>
          )}
          <button
            type="button"
            onClick={() => onReply(reply)}
            className="focus-ring inline-flex h-8 items-center gap-1 rounded-full bg-secondary/55 px-2.5 text-xs font-semibold text-muted-foreground transition-colors hover:text-foreground"
          >
            <CornerUpLeft className="h-3.5 w-3.5" aria-hidden="true" />
            Reply
          </button>
        </div>
      ) : null}
    </article>
  );
}

export function ConferenceTopicPage({ topic }: { topic: ConferenceTopicDetail }) {
  const router = useRouter();
  const [liveTopic, setLiveTopic] = useState(topic);
  const [replies, setReplies] = useState(topic.replies);
  const [body, setBody] = useState("");
  const [composerOpen, setComposerOpen] = useState(false);
  const [replyTarget, setReplyTarget] = useState<ConferenceReply | null>(null);
  const composerRef = useRef<HTMLDivElement | null>(null);
  const [feedback, setFeedback] = useState("");
  const [sending, startSending] = useTransition();
  const sendingRef = useRef(false);
  const liveRefreshRef = useRef(false);
  const [, startTopicMutation] = useTransition();
  const locationRisk = detectLocationRisk(body);
  const replyCount = replies.length;

  useEffect(() => {
    if (!feedback) return;
    const timer = window.setTimeout(() => setFeedback(""), 2800);
    return () => window.clearTimeout(timer);
  }, [feedback]);

  const refreshLiveTopic = useCallback(async () => {
    if (liveRefreshRef.current || document.visibilityState !== "visible") return;
    liveRefreshRef.current = true;
    try {
      const response = await fetch(
        `/api/conference/live?topicId=${encodeURIComponent(topic.id)}`,
        { credentials: "include", cache: "no-store" }
      );
      if (response.status === 404) {
        router.replace("/conference?notice=unavailable");
        return;
      }
      if (!response.ok) return;
      const payload = (await response.json().catch(() => null)) as
        | { topic?: ConferenceTopicDetail }
        | null;
      if (!payload?.topic) return;
      setLiveTopic(payload.topic);
      setReplies((current) => mergeLiveReplies(current, payload.topic!.replies));
    } finally {
      liveRefreshRef.current = false;
    }
  }, [router, topic.id]);

  useConferenceRealtime({
    topicId: topic.id,
    onRefresh: refreshLiveTopic
  });

  function removeReply(id: string) {
    setReplies((current) => current.filter((item) => item.id !== id));
  }

  function restoreReply(reply: ConferenceReply) {
    setReplies((current) => (current.some((item) => item.id === reply.id) ? current : [...current, reply]));
  }

  function updateReplyVote(
    id: string,
    state: { yourVote: ConferenceVote | null; hypeCount: number; passCount: number }
  ) {
    setReplies((current) =>
      current.map((reply) => (reply.id === id ? { ...reply, ...state } : reply))
    );
  }

  function openComposer(target: ConferenceReply | null = null) {
    setReplyTarget(target);
    setComposerOpen(true);
    window.requestAnimationFrame(() => {
      composerRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    });
  }

  function sendVoice() {
    const text = body.trim();
    if (!text || sendingRef.current) return;
    sendingRef.current = true;

    const tempId = `optimistic-${Date.now()}`;
    const target = replyTarget;
    const optimistic: ConferenceReply = {
      id: tempId,
      voiceLabel: "You",
      body: text,
      createdAt: new Date().toISOString(),
      hypeCount: 0,
      passCount: 0,
      yourVote: null,
      isYours: true,
      replyTo: target
        ? {
            id: target.id,
            voiceLabel: target.isYours ? "You" : target.voiceLabel,
            body: target.body
          }
        : null
    };

    setBody("");
    setReplyTarget(null);
    setComposerOpen(false);
    setReplies((current) => [...current, optimistic]);

    window.requestAnimationFrame(() => {
      document.getElementById(tempId)?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    });

    startSending(async () => {
      try {
        const result = await createConferenceReplyAction(topic.id, text, target?.id ?? null);
        if (!result.ok || !result.replyId) {
          removeReply(tempId);
          if (result.stale) {
            router.replace("/conference?notice=unavailable");
            return;
          }
          // Never throw away somebody's words because the network or server
          // rejected a send. Put the draft back exactly as they wrote it and
          // reopen the inline composer for one-tap retry.
          setBody(text);
          setReplyTarget(target);
          setComposerOpen(true);
          setFeedback(result.message);
          return;
        }

        setReplies((current) =>
          current.map((item) =>
            item.id === tempId
              ? { ...item, id: result.replyId!, createdAt: result.createdAt ?? item.createdAt }
              : item
          )
        );
      } finally {
        sendingRef.current = false;
      }
    });
  }

  function leaveTopicThen(task: () => Promise<ConferenceActionResult>) {
    router.push("/conference");
    startTopicMutation(async () => {
      const result = await task();
      if (!result.ok && !result.stale) {
        router.replace("/conference?notice=action-failed");
      }
    });
  }

  return (
    <div className="mx-auto w-full max-w-[640px] space-y-3 pb-6 md:pt-4">
      <ConferenceLocationSync />
      <PageHeader title="Conference" backHref="/conference" />

      <div className="inline-flex h-8 items-center gap-1.5 rounded-full bg-primary/10 px-3 text-xs font-semibold text-primary">
        <MapPin className="h-3.5 w-3.5" />
        Around You · 15 km
      </div>

      {feedback ? (
        <p role="status" className="rounded-xl bg-secondary/65 px-3 py-2 text-sm text-muted-foreground">
          {feedback}
        </p>
      ) : null}

      <article className="rounded-[18px] border border-border bg-card/80 px-3.5 py-3 shadow-sm">
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-primary/10 font-semibold text-primary">V</span>
              <span className="font-semibold text-foreground">{liveTopic.isYours ? "You" : liveTopic.voiceLabel}</span>
              <span>·</span>
              <span>{timeAgo(liveTopic.createdAt)}</span>
            </div>
            <p className="mt-2 whitespace-pre-wrap text-[15px] leading-[1.5] text-foreground">{liveTopic.body}</p>
          </div>

          <ConferenceActionMenu label="Topic actions">
            {(close) =>
              liveTopic.isYours ? (
                <ConferenceDeleteMenuItem
                  label="Delete Topic"
                  close={close}
                  onDelete={() => leaveTopicThen(() => deleteConferenceContentAction("topic", topic.id, topic.id))}
                />
              ) : (
                <>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      close();
                      leaveTopicThen(() => hideConferenceVoiceAction("topic", topic.id, topic.id));
                    }}
                    className="focus-ring flex min-h-10 w-full items-center gap-2 rounded-lg px-3 text-left text-sm hover:bg-secondary"
                  >
                    <EyeOff className="h-4 w-4" />
                    Hide this Topic
                  </button>
                  <div className="px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Flag Topic</div>
                  {REPORT_REASONS.map(([reason, label]) => (
                    <button
                      key={reason}
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        close();
                        leaveTopicThen(() => reportConferenceAction("topic", topic.id, reason, topic.id));
                      }}
                      className="focus-ring block min-h-9 w-full rounded-lg px-3 text-left text-sm hover:bg-secondary"
                    >
                      {label}
                    </button>
                  ))}
                </>
              )
            }
          </ConferenceActionMenu>
        </div>

        <div className="mt-3 flex items-center gap-1.5">
          {!liveTopic.isYours ? (
            <>
              <ReactionPair
                targetType="topic"
                targetId={topic.id}
                initialVote={liveTopic.yourVote}
                initialHypeCount={liveTopic.hypeCount}
                initialPassCount={liveTopic.passCount}
                onVoteState={(state) =>
                  setLiveTopic((current) => ({ ...current, ...state }))
                }
                onError={setFeedback}
                onStale={() => router.replace("/conference?notice=unavailable")}
              />
            </>
          ) : (
            <span className="inline-flex h-8 items-center rounded-full bg-secondary/55 px-2.5 text-xs font-semibold text-muted-foreground">Your Topic</span>
          )}
          <span className="inline-flex h-8 items-center gap-1 rounded-full bg-secondary/55 px-2.5 text-xs font-semibold text-muted-foreground">
            <MessageCircle className="h-3.5 w-3.5" />
            {voiceCount(replyCount)}
          </span>
        </div>
      </article>

      <section aria-label="Add your Voice">
        {composerOpen ? (
          <div
            id="conference-voice-composer"
            ref={composerRef}
            className="rounded-[18px] border border-border bg-card/80 p-3.5 shadow-sm"
          >
            <div className="mb-2 flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-semibold">
                  {replyTarget ? `Reply to ${replyTarget.isYours ? "your Voice" : replyTarget.voiceLabel}` : "Add your Voice"}
                </p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Anonymous to other members in this Topic. Replies stay in one flat Voice stream.
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  if (sending) return;
                  setComposerOpen(false);
                  setReplyTarget(null);
                }}
                className="focus-ring min-h-9 rounded-full px-3 text-xs font-semibold text-muted-foreground hover:bg-secondary"
              >
                Close
              </button>
            </div>
            {replyTarget ? (
              <div className="mb-2 rounded-xl border border-border/70 bg-secondary/35 px-2.5 py-2 text-xs text-muted-foreground">
                <span className="font-semibold text-foreground">
                  Replying to {replyTarget.isYours ? "your Voice" : replyTarget.voiceLabel}
                </span>
                <p className="mt-0.5 truncate">{replyTarget.body}</p>
              </div>
            ) : null}
            <div className="flex items-end gap-2">
              <textarea
                autoFocus
                rows={3}
                value={body}
                maxLength={300}
                onChange={(event) => setBody(event.target.value)}
                placeholder="Add your voice…"
                className="focus-ring max-h-36 min-h-24 flex-1 resize-none rounded-xl border border-border bg-background px-3 py-2.5 text-sm"
              />
              <button
                type="button"
                aria-label="Post Voice"
                disabled={sending || body.trim().length === 0}
                onClick={sendVoice}
                className="focus-ring grid h-11 w-11 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground disabled:opacity-45"
              >
                {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              </button>
            </div>
            {locationRisk.warn ? (
              <p className="mt-2 rounded-lg bg-amber-500/10 px-2.5 py-2 text-xs text-foreground">
                This may reveal an exact location. Conference is visible to nearby members.
              </p>
            ) : null}
            <div className="mt-1 flex items-center justify-between gap-3 px-1 text-[11px] text-muted-foreground">
              <span>Your anonymous Voice stays consistent inside this Topic.</span>
              <span className="shrink-0">{body.length}/300</span>
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => openComposer(null)}
            className="focus-ring flex min-h-12 w-full items-center justify-center gap-2 rounded-[16px] border border-border bg-card/75 px-4 text-sm font-semibold shadow-sm transition-colors hover:bg-secondary/45"
          >
            <MessageCircle className="h-4 w-4 text-primary" aria-hidden="true" />
            Add your Voice
          </button>
        )}
      </section>

      <section className="space-y-2" aria-label="Voices">
        <div className="flex items-center justify-between gap-3 px-1">
          <h2 className="text-sm font-semibold">Voices</h2>
          <span className="text-xs text-muted-foreground">{voiceCount(replyCount)}</span>
        </div>
        {replies.length ? (
          replies.map((reply) => (
            <ReplyCard
              key={reply.id}
              reply={reply}
              topicId={topic.id}
              onRemove={removeReply}
              onRestore={restoreReply}
              onReply={(target) => openComposer(target)}
              onVoteState={updateReplyVote}
              onError={setFeedback}
            />
          ))
        ) : (
          <div className="rounded-[16px] border border-dashed border-border px-4 py-5 text-center text-sm text-muted-foreground">
            No Voices yet. Be the first to join the Topic.
          </div>
        )}
      </section>
    </div>
  );
}
