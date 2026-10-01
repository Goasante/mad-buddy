"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import {
  ArrowDown,
  ArrowUp,
  Clock3,
  Flame,
  Flag,
  Loader2,
  MapPin,
  MessageCircle,
  PenLine,
  Trash2
} from "lucide-react";
import { createConferenceTopicAction, deleteConferenceContentAction, reportConferenceAction, voteConferenceAction } from "@/app/(app)/conference-actions";
import { PageHeader } from "@/components/app-shell/page-header";
import { ConferenceLocationSync } from "@/components/conference/conference-location-sync";
import { detectLocationRisk } from "@/lib/content/safety";
import type { ConferenceFeedResult, ConferenceSort, ConferenceTopic, ConferenceVote } from "@/lib/conference/types";
import { cn } from "@/lib/utils";

function timeAgo(value: string) {
  const seconds = Math.max(0, Math.floor((Date.now() - Date.parse(value)) / 1000));
  if (seconds < 60) return "now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

function VoteButton({
  topic,
  vote,
  icon: Icon,
  label,
  count,
  onDone
}: {
  topic: ConferenceTopic;
  vote: ConferenceVote;
  icon: typeof ArrowUp;
  label: string;
  count: number;
  onDone: (message: string) => void;
}) {
  const [pending, startTransition] = useTransition();
  const active = topic.yourVote === vote;

  return (
    <button
      type="button"
      disabled={pending}
      aria-pressed={active}
      onClick={() =>
        startTransition(async () => {
          const result = await voteConferenceAction("topic", topic.id, vote, topic.id);
          onDone(result.message);
        })
      }
      className={cn(
        "focus-ring inline-flex min-h-9 items-center gap-1.5 rounded-full px-2.5 text-xs font-semibold transition-colors",
        active ? "bg-primary/12 text-primary" : "bg-secondary/60 text-muted-foreground hover:text-foreground"
      )}
    >
      {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Icon className="h-3.5 w-3.5" />}
      {label} {count}
    </button>
  );
}

function TopicCard({ topic, onFeedback }: { topic: ConferenceTopic; onFeedback: (message: string) => void }) {
  const router = useRouter();
  const [reporting, startReporting] = useTransition();
  const [deleting, startDeleting] = useTransition();

  return (
    <article className="rounded-2xl border border-border/70 bg-card/80 p-4 shadow-sm">
      <Link href={`/conference/${topic.id}`} className="block">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span className="grid h-7 w-7 place-items-center rounded-full bg-primary/10 font-semibold text-primary">V</span>
          <span className="font-semibold text-foreground">{topic.voiceLabel}</span>
          <span>·</span>
          <span>{timeAgo(topic.createdAt)}</span>
        </div>
        <p className="mt-3 whitespace-pre-wrap text-[15px] leading-6 text-foreground">{topic.body}</p>
      </Link>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        {topic.isYours ? (
          <>
            <span className="inline-flex min-h-9 items-center rounded-full bg-secondary/60 px-2.5 text-xs font-semibold text-muted-foreground">
              Your Topic
            </span>
            <button
              type="button"
              disabled={deleting}
              onClick={() => {
                if (!window.confirm("Delete this Topic? It will disappear from Conference.")) return;
                startDeleting(async () => {
                  const result = await deleteConferenceContentAction("topic", topic.id, topic.id);
                  onFeedback(result.message);
                  if (result.ok) router.refresh();
                });
              }}
              className="focus-ring inline-flex min-h-9 items-center gap-1.5 rounded-full px-2.5 text-xs font-semibold text-destructive hover:bg-destructive/10 disabled:opacity-50"
            >
              {deleting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
              Delete
            </button>
          </>
        ) : (
          <>
            <VoteButton topic={topic} vote="hype" icon={ArrowUp} label="Hype" count={topic.hypeCount} onDone={(m) => { onFeedback(m); router.refresh(); }} />
            <VoteButton topic={topic} vote="pass" icon={ArrowDown} label="Pass" count={topic.passCount} onDone={(m) => { onFeedback(m); router.refresh(); }} />
          </>
        )}
        <Link
          href={`/conference/${topic.id}`}
          className="focus-ring inline-flex min-h-9 items-center gap-1.5 rounded-full bg-secondary/60 px-2.5 text-xs font-semibold text-muted-foreground hover:text-foreground"
        >
          <MessageCircle className="h-3.5 w-3.5" />
          {topic.replyCount} Voices
        </Link>

        {!topic.isYours ? <details className="relative ml-auto">
          <summary className="focus-ring flex min-h-9 cursor-pointer list-none items-center gap-1.5 rounded-full px-2.5 text-xs font-medium text-muted-foreground hover:bg-secondary/60 hover:text-foreground">
            <Flag className="h-3.5 w-3.5" />
            Flag
          </summary>
          <div className="absolute right-0 z-20 mt-1 w-44 rounded-xl border border-border bg-card p-1.5 shadow-lg">
            {[
              ["harassment", "Harassment"],
              ["threat_or_violence", "Threat or violence"],
              ["sexual_content", "Sexual content"],
              ["hate_or_discrimination", "Hate or discrimination"],
              ["spam", "Spam"],
              ["scam", "Scam"],
              ["private_information", "Private information"],
              ["dangerous_location_sharing", "Dangerous location sharing"],
              ["other", "Other"]
            ].map(([reason, label]) => (
              <button
                key={reason}
                type="button"
                disabled={reporting}
                onClick={() =>
                  startReporting(async () => {
                    const result = await reportConferenceAction("topic", topic.id, reason, topic.id);
                    onFeedback(result.message);
                    if (result.ok) router.refresh();
                  })
                }
                className="focus-ring block min-h-10 w-full rounded-lg px-3 text-left text-sm hover:bg-secondary"
              >
                {label}
              </button>
            ))}
          </div>
        </details> : null}
      </div>
    </article>
  );
}

export function ConferencePage({ feed, sort }: { feed: ConferenceFeedResult; sort: ConferenceSort }) {
  const router = useRouter();
  const [composerOpen, setComposerOpen] = useState(false);
  const [body, setBody] = useState("");
  const [feedback, setFeedback] = useState("");
  const [posting, startPosting] = useTransition();
  const [locating, setLocating] = useState(false);
  const locationRisk = detectLocationRisk(body);

  function updateLocation() {
    if (!navigator.geolocation) {
      setFeedback("Location isn't available in this browser.");
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      async (position) => {
        try {
          const response = await fetch("/api/conference/location", {
            method: "POST",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              latitude: position.coords.latitude,
              longitude: position.coords.longitude,
              accuracy: Math.min(10000, Math.max(0, position.coords.accuracy ?? 50))
            })
          });
          setFeedback(response.ok ? "Around You updated." : "Couldn't update your location.");
          if (response.ok) router.refresh();
        } catch {
          setFeedback("Couldn't update your location.");
        } finally {
          setLocating(false);
        }
      },
      () => {
        setLocating(false);
        setFeedback("Allow location to see Conference Around You.");
      },
      { enableHighAccuracy: false, maximumAge: 60_000, timeout: 12_000 }
    );
  }

  return (
    <div className="mx-auto w-full max-w-[760px] space-y-5 pb-10 md:pt-6">
      <ConferenceLocationSync refreshOnFirst={!feed.locationAvailable} />
      <PageHeader title="Conference" />

      <div className="flex items-center justify-between gap-3 pt-1">
        <div>
          <div className="inline-flex min-h-9 items-center gap-1.5 rounded-full bg-primary/10 px-3 text-sm font-semibold text-primary">
            <MapPin className="h-4 w-4" />
            Around You
          </div>
          <p className="mt-2 max-w-xl text-sm text-muted-foreground">
            Conversations within 15 km. No exact location or distance is shown.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setComposerOpen((value) => !value)}
          className="focus-ring inline-flex min-h-11 shrink-0 items-center gap-2 rounded-full bg-primary px-4 text-sm font-semibold text-primary-foreground"
        >
          <PenLine className="h-4 w-4" />
          Topic
        </button>
      </div>

      {feedback ? <p role="status" className="rounded-xl bg-secondary/60 px-3 py-2 text-sm text-muted-foreground">{feedback}</p> : null}

      {composerOpen ? (
        <section className="rounded-2xl border border-primary/20 bg-card p-4 shadow-sm">
          <h2 className="text-lg font-semibold">What’s happening around you?</h2>
          <p className="mt-1 text-sm text-muted-foreground">You’ll appear as a Voice, not your MadBuddy name.</p>
          <textarea
            value={body}
            maxLength={300}
            onChange={(event) => setBody(event.target.value)}
            placeholder="Share a thought, ask a question, or start a local conversation..."
            className="focus-ring mt-4 min-h-32 w-full resize-none rounded-xl border border-border bg-background px-3 py-3 text-sm"
          />
          {locationRisk.warn ? (
            <p className="mt-2 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-foreground">
              {"This may reveal an exact location. Conference is visible to nearby members."}
            </p>
          ) : null}
          <div className="mt-2 flex items-center justify-between gap-3">
            <span className="text-xs text-muted-foreground">{body.length}/300</span>
            <button
              type="button"
              disabled={posting || body.trim().length === 0}
              onClick={() =>
                startPosting(async () => {
                  const result = await createConferenceTopicAction(body);
                  setFeedback(result.message);
                  if (result.ok) {
                    setBody("");
                    setComposerOpen(false);
                    router.refresh();
                  }
                })
              }
              className="focus-ring inline-flex min-h-10 items-center gap-2 rounded-full bg-primary px-4 text-sm font-semibold text-primary-foreground disabled:opacity-50"
            >
              {posting ? <Loader2 className="h-4 w-4 animate-spin" /> : <PenLine className="h-4 w-4" />}
              Post Topic
            </button>
          </div>
        </section>
      ) : null}

      <div className="grid grid-cols-2 rounded-xl bg-secondary/60 p-1" aria-label="Conference feed">
        <Link
          href="/conference?sort=fresh"
          aria-current={sort === "fresh" ? "page" : undefined}
          className={cn("focus-ring flex min-h-10 items-center justify-center gap-2 rounded-lg text-sm font-semibold", sort === "fresh" ? "bg-card text-foreground shadow-sm" : "text-muted-foreground")}
        >
          <Clock3 className="h-4 w-4" /> Fresh
        </Link>
        <Link
          href="/conference?sort=hot"
          aria-current={sort === "hot" ? "page" : undefined}
          className={cn("focus-ring flex min-h-10 items-center justify-center gap-2 rounded-lg text-sm font-semibold", sort === "hot" ? "bg-card text-foreground shadow-sm" : "text-muted-foreground")}
        >
          <Flame className="h-4 w-4" /> Hot
        </Link>
      </div>

      {feed.accessRestricted ? (
        <section className="rounded-2xl border border-border bg-card/80 p-6 text-center">
          <h2 className="text-lg font-semibold">Conference unavailable</h2>
          <p className="mt-2 text-sm text-muted-foreground">This account currently has a restriction that prevents Conference access.</p>
        </section>
      ) : !feed.locationAvailable ? (
        <section className="rounded-2xl border border-border bg-card/80 p-6 text-center">
          <MapPin className="mx-auto h-8 w-8 text-primary" />
          <h2 className="mt-3 text-lg font-semibold">{feed.locationStale ? "Refresh Around You" : "See Conference Around You"}</h2>
          <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
            Conference uses your current area only to find Topics within 15 km. Your exact location is never shown in Conference.
          </p>
          <button
            type="button"
            disabled={locating}
            onClick={updateLocation}
            className="focus-ring mt-4 inline-flex min-h-11 items-center gap-2 rounded-full bg-primary px-5 text-sm font-semibold text-primary-foreground disabled:opacity-50"
          >
            {locating ? <Loader2 className="h-4 w-4 animate-spin" /> : <MapPin className="h-4 w-4" />}
            Update location
          </button>
        </section>
      ) : feed.topics.length === 0 ? (
        <section className="rounded-2xl border border-dashed border-border p-8 text-center">
          <h2 className="text-lg font-semibold">Quiet Around You</h2>
          <p className="mt-2 text-sm text-muted-foreground">No recent Conference Topics are within 15 km yet. You can start the first one.</p>
        </section>
      ) : (
        <div className="space-y-3">
          {feed.topics.map((topic) => <TopicCard key={topic.id} topic={topic} onFeedback={setFeedback} />)}
        </div>
      )}
    </div>
  );
}
