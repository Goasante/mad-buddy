"use client";

import Image from "next/image";
import { useCallback, useMemo, useState } from "react";
import { Users } from "lucide-react";
import { filterForMode, rankForYou, type UpForMode } from "@/lib/social/upfor-feed";
import { upForGoingLabel, upForTitle } from "@/lib/social/upfor";
import type { HangoutActivityType } from "@/lib/supabase/database.types";
import { UpForCard, type UpForCardModel } from "@/components/hangout/upfor-card";
import {
  UpForEmptyState,
  UpForError,
  UpForSkeleton,
  UpForTabs
} from "@/components/hangout/upfor-feed-parts";
import styles from "@/components/hangout/upfor-revamp.module.css";

/**
 * UpFor is an activity-discovery surface, not a second Plans page.
 *
 * The server still owns visibility and eligibility. This component only
 * presents the already-eligible list through three browsing lenses and two
 * useful views of the same live inventory: what is coming up and what has the
 * most social momentum right now.
 */

export type UpForFeedItem = UpForCardModel & {
  /** Server-derived. The client never infers a friendship from ids. */
  isMuddy: boolean;
  /** Server-derived. A group relationship may still affect ranking, even
   * though Groups is no longer a standalone UpFor tab. */
  viaGroup: boolean;
};

export type UpForFeedProps = {
  items: readonly UpForFeedItem[];
  viewerId: string;
  nowMs: number;
  loading?: boolean;
  error?: string | null;
  onRetry?: () => void;
  onJoin: (id: string) => Promise<void> | void;
  onWithdraw: (id: string) => Promise<void> | void;
  onOpenChat?: (id: string) => void;
  onCreatePlan?: (id: string) => Promise<void> | void;
  onOpen?: (id: string) => void;
  onStart?: () => void;
};

/** Curated Mad Buddy artwork for UpFor categories. User-uploaded media can
 * replace this later; these are deterministic, local fallbacks today. */
const ACTIVITY_ART: Partial<Record<HangoutActivityType, string>> = {
  anything: "/visuals/activities/party.jpg",
  food: "/visuals/activities/dinner.jpg",
  study: "/visuals/activities/coffee.jpg",
  sports: "/visuals/activities/football.jpg",
  gym: "/visuals/activities/football.jpg",
  walk: "/visuals/activities/picnic.jpg",
  gaming: "/visuals/activities/movie.jpg",
  chill: "/visuals/activities/beach.jpg"
};

function activityArtwork(activity: HangoutActivityType): string {
  return ACTIVITY_ART[activity] ?? "/visuals/activities/party.jpg";
}

export function UpForFeed({
  items,
  viewerId,
  nowMs,
  loading = false,
  error = null,
  onRetry,
  onJoin,
  onWithdraw,
  onOpenChat,
  onCreatePlan,
  onOpen,
  onStart
}: UpForFeedProps) {
  const [mode, setMode] = useState<UpForMode>("for_you");
  /** Per-card rather than page-wide: one response must not freeze every card. */
  const [pendingId, setPendingId] = useState<string | null>(null);

  const visible = useMemo(() => filterForMode(items, mode, nowMs), [items, mode, nowMs]);

  const counts = useMemo(
    () => ({
      for_you: filterForMode(items, "for_you", nowMs).length,
      muddies: filterForMode(items, "muddies", nowMs).length,
      around: filterForMode(items, "around", nowMs).length
    }),
    [items, nowMs]
  );

  /**
   * Keep ordering authority in the shared UpFor ranking module rather than
   * introducing a second client-side sort. That ranking already gives real
   * participation meaningful weight alongside friendship, proximity and
   * freshness, so this rail reflects social momentum without inventing a
   * favourite count or another opaque score.
   */
  const popular = useMemo(() => rankForYou(visible, nowMs).slice(0, 6), [visible, nowMs]);

  const run = useCallback(
    (id: string, action: (id: string) => Promise<void> | void) => {
      if (pendingId) return;
      setPendingId(id);
      void (async () => {
        try {
          await action(id);
        } finally {
          setPendingId(null);
        }
      })();
    },
    [pendingId]
  );

  return (
    <section className="upfor-feed" aria-label="UpFor">
      <div className={styles.hero}>
        <Image
          src="/illustrations/upfor/good-people-great-plans.jpg"
          alt="Good people. Great plans. Discover hangouts, meetups and chill sessions on Mad Buddy."
          width={1200}
          height={675}
          priority
          sizes="(max-width: 640px) 100vw, 560px"
          className={styles.heroImage}
        />
      </div>

      <UpForTabs active={mode} onChange={setMode} counts={counts} />

      <div
        role="tabpanel"
        id={`upfor-panel-${mode}`}
        aria-labelledby={`upfor-tab-${mode}`}
        className="upfor-feed__panel"
      >
        {error ? (
          <UpForError message={error} onRetry={onRetry} />
        ) : loading ? (
          <UpForSkeleton />
        ) : visible.length === 0 ? (
          <UpForEmptyState mode={mode} onStart={onStart} />
        ) : (
          <>
            <div className={styles.sectionHeading}>
              <h3 className={styles.sectionTitle}>Coming Up</h3>
              <span className={styles.sectionMeta}>
                {visible.length} {visible.length === 1 ? "UpFor" : "UpFors"}
              </span>
            </div>

            <div className="upfor-feed__list">
              {visible.map((item) => (
                <UpForCard
                  key={item.id}
                  upfor={item}
                  viewerId={viewerId}
                  nowMs={nowMs}
                  responseState={pendingId === item.id ? "pending" : "idle"}
                  onJoin={(id) => run(id, onJoin)}
                  onWithdraw={(id) => run(id, onWithdraw)}
                  onOpenChat={onOpenChat}
                  onOpen={onOpen}
                  onCreatePlan={onCreatePlan ? (id) => run(id, onCreatePlan) : undefined}
                />
              ))}
            </div>

            <section className={styles.popular} aria-labelledby="upfor-popular-heading">
              <div className={styles.sectionHeading}>
                <h3 id="upfor-popular-heading" className={styles.sectionTitle}>
                  Popular right now
                </h3>
              </div>

              <div className={styles.popularRail}>
                {popular.map((item) => {
                  const going = upForGoingLabel(item.goingCount);
                  return (
                    <button
                      key={item.id}
                      type="button"
                      className={styles.popularCard}
                      onClick={() => onOpen?.(item.id)}
                      disabled={!onOpen}
                      aria-label={`View ${upForTitle(item.activityType)} from ${item.ownerName}`}
                    >
                      <Image
                        src={activityArtwork(item.activityType)}
                        alt=""
                        fill
                        sizes="168px"
                        className={styles.popularImage}
                      />
                      <span className={styles.popularScrim} aria-hidden="true" />
                      <span className={styles.popularContent}>
                        <span className={styles.popularTitle}>{upForTitle(item.activityType)}</span>
                        <span className={styles.popularProof}>
                          <Users aria-hidden="true" />
                          {going ?? "New UpFor"}
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </section>
          </>
        )}
      </div>
    </section>
  );
}
