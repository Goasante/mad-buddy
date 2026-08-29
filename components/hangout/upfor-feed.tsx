"use client";

import { useCallback, useMemo, useState } from "react";
import { filterForMode, type UpForMode } from "@/lib/social/upfor-feed";
import { UpForCard, type UpForCardModel } from "@/components/hangout/upfor-card";
import {
  UpForEmptyState,
  UpForError,
  UpForSkeleton,
  UpForTabs
} from "@/components/hangout/upfor-feed-parts";

/**
 * The UpFor feed: four discovery modes over one eligible list.
 *
 * WHY ONE LIST. Every row here already cleared canViewHangout on the server,
 * so a mode narrows what the viewer is currently looking at rather than
 * deciding what they may see. Refetching per tab would make four round trips
 * to answer a question the first one already answered, and would tempt the
 * client into looking like the access control -- which it must never be.
 *
 * RULES LIVE IN lib/social/upfor-feed.ts. No sorting, ranking or eligibility
 * logic is written here; this component chooses a mode and renders what the
 * tested rules return.
 */

export type UpForFeedItem = UpForCardModel & {
  /** Server-derived. The client never infers a friendship from ids. */
  isMuddy: boolean;
  /** Server-derived. True only for a public Group the viewer has joined. */
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
  /**
   * Which card has a write in flight.
   *
   * Per-card rather than a single page flag, so joining one UpFor does not
   * freeze every other card's controls -- and so a second tap on the SAME card
   * is refused while the first is still running. That is the duplicate-tap
   * guard: the request table's unique (session, requester) constraint is the
   * real backstop, but there is no reason to send the second request at all.
   */
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
   * Run one response action.
   *
   * NOT inside startTransition. A transition is interruptible by design, and
   * React really does abandon it -- which would kill the write mid-flight and
   * leave the card showing a state the server never agreed to. Plain async
   * work with its own flag, cleared on every path.
   */
  const run = useCallback(
    (id: string, action: (id: string) => Promise<void> | void) => {
      if (pendingId) return; // a write is already in flight
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
      <UpForTabs active={mode} onChange={setMode} counts={counts} />

      <div
        role="tabpanel"
        id={`upfor-panel-${mode}`}
        aria-labelledby={`upfor-tab-${mode}`}
        className="upfor-feed__panel"
      >
        {/* Order matters: an error replaces the list, loading replaces an
            empty state, and only a settled empty list shows the empty copy. */}
        {error ? (
          <UpForError message={error} onRetry={onRetry} />
        ) : loading ? (
          <UpForSkeleton />
        ) : visible.length === 0 ? (
          <UpForEmptyState mode={mode} onStart={onStart} />
        ) : (
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
        )}
      </div>
    </section>
  );
}
