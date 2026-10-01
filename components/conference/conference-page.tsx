"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, useTransition } from "react";
import {
  ArrowDown,
  ArrowUp,
  Clock3,
  Flame,
  Loader2,
  MapPin,
  MessageCircle,
  PenLine
} from "lucide-react";
import {
  createConferenceTopicAction,
  deleteConferenceContentAction,
  reportConferenceAction,
  voteConferenceAction
} from "@/app/(app)/conference-actions";
import { PageHeader } from "@/components/app-shell/page-header";
import { ConferenceLocationSync } from "@/components/conference/conference-location-sync";
import {
  ConferenceActionMenu,
  ConferenceDeleteMenuItem
} from "@/components/conference/conference-action-menu";
import { detectLocationRisk } from "@/lib/content/safety";
import type {
  ConferenceActionResult,
  ConferenceFeedResult,
  ConferenceReportReason,
  ConferenceSort,
  ConferenceTopic,
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
  const seconds = Math.max(0, Math.floor((Date.now() - Date.parse(value)) / 1000));
  if (seconds < 60) return "now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

function hotScore(topic: ConferenceTopic) {
  const ageHours = Math.max(0, (Date.now() - Date.parse(topic.createdAt)) / 3_600_000);
  return topic.hypeCount - topic.passCount * 0.75 + Math.min(topic.replyCount, 20) * 1.5 - ageHours * 0.25;
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

function TopicCard({
  topic,
  onRemove,
  onRestore,
  onError
}: {
  topic: ConferenceTopic;
  onRemove: (id: string) => void;
  onRestore: (topic: ConferenceTopic) => void;
  onError: (message: string) => void;
}) {
  const [vote, setVote] = useState(topic.yourVote);
  const [hypeCount, setHypeCount] = useState(topic.hypeCount);
  const [passCount, setPassCount] = useState(topic.passCount);
  const [pending, startMutation] = useTransition();
  const optimistic = topic.id.startsWith("optimistic-");

  function react(selected: ConferenceVote) {
    if (optimistic) return;
    const previous = { vote, hypeCount, passCount };
    const next = nextVoteState(vote, selected, hypeCount, passCount);
    setVote(next.vote);
    setHypeCount(next.hypeCount);
    setPassCount(next.passCount);

    startMutation(async () => {
      const result = await voteConferenceAction("topic", topic.id, selected, topic.id);
      if (!result.ok) {
        if (result.stale) {
          onRemove(topic.id);
          onError(result.message);
          return;
        }
        setVote(previous.vote);
        setHypeCount(previous.hypeCount);
        setPassCount(previous.passCount);
        onError(result.message);
      }
    });
  }

  function removeThen(task: () => Promise<ConferenceActionResult>) {
    onRemove(topic.id);
    startMutation(async () => {
      const result = await task();
      if (!result.ok && !result.stale) {
        onRestore(topic);
        onError(result.message);
        return;
      }
      if (result.stale) onError(result.message);
    });
  }

  const content = (
    <>
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-primary/10 font-semibold text-primary">V</span>
        <span className="font-semibold text-foreground">{topic.isYours ? "You" : topic.voiceLabel}</span>
        <span>·</span>
        <span>{timeAgo(topic.createdAt)}</span>
        {optimistic ? <span className="text-primary">Sending…</span> : null}
      </div>
      <p className="mt-2 whitespace-pre-wrap text-[15px] leading-[1.45] text-foreground">{topic.body}</p>
    </>
  );

  return (
    <article className="rounded-[18px] border border-border/70 bg-card/75 px-3.5 py-3 shadow-sm">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          {optimistic ? <div>{content}</div> : <Link href={`/conference/${topic.id}`} className="block">{content}</Link>}
        </div>

        {!optimistic ? (
          <ConferenceActionMenu label="Topic actions">
            {(close) =>
              topic.isYours ? (
                <ConferenceDeleteMenuItem
                  label="Delete Topic"
                  close={close}
                  onDelete={() => removeThen(() => deleteConferenceContentAction("topic", topic.id, topic.id))}
                />
              ) : (
                <>
                  <div className="px-3 pb-1 pt-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Flag Topic</div>
                  {REPORT_REASONS.map(([reason, label]) => (
                    <button
                      key={reason}
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        close();
                        removeThen(() => reportConferenceAction("topic", topic.id, reason, topic.id));
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

      <div className="mt-3 flex items-center gap-1.5">
        {!topic.isYours ? (
          <>
            <button
              type="button"
              disabled={optimistic || pending}
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
              disabled={optimistic || pending}
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
        ) : (
          <span className="inline-flex h-8 items-center rounded-full bg-secondary/55 px-2.5 text-xs font-semibold text-muted-foreground">Your Topic</span>
        )}

        {optimistic ? (
          <span className="inline-flex h-8 items-center gap-1 rounded-full bg-secondary/55 px-2.5 text-xs font-semibold text-muted-foreground">
            <MessageCircle className="h-3.5 w-3.5" />
            {voiceCount(topic.replyCount)}
          </span>
        ) : (
          <Link
            href={`/conference/${topic.id}`}
            className="focus-ring inline-flex h-8 items-center gap-1 rounded-full bg-secondary/55 px-2.5 text-xs font-semibold text-muted-foreground"
          >
            <MessageCircle className="h-3.5 w-3.5" />
            {voiceCount(topic.replyCount)}
          </Link>
        )}
      </div>
    </article>
  );
}

export function ConferencePage({
  feed,
  initialSort,
  initialFeedback = ""
}: {
  feed: ConferenceFeedResult;
  initialSort: ConferenceSort;
  initialFeedback?: string;
}) {
  const [sort, setSort] = useState<ConferenceSort>(initialSort);
  const [topics, setTopics] = useState(feed.topics);
  const [composerOpen, setComposerOpen] = useState(false);
  const [body, setBody] = useState("");
  const [feedback, setFeedback] = useState(initialFeedback);
  const [posting, startPosting] = useTransition();
  const [locating, setLocating] = useState(false);
  const locationRisk = detectLocationRisk(body);

  useEffect(() => {
    if (!feedback) return;
    const timer = window.setTimeout(() => setFeedback(""), 2800);
    return () => window.clearTimeout(timer);
  }, [feedback]);

  const visibleTopics = useMemo(() => {
    const copy = [...topics];
    if (sort === "hot") copy.sort((a, b) => hotScore(b) - hotScore(a));
    else copy.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
    return copy.slice(0, 40);
  }, [sort, topics]);

  function selectSort(next: ConferenceSort) {
    setSort(next);
    window.history.replaceState(null, "", `/conference?sort=${next}`);
  }

  function removeTopic(id: string) {
    setTopics((current) => current.filter((item) => item.id !== id));
  }

  function restoreTopic(topic: ConferenceTopic) {
    setTopics((current) => (current.some((item) => item.id === topic.id) ? current : [topic, ...current]));
  }

  function postTopic() {
    const text = body.trim();
    if (!text || posting) return;

    const tempId = `optimistic-${Date.now()}`;
    const optimistic: ConferenceTopic = {
      id: tempId,
      voiceLabel: "You",
      body: text,
      createdAt: new Date().toISOString(),
      hypeCount: 0,
      passCount: 0,
      replyCount: 0,
      yourVote: null,
      isYours: true
    };

    setTopics((current) => [optimistic, ...current]);
    setBody("");
    setComposerOpen(false);

    startPosting(async () => {
      const result = await createConferenceTopicAction(text);
      if (!result.ok || !result.topicId) {
        removeTopic(tempId);
        setFeedback(result.message);
        return;
      }

      setTopics((current) =>
        current.map((item) =>
          item.id === tempId
            ? { ...item, id: result.topicId!, createdAt: result.createdAt ?? item.createdAt }
            : item
        )
      );
    });
  }

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
          if (response.ok) window.location.reload();
          else setFeedback("Couldn't update your area.");
        } catch {
          setFeedback("Couldn't update your area.");
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
    <div className="mx-auto w-full max-w-[640px] space-y-3 pb-8 md:pt-4">
      <ConferenceLocationSync refreshOnFirst={!feed.locationAvailable} hardRefresh />
      <PageHeader title="Conference" />

      <div className="flex items-center justify-between gap-3">
        <div className="inline-flex h-8 items-center gap-1.5 rounded-full bg-primary/10 px-3 text-xs font-semibold text-primary">
          <MapPin className="h-3.5 w-3.5" />
          Around You · 15 km
        </div>
        <button
          type="button"
          onClick={() => setComposerOpen((value) => !value)}
          className="focus-ring inline-flex h-10 shrink-0 items-center gap-2 rounded-full bg-primary px-4 text-sm font-semibold text-primary-foreground"
        >
          <PenLine className="h-4 w-4" />
          Topic
        </button>
      </div>

      {feedback ? (
        <p role="status" className="rounded-xl bg-secondary/65 px-3 py-2 text-sm text-muted-foreground">
          {feedback}
        </p>
      ) : null}

      {composerOpen ? (
        <section className="rounded-[18px] border border-border bg-card/80 p-3.5 shadow-sm">
          <textarea
            autoFocus
            value={body}
            maxLength={300}
            onChange={(event) => setBody(event.target.value)}
            placeholder="What's happening around you?"
            className="focus-ring min-h-24 w-full resize-none rounded-xl border border-border bg-background px-3 py-2.5 text-sm"
          />
          {locationRisk.warn ? (
            <p className="mt-2 rounded-lg bg-amber-500/10 px-2.5 py-2 text-xs text-foreground">
              This may reveal an exact location. Conference is visible to nearby members.
            </p>
          ) : null}
          <div className="mt-2 flex items-center justify-between">
            <span className="text-xs text-muted-foreground">{body.length}/300 · anonymous to others</span>
            <button
              type="button"
              disabled={posting || body.trim().length === 0}
              onClick={postTopic}
              className="focus-ring inline-flex h-9 items-center gap-1.5 rounded-full bg-primary px-3.5 text-sm font-semibold text-primary-foreground disabled:opacity-50"
            >
              {posting ? <Loader2 className="h-4 w-4 animate-spin" /> : <PenLine className="h-4 w-4" />}
              Post
            </button>
          </div>
        </section>
      ) : null}

      <div className="grid grid-cols-2 rounded-xl bg-secondary/55 p-1" aria-label="Conference feed">
        <button
          type="button"
          onClick={() => selectSort("fresh")}
          aria-current={sort === "fresh" ? "page" : undefined}
          className={cn(
            "focus-ring flex h-9 items-center justify-center gap-1.5 rounded-lg text-sm font-semibold",
            sort === "fresh" ? "bg-card text-foreground shadow-sm" : "text-muted-foreground"
          )}
        >
          <Clock3 className="h-4 w-4" />
          Fresh
        </button>
        <button
          type="button"
          onClick={() => selectSort("hot")}
          aria-current={sort === "hot" ? "page" : undefined}
          className={cn(
            "focus-ring flex h-9 items-center justify-center gap-1.5 rounded-lg text-sm font-semibold",
            sort === "hot" ? "bg-card text-foreground shadow-sm" : "text-muted-foreground"
          )}
        >
          <Flame className="h-4 w-4" />
          Hot
        </button>
      </div>

      {feed.accessRestricted ? (
        <section className="rounded-[18px] border border-border bg-card/75 p-5 text-center">
          <h2 className="font-semibold">Conference unavailable</h2>
          <p className="mt-1 text-sm text-muted-foreground">This account currently has a Conference restriction.</p>
        </section>
      ) : !feed.locationAvailable ? (
        <section className="rounded-[18px] border border-border bg-card/75 p-5 text-center">
          <MapPin className="mx-auto h-6 w-6 text-primary" />
          <h2 className="mt-2 font-semibold">{feed.locationStale ? "Refresh Around You" : "See what's Around You"}</h2>
          <p className="mt-1 text-sm text-muted-foreground">Your exact location is never shown.</p>
          <button
            type="button"
            disabled={locating}
            onClick={updateLocation}
            className="focus-ring mt-3 inline-flex h-10 items-center gap-2 rounded-full bg-primary px-4 text-sm font-semibold text-primary-foreground disabled:opacity-50"
          >
            {locating ? <Loader2 className="h-4 w-4 animate-spin" /> : <MapPin className="h-4 w-4" />}
            Update area
          </button>
        </section>
      ) : visibleTopics.length === 0 ? (
        <section className="rounded-[18px] border border-dashed border-border p-6 text-center">
          <h2 className="font-semibold">Quiet Around You</h2>
          <p className="mt-1 text-sm text-muted-foreground">Start the first local Topic.</p>
        </section>
      ) : (
        <div className="space-y-2.5">
          {visibleTopics.map((topic) => (
            <TopicCard
              key={topic.id}
              topic={topic}
              onRemove={removeTopic}
              onRestore={restoreTopic}
              onError={setFeedback}
            />
          ))}
        </div>
      )}
    </div>
  );
}
