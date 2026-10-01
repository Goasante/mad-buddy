"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { ArrowDown, ArrowLeft, ArrowUp, EyeOff, Flag, Loader2, MapPin, Send } from "lucide-react";
import {
  createConferenceReplyAction,
  hideConferenceVoiceAction,
  reportConferenceAction,
  voteConferenceAction
} from "@/app/(app)/conference-actions";
import { ConferenceLocationSync } from "@/components/conference/conference-location-sync";
import { detectLocationRisk, LOCATION_WARNING_MESSAGE } from "@/lib/content/safety";
import type { ConferenceReply, ConferenceTopicDetail, ConferenceVote } from "@/lib/conference/types";
import { cn } from "@/lib/utils";

function timeAgo(value: string) {
  const minutes = Math.max(0, Math.floor((Date.now() - Date.parse(value)) / 60_000));
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

function ReactionButton({
  targetType,
  targetId,
  topicId,
  selected,
  vote,
  count,
  onFeedback
}: {
  targetType: "topic" | "reply";
  targetId: string;
  topicId: string;
  selected: boolean;
  vote: ConferenceVote;
  count: number;
  onFeedback: (value: string) => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const Icon = vote === "hype" ? ArrowUp : ArrowDown;
  return (
    <button
      type="button"
      disabled={pending}
      aria-pressed={selected}
      onClick={() =>
        startTransition(async () => {
          const result = await voteConferenceAction(targetType, targetId, vote, topicId);
          onFeedback(result.message);
          if (result.ok) router.refresh();
        })
      }
      className={cn(
        "focus-ring inline-flex min-h-9 items-center gap-1.5 rounded-full px-2.5 text-xs font-semibold",
        selected ? "bg-primary/12 text-primary" : "bg-secondary/60 text-muted-foreground"
      )}
    >
      {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Icon className="h-3.5 w-3.5" />}
      {vote === "hype" ? "Hype" : "Pass"} {count}
    </button>
  );
}

function Actions({
  targetType,
  targetId,
  topicId,
  onFeedback
}: {
  targetType: "topic" | "reply";
  targetId: string;
  topicId: string;
  onFeedback: (value: string) => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <details className="relative">
      <summary className="focus-ring flex min-h-9 cursor-pointer list-none items-center gap-1.5 rounded-full px-2 text-xs text-muted-foreground hover:bg-secondary/60">
        <Flag className="h-3.5 w-3.5" /> Actions
      </summary>
      <div className="absolute right-0 z-20 mt-1 w-48 rounded-xl border border-border bg-card p-1.5 shadow-lg">
        {[
          ["harassment", "Flag harassment"],
          ["threat_or_violence", "Flag threat or violence"],
          ["sexual_content", "Flag sexual content"],
          ["hate_or_discrimination", "Flag hate or discrimination"],
          ["spam", "Flag spam"],
          ["scam", "Flag scam"],
          ["private_information", "Flag private information"],
          ["dangerous_location_sharing", "Flag dangerous location sharing"],
          ["other", "Flag other"]
        ].map(([reason, label]) => (
          <button
            key={reason}
            type="button"
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                const result = await reportConferenceAction(targetType, targetId, reason, topicId);
                onFeedback(result.message);
              })
            }
            className="focus-ring block min-h-10 w-full rounded-lg px-3 text-left text-sm hover:bg-secondary"
          >
            {label}
          </button>
        ))}
        <button
          type="button"
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              const result = await hideConferenceVoiceAction(targetType, targetId, topicId);
              onFeedback(result.message);
              if (result.ok) router.push("/conference");
            })
          }
          className="focus-ring flex min-h-10 w-full items-center gap-2 rounded-lg px-3 text-left text-sm hover:bg-secondary"
        >
          <EyeOff className="h-4 w-4" /> Hide this Voice
        </button>
      </div>
    </details>
  );
}

function ReplyCard({ reply, topicId, onFeedback }: { reply: ConferenceReply; topicId: string; onFeedback: (value: string) => void }) {
  return (
    <article className="rounded-2xl border border-border/70 bg-card/70 p-4">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <span className="grid h-7 w-7 place-items-center rounded-full bg-primary/10 font-semibold text-primary">V</span>
        <span className="font-semibold text-foreground">{reply.voiceLabel}</span><span>·</span><span>{timeAgo(reply.createdAt)}</span>
      </div>
      <p className="mt-3 whitespace-pre-wrap text-sm leading-6">{reply.body}</p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {reply.isYours ? (
          <span className="inline-flex min-h-9 items-center rounded-full bg-secondary/60 px-2.5 text-xs font-semibold text-muted-foreground">
            Your Voice
          </span>
        ) : (
          <>
            <ReactionButton targetType="reply" targetId={reply.id} topicId={topicId} selected={reply.yourVote === "hype"} vote="hype" count={reply.hypeCount} onFeedback={onFeedback} />
            <ReactionButton targetType="reply" targetId={reply.id} topicId={topicId} selected={reply.yourVote === "pass"} vote="pass" count={reply.passCount} onFeedback={onFeedback} />
            <div className="ml-auto"><Actions targetType="reply" targetId={reply.id} topicId={topicId} onFeedback={onFeedback} /></div>
          </>
        )}
      </div>
    </article>
  );
}

