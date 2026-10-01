"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import {
  ArrowDown,
  ArrowUp,
  EyeOff,
  Loader2,
  MapPin,
  MessageCircle,
  Send
} from "lucide-react";
import {
  createConferenceReplyAction,
  deleteConferenceContentAction,
  hideConferenceVoiceAction,
  reportConferenceAction,
  voteConferenceAction
} from "@/app/(app)/conference-actions";
import { ConferenceLocationSync } from "@/components/conference/conference-location-sync";
import {
  ConferenceActionMenu,
  ConferenceDeleteMenuItem
} from "@/components/conference/conference-action-menu";
import { PageHeader } from "@/components/app-shell/page-header";
import { detectLocationRisk } from "@/lib/content/safety";
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
  onStale
}: {
  targetType: "topic" | "reply";
  targetId: string;
  initialVote: ConferenceVote | null;
  initialHypeCount: number;
  initialPassCount: number;
  onError: (value: string) => void;
  onStale: () => void;
}) {
  const [vote, setVote] = useState(initialVote);
  const [hypeCount, setHypeCount] = useState(initialHypeCount);
  const [passCount, setPassCount] = useState(initialPassCount);
  const [pending, startMutation] = useTransition();

  function react(selected: ConferenceVote) {
    const previous = { vote, hypeCount, passCount };
    const next = nextVoteState(vote, selected, hypeCount, passCount);
    setVote(next.vote);
    setHypeCount(next.hypeCount);
    setPassCount(next.passCount);

    startMutation(async () => {
      const result = await voteConferenceAction(targetType, targetId, selected);
      if (!result.ok) {
        if (result.stale) {
          onStale();
          return;
        }
        setVote(previous.vote);
        setHypeCount(previous.hypeCount);
        setPassCount(previous.passCount);
        onError(result.message);
      }
    });
  }

  return (
    <>
      <button
        type="button"
        disabled={pending}
        aria-pressed={vote === "hype"}
        onClick={() => react("hype")}
        className={cn(
          "focus-ring inline-flex h-8 items-center gap-1 rounded-full px-2.5 text-xs font-semibold transition-colors",
          vote === "hype" ? "bg-primary/12 text-primary" : "bg-secondary/55 text-muted-foreground"
        )}
      >
        <ArrowUp className="h-3.5 w-3.5" />
        Hype {hypeCount}
      </button>
      <button
        type="button"
        disabled={pending}
        aria-pressed={vote === "pass"}
        onClick={() => react("pass")}
        className={cn(
          "focus-ring inline-flex h-8 items-center gap-1 rounded-full px-2.5 text-xs font-semibold transition-colors",
          vote === "pass" ? "bg-primary/12 text-primary" : "bg-secondary/55 text-muted-foreground"
        )}
      >
        <ArrowDown className="h-3.5 w-3.5" />
        Pass {passCount}
      </button>
    </>
  );
}

function ReplyCard({
  reply,
  topicId,
  onRemove,
  onRestore,
  onError
}: {
  reply: ConferenceReply;
  topicId: string;
  onRemove: (id: string) => void;
  onRestore: (reply: ConferenceReply) => void;
  onError: (message: string) => void;
}) {
  const [, startMutation] = useTransition();
  const optimistic = reply.id.startsWith("optimistic-");

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
          <p className="mt-2 whitespace-pre-wrap text-sm leading-[1.45] text-foreground">{reply.body}</p>
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

      {!reply.isYours && !optimistic ? (
        <div className="mt-2.5 flex items-center gap-1.5">
          <ReactionPair
            targetType="reply"
            targetId={reply.id}
            initialVote={reply.yourVote}
            initialHypeCount={reply.hypeCount}
            initialPassCount={reply.passCount}
            onError={onError}
            onStale={() => window.location.assign("/conference?notice=unavailable")}
          />
        </div>
      ) : reply.isYours ? (
        <div className="mt-2">
          <span className="inline-flex h-7 items-center rounded-full bg-secondary/55 px-2 text-[11px] font-semibold text-muted-foreground">Your Voice</span>
        </div>
      ) : null}
    </article>
  );
}

