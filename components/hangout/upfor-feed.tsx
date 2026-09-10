"use client";

import Image from "next/image";
import { useCallback, useMemo, useState } from "react";
import { Users } from "lucide-react";
import { UpForActivityIcon } from "@/components/hangout/upfor-activity-icon";
import { filterForMode, rankForYou, type UpForMode } from "@/lib/social/upfor-feed";
import { UPFOR_QUICK_IDEAS, upForGoingLabel, upForTitle } from "@/lib/social/upfor";
import { resolveUpForActivityArtwork } from "@/lib/visuals/upfor-art";
import { UpForCard, type UpForCardModel } from "@/components/hangout/upfor-card";
import {
  UpForEmptyState,
  UpForError,
  UpForSkeleton,
  UpForTabs
} from "@/components/hangout/upfor-feed-parts";
import styles from "@/components/hangout/upfor-revamp.module.css";
import imageStyles from "@/components/hangout/upfor-image-hardening.module.css";

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

/**
 * Quick Ideas is still rendered by the parent page, but its photography is
 * resolved here from the same semantic authority as Popular right now. The
 * generated nth-child selectors are presentation plumbing only: the IMAGE is
 * chosen by `idea.id`, so reordering UPFOR_QUICK_IDEAS cannot silently remap
 * Study to coffee or Gaming to movie again.
 */
const QUICK_IDEA_ARTWORK_CSS = UPFOR_QUICK_IDEAS.map((idea, index) => {
  const selector = `.upfor-page:has([data-upfor-image-hardening]) .upfor-ideas > li:nth-child(${index + 1}) .upfor-idea`;
  const artwork = resolveUpForActivityArtwork(idea.id);

  if (artwork) {
    return `${selector}{background-image:url("${artwork.asset.path}")!important;background-position:${artwork.objectPosition}!important}${selector} .upfor-idea-emoji{display:none!important}`;
  }

  return `${selector}{background-image:radial-gradient(circle at 72% 20%,rgb(232 140 43 / .34),transparent 42%),linear-gradient(145deg,#4e0401 0%,#24110d 58%,#120b09 100%)!important;background-position:center!important}${selector} .upfor-idea-emoji{display:grid!important}`;
}).join("\n");

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
    <section
      className={`upfor-feed ${imageStyles.scope}`}
      aria-label="UpFor"
      data-upfor-image-hardening
    >
      <style>{QUICK_IDEA_ARTWORK_CSS}</style>

      <div className={styles.hero}>
        <div className={styles.heroCopy}>
          <span className={styles.heroKicker}>RIGHT NOW</span>
          <h2 className={styles.heroTitle}>
            Good people.
            <br />
            Great plans.
          </h2>
          <p className={styles.heroText}>See what&apos;s happening, join in, or start something.</p>
        </div>

        <div className={styles.heroGallery} aria-hidden="true">
          <span className={`${styles.heroTile} ${styles.heroTileBack}`}>
            <Image
              src="/visuals/activities/beach.jpg"
              alt=""
              fill
              priority
              sizes="110px"
              className={`${styles.heroTileImage} ${imageStyles.bleedImage}`}
            />
          </span>
          <span className={`${styles.heroTile} ${styles.heroTileMiddle}`}>
            <Image
              src="/visuals/activities/football.jpg"
              alt=""
              fill
              priority
              sizes="110px"
              className={`${styles.heroTileImage} ${imageStyles.bleedImage}`}
            />
          </span>
          <span className={`${styles.heroTile} ${styles.heroTileFront}`}>
            <Image
              src="/visuals/activities/dinner.jpg"
              alt=""
              fill
              priority
              sizes="120px"
              className={`${styles.heroTileImage} ${imageStyles.bleedImage}`}
            />
          </span>
        </div>
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
                  const artwork = resolveUpForActivityArtwork(item.activityType);
                  return (
                    <button
                      key={item.id}
                      type="button"
                      className={`${styles.popularCard} ${imageStyles.imageCard}`}
                      onClick={() => onOpen?.(item.id)}
                      disabled={!onOpen}
                      aria-label={`View ${upForTitle(item.activityType)} from ${item.ownerName}`}
                    >
                      {artwork ? (
                        <Image
                          src={artwork.asset.path}
                          alt=""
                          fill
                          sizes="168px"
                          className={`${styles.popularImage} ${imageStyles.bleedImage}`}
                          style={{ objectPosition: artwork.objectPosition }}
                        />
                      ) : (
                        <span className={imageStyles.fallback} aria-hidden="true">
                          <UpForActivityIcon activity={item.activityType} />
                        </span>
                      )}
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