export function ConferenceTopicPage({ topic }: { topic: ConferenceTopicDetail }) {
  const router = useRouter();
  const [body, setBody] = useState("");
  const [feedback, setFeedback] = useState("");
  const [sending, startSending] = useTransition();
  const locationRisk = detectLocationRisk(body);

  return (
    <div className="mx-auto w-full max-w-[760px] space-y-5 pb-10 md:pt-6">
      <ConferenceLocationSync />
      <div className="flex min-h-12 items-center gap-3">
        <Link href="/conference" aria-label="Back to Conference" className="focus-ring grid h-11 w-11 place-items-center rounded-full hover:bg-secondary">
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <div>
          <h1 className="text-xl font-semibold">Conference</h1>
          <div className="mt-0.5 flex items-center gap-1 text-xs font-medium text-primary"><MapPin className="h-3.5 w-3.5" /> Around You</div>
        </div>
      </div>

      {feedback ? <p role="status" className="rounded-xl bg-secondary/60 px-3 py-2 text-sm text-muted-foreground">{feedback}</p> : null}

      <article className="rounded-2xl border border-border bg-card p-5 shadow-sm">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span className="grid h-8 w-8 place-items-center rounded-full bg-primary/10 font-semibold text-primary">V</span>
          <span className="font-semibold text-foreground">{topic.voiceLabel}</span><span>·</span><span>{timeAgo(topic.createdAt)}</span>
        </div>
        <p className="mt-4 whitespace-pre-wrap text-base leading-7">{topic.body}</p>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          {topic.isYours ? (
            <span className="inline-flex min-h-9 items-center rounded-full bg-secondary/60 px-2.5 text-xs font-semibold text-muted-foreground">
              Your Topic
            </span>
          ) : (
            <>
              <ReactionButton targetType="topic" targetId={topic.id} topicId={topic.id} selected={topic.yourVote === "hype"} vote="hype" count={topic.hypeCount} onFeedback={setFeedback} />
              <ReactionButton targetType="topic" targetId={topic.id} topicId={topic.id} selected={topic.yourVote === "pass"} vote="pass" count={topic.passCount} onFeedback={setFeedback} />
            </>
          )}
          <span className="text-xs text-muted-foreground">{topic.replyCount} Voices</span>
          {!topic.isYours ? <div className="ml-auto"><Actions targetType="topic" targetId={topic.id} topicId={topic.id} onFeedback={setFeedback} /></div> : null}
        </div>
      </article>

      <section>
        <h2 className="mb-3 text-sm font-semibold">Voices</h2>
        <div className="space-y-3">
          {topic.replies.length ? topic.replies.map((reply) => <ReplyCard key={reply.id} reply={reply} topicId={topic.id} onFeedback={setFeedback} />) : (
            <div className="rounded-2xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">No Voices yet. Add the first reply.</div>
          )}
        </div>
      </section>

      <section className="sticky bottom-[calc(var(--mobile-nav-height,0px)+env(safe-area-inset-bottom,0px)+0.5rem)] rounded-2xl border border-border bg-card/95 p-3 shadow-lg backdrop-blur md:static">
        <textarea
          value={body}
          maxLength={300}
          onChange={(event) => setBody(event.target.value)}
          placeholder="Add your voice..."
          className="focus-ring min-h-20 w-full resize-none rounded-xl border border-border bg-background px-3 py-2.5 text-sm"
        />
        {locationRisk.warn ? (
          <p className="mt-2 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-foreground">
            {LOCATION_WARNING_MESSAGE}
          </p>
        ) : null}
        <div className="mt-2 flex items-center justify-between">
          <span className="text-xs text-muted-foreground">{body.length}/300</span>
          <button
            type="button"
            disabled={sending || body.trim().length === 0}
            onClick={() =>
              startSending(async () => {
                const result = await createConferenceReplyAction(topic.id, body);
                setFeedback(result.message);
                if (result.ok) {
                  setBody("");
                  router.refresh();
                }
              })
            }
            className="focus-ring inline-flex min-h-10 items-center gap-2 rounded-full bg-primary px-4 text-sm font-semibold text-primary-foreground disabled:opacity-50"
          >
            {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            Add Voice
          </button>
        </div>
      </section>
    </div>
  );
}