export function ConferenceTopicPage({ topic }: { topic: ConferenceTopicDetail }) {
  const router = useRouter();
  const [replies, setReplies] = useState(topic.replies);
  const [replyCount, setReplyCount] = useState(topic.replyCount);
  const [body, setBody] = useState("");
  const [feedback, setFeedback] = useState("");
  const [sending, startSending] = useTransition();
  const [, startTopicMutation] = useTransition();
  const locationRisk = detectLocationRisk(body);

  useEffect(() => {
    if (!feedback) return;
    const timer = window.setTimeout(() => setFeedback(""), 2800);
    return () => window.clearTimeout(timer);
  }, [feedback]);

  function removeReply(id: string) {
    setReplies((current) => current.filter((item) => item.id !== id));
    setReplyCount((count) => Math.max(0, count - 1));
  }

  function restoreReply(reply: ConferenceReply) {
    setReplies((current) => (current.some((item) => item.id === reply.id) ? current : [...current, reply]));
    setReplyCount((count) => count + 1);
  }

  function sendVoice() {
    const text = body.trim();
    if (!text || sending) return;

    const tempId = `optimistic-${Date.now()}`;
    const optimistic: ConferenceReply = {
      id: tempId,
      voiceLabel: "You",
      body: text,
      createdAt: new Date().toISOString(),
      hypeCount: 0,
      passCount: 0,
      yourVote: null,
      isYours: true
    };

    setBody("");
    setReplies((current) => [...current, optimistic]);
    setReplyCount((count) => count + 1);

    window.requestAnimationFrame(() => {
      document.getElementById(tempId)?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    });

    startSending(async () => {
      const result = await createConferenceReplyAction(topic.id, text);
      if (!result.ok || !result.replyId) {
        removeReply(tempId);
        if (result.stale) {
          router.replace("/conference?notice=unavailable");
          return;
        }
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
              <span className="font-semibold text-foreground">{topic.isYours ? "You" : topic.voiceLabel}</span>
              <span>·</span>
              <span>{timeAgo(topic.createdAt)}</span>
            </div>
            <p className="mt-2 whitespace-pre-wrap text-[15px] leading-[1.5] text-foreground">{topic.body}</p>
          </div>

          <ConferenceActionMenu label="Topic actions">
            {(close) =>
              topic.isYours ? (
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
                    Hide this Voice
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
          {!topic.isYours ? (
            <>
              <ReactionPair
                targetType="topic"
                targetId={topic.id}
                initialVote={topic.yourVote}
                initialHypeCount={topic.hypeCount}
                initialPassCount={topic.passCount}
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

      <section className="space-y-2">
        {replies.length ? (
          replies.map((reply) => (
            <ReplyCard
              key={reply.id}
              reply={reply}
              topicId={topic.id}
              onRemove={removeReply}
              onRestore={restoreReply}
              onError={setFeedback}
            />
          ))
        ) : (
          <div className="rounded-[16px] border border-dashed border-border px-4 py-5 text-center text-sm text-muted-foreground">
            No Voices yet.
          </div>
        )}
      </section>

      <section className="sticky bottom-[calc(var(--mobile-nav-height,0px)+env(safe-area-inset-bottom,0px)+0.35rem)] z-20 rounded-[16px] border border-border bg-card/95 p-2 shadow-lg backdrop-blur">
        <div className="flex items-end gap-2">
          <textarea
            rows={1}
            value={body}
            maxLength={300}
            onChange={(event) => setBody(event.target.value)}
            placeholder="Add your voice…"
            className="focus-ring max-h-28 min-h-11 flex-1 resize-none rounded-xl border border-border bg-background px-3 py-2.5 text-sm"
          />
          <button
            type="button"
            aria-label="Add Voice"
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
        <div className="mt-1 px-1 text-[11px] text-muted-foreground">{body.length}/300</div>
      </section>
    </div>
  );
}
