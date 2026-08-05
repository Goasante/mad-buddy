"use client";

import { X } from "lucide-react";
import { useCallback, useEffect, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { UserAvatar } from "@/components/ui/user-avatar";
import { publicMembershipTier } from "@/lib/billing/premium-identity";
import { useReducedMotion } from "@/hooks/use-reduced-motion";
import type { TuneInEntry, VisibleMoment } from "@/lib/content/service";
import { PremiumPlanBadge } from "@/components/premium/premium-plan-badge";
import type { MomentReactionId } from "@/lib/content/moments";
import { cn } from "@/lib/utils";
import { TuneInIcon } from "@/components/content/tune-in-icon";
import { MomentMedia, ReactionControl, timeRemainingLabel, useMomentClock } from "@/components/content/moment-parts";

/**
 * My Tuned In: a compact horizontal creator strip, closer to the active-Moments
 * avatar row than to a settings list.
 *
 * The previous version was a full-height modal with one tall row per creator,
 * which made a lightweight, private preference feel like account management.
 * Ordering comes from the server (unviewed content first), so new content is
 * never something the user has to hunt for.
 *
 * The signal under each avatar is the canonical Tune In icon. It animates only
 * while the creator has a live Moment this viewer has not opened, and settles as
 * soon as it is viewed. That makes it a CONTENT state, not a notification: there
 * is no badge, no count and no unread ledger behind it.
 */
export function TunedInStrip({
  entries,
  onOpenCreator,
  onManage
}: {
  entries: TuneInEntry[];
  onOpenCreator: (entry: TuneInEntry) => void;
  onManage: () => void;
}) {
  const reducedMotion = useReducedMotion();
  if (entries.length === 0) return null;

  return (
    <section aria-labelledby="tuned-in-heading">
      <div className="mb-2 flex items-center justify-between gap-3">
        <h2 id="tuned-in-heading" className="flex items-center gap-1.5 text-sm font-semibold">
          <TuneInIcon className="h-4 w-4 shrink-0 text-orange-500" />
          My Tuned In
        </h2>
        <button
          type="button"
          onClick={onManage}
          className="focus-ring safe-motion min-h-9 rounded-full px-2 text-xs font-medium text-muted-foreground hover:bg-secondary"
        >
          Manage
        </button>
      </div>

      {/* Horizontal scroller. data-no-pull-refresh keeps a sideways swipe here
          from being read as a pull-to-refresh gesture. */}
      <div className="-mx-4 overflow-x-auto px-4 pb-1 sm:mx-0 sm:px-0" data-no-pull-refresh>
        <ul className="flex w-max gap-3.5">
          {entries.map((entry) => (
            <li key={entry.creatorId}>
              <button
                type="button"
                onClick={() => onOpenCreator(entry)}
                className="focus-ring safe-motion flex w-[4.25rem] flex-col items-center gap-1"
                aria-label={
                  entry.hasUnviewed
                    ? `${entry.name}, new Air Moment`
                    : entry.liveMomentCount > 0
                      ? `${entry.name}, ${entry.liveMomentCount} live`
                      : entry.name
                }
              >
                <span
                  className={cn(
                    "grid place-items-center rounded-full p-[2px]",
                    entry.hasUnviewed
                      ? "moment-ring"
                      : entry.liveMomentCount > 0
                        ? "moment-ring-idle"
                        : "bg-transparent"
                  )}
                >
                  <span className="rounded-full bg-background p-[2px]">
                    <UserAvatar src={entry.avatarUrl} name={entry.name} size="md" decorative />
                  </span>
                </span>
                <span className="w-full truncate text-center text-[0.6875rem] font-medium">
                  {entry.name.split(" ")[0]}
                </span>
                {/* The signal itself: animated only for genuinely new content. */}
                <TuneInIcon
                  wavesOnly
                  className={cn(
                    "h-3 w-3",
                    entry.hasUnviewed
                      ? cn("text-orange-500", !reducedMotion && "tune-in-live")
                      : entry.liveMomentCount > 0
                        ? "text-muted-foreground"
                        : "text-border"
                  )}
                />
              </button>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

/**
 * The full management list, opened from "Manage".
 *
 * Kept deliberately secondary: the strip is the everyday experience, and a
 * per-row list only appears when someone is actually managing the whole set.
 */
export function TunedInManageModal({
  open,
  entries,
  onOpenChange,
  onTuneOut
}: {
  open: boolean;
  entries: TuneInEntry[];
  onOpenChange: (open: boolean) => void;
  onTuneOut: (creatorId: string) => Promise<boolean>;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title="My Tuned In"
      description="Only you can see this list."
      variant="sheet"
      compact
    >
      {entries.length === 0 ? (
        <p className="py-4 text-center text-sm text-muted-foreground">
          You haven&apos;t tuned in to anyone yet. Tune In from Air to see more of what you like.
        </p>
      ) : (
        <ul className="space-y-1.5">
          {entries.map((entry) => (
            <li key={entry.creatorId} className="flex items-center gap-3 rounded-xl border border-border/70 px-3 py-2.5">
              <UserAvatar src={entry.avatarUrl} name={entry.name} size="sm" decorative />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">{entry.name}</span>
                {entry.liveMomentCount > 0 ? (
                  <span className="block text-[0.6875rem] text-muted-foreground">
                    {entry.liveMomentCount} live {entry.liveMomentCount === 1 ? "Moment" : "Moments"}
                  </span>
                ) : null}
              </span>
              {/* No confirmation: tuning out is low friction, reversible, and
                  the creator is not notified either way. */}
              <button
                type="button"
                disabled={busy === entry.creatorId}
                onClick={async () => {
                  setBusy(entry.creatorId);
                  await onTuneOut(entry.creatorId);
                  setBusy(null);
                }}
                className="focus-ring safe-motion shrink-0 rounded-full border border-border px-2.5 py-1 text-xs font-semibold text-muted-foreground hover:bg-secondary"
              >
                Tune Out
              </button>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}

/**
 * The Tuned In viewing lane: an immersive, full-screen Air viewer.
 *
 * Tapping a creator opens their current Moment directly rather than routing to a
 * hub first. Advancing walks that creator's Moments, then continues into the
 * next tuned-in creator who has something available, so there is a single
 * personalised lane.
 *
 * It is NOT a follower feed and NOT stories: nothing here implies a follow
 * relationship, and the lane is assembled from the viewer's own private Tune In
 * list, which the creators cannot see.
 */
export function TunedInViewer({
  lane,
  index,
  pending,
  onClose,
  onIndexChange,
  onSeen,
  onReact,
  onRemoveReaction
}: {
  lane: { entry: TuneInEntry; moments: VisibleMoment[] }[];
  index: { creator: number; moment: number };
  pending: boolean;
  onClose: () => void;
  onIndexChange: (next: { creator: number; moment: number }) => void;
  onSeen: (momentId: string, isAuthor: boolean) => void;
  onReact: (moment: VisibleMoment, reaction: MomentReactionId) => void;
  onRemoveReaction: (moment: VisibleMoment) => void;
}) {
  const nowMs = useMomentClock();
  const current = lane[index.creator];
  const moment = current?.moments[index.moment];

  const advance = useCallback(() => {
    if (!current) return;
    if (index.moment + 1 < current.moments.length) {
      onIndexChange({ creator: index.creator, moment: index.moment + 1 });
      return;
    }
    // Continue into the next creator who actually has something to show.
    for (let next = index.creator + 1; next < lane.length; next += 1) {
      if (lane[next].moments.length > 0) {
        onIndexChange({ creator: next, moment: 0 });
        return;
      }
    }
    onClose();
  }, [current, index, lane, onClose, onIndexChange]);

  const back = useCallback(() => {
    if (index.moment > 0) {
      onIndexChange({ creator: index.creator, moment: index.moment - 1 });
      return;
    }
    for (let previous = index.creator - 1; previous >= 0; previous -= 1) {
      if (lane[previous].moments.length > 0) {
        onIndexChange({ creator: previous, moment: lane[previous].moments.length - 1 });
        return;
      }
    }
  }, [index, lane, onIndexChange]);

  // Record the view as soon as a Moment is actually on screen.
  useEffect(() => {
    if (moment) onSeen(moment.id, moment.isAuthor);
  }, [moment, onSeen]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
      else if (event.key === "ArrowRight") advance();
      else if (event.key === "ArrowLeft") back();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [advance, back, onClose]);

  if (!moment) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Air Moment from ${moment.authorName}`}
      className="fixed inset-0 z-[60] flex flex-col bg-black/95 pb-[max(1rem,env(safe-area-inset-bottom))] pt-[max(1rem,env(safe-area-inset-top))]"
    >
      {/* Segment bar for this creator's Moments. */}
      <div className="flex shrink-0 gap-1 px-3">
        {current.moments.map((entry, position) => (
          <span
            key={entry.id}
            className={cn(
              "h-0.5 min-w-0 flex-1 rounded-full",
              position <= index.moment ? "bg-white" : "bg-white/30"
            )}
            aria-hidden="true"
          />
        ))}
      </div>

      <div className="flex shrink-0 items-center gap-2.5 px-3 py-2.5">
        <UserAvatar src={moment.authorAvatarUrl} name={moment.authorName} size="sm" decorative membershipTier={publicMembershipTier(moment.authorPlan)} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <p className="truncate text-sm font-semibold text-white">{moment.authorName}</p>
            <PremiumPlanBadge plan={moment.authorPlan} compact className="border-white/25 text-white" />
          </div>
          <p className="text-[0.6875rem] text-white/60">{timeRemainingLabel(moment.expiresAt, nowMs)}</p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="focus-ring grid h-11 w-11 shrink-0 place-items-center rounded-full text-white/80 hover:bg-white/10"
        >
          <X className="h-5 w-5" aria-hidden="true" />
        </button>
      </div>

      <div className="relative flex min-h-0 flex-1 items-center justify-center px-3">
        <div className="w-full max-w-[520px]">
          <MomentMedia moment={moment} onRetry={() => undefined} aspect="portrait" priority />
          {moment.caption ? <p className="mt-2.5 text-sm leading-6 text-white/90">{moment.caption}</p> : null}
        </div>

        {/* Tap zones for previous/next, kept out of the assistive tree since the
            same actions are available as real buttons below. */}
        <button
          type="button"
          onClick={back}
          aria-hidden="true"
          tabIndex={-1}
          className="absolute inset-y-0 left-0 w-1/4"
        />
        <button
          type="button"
          onClick={advance}
          aria-hidden="true"
          tabIndex={-1}
          className="absolute inset-y-0 right-0 w-1/4"
        />
      </div>

      <div className="flex shrink-0 items-center justify-between gap-3 px-3 pt-3">
        <ReactionControl
          moment={moment}
          pending={pending}
          onReact={(reaction) => onReact(moment, reaction)}
          onRemove={() => onRemoveReaction(moment)}
        />
        <div className="flex items-center gap-1.5">
          <Button type="button" variant="ghost" size="sm" className="text-white hover:bg-white/10" onClick={back}>
            Back
          </Button>
          <Button type="button" variant="ghost" size="sm" className="text-white hover:bg-white/10" onClick={advance}>
            Next
          </Button>
        </div>
      </div>
    </div>
  );
}

/** Loads a creator's lane on demand, so nothing is fetched until it is opened. */
export function useTunedInLane(
  fetchMoments: (creatorId: string) => Promise<VisibleMoment[]>
): {
  lane: { entry: TuneInEntry; moments: VisibleMoment[] }[];
  index: { creator: number; moment: number };
  open: (entries: TuneInEntry[], entry: TuneInEntry) => void;
  close: () => void;
  setIndex: (next: { creator: number; moment: number }) => void;
  loading: boolean;
} {
  const [lane, setLane] = useState<{ entry: TuneInEntry; moments: VisibleMoment[] }[]>([]);
  const [index, setIndex] = useState({ creator: 0, moment: 0 });
  const [loading, startLoad] = useTransition();

  const open = useCallback(
    (entries: TuneInEntry[], entry: TuneInEntry) => {
      startLoad(async () => {
        const moments = await fetchMoments(entry.creatorId);
        if (moments.length === 0) {
          // No live Moment: the caller falls back to the creator hub.
          setLane([]);
          return;
        }
        // Only the tapped creator is fetched up front; the rest of the lane is
        // filled lazily as the viewer advances into it.
        const rest = entries.filter((candidate) => candidate.creatorId !== entry.creatorId && candidate.liveMomentCount > 0);
        setLane([{ entry, moments }, ...rest.map((candidate) => ({ entry: candidate, moments: [] }))]);
        setIndex({ creator: 0, moment: 0 });
      });
    },
    [fetchMoments]
  );

  const close = useCallback(() => {
    setLane([]);
    setIndex({ creator: 0, moment: 0 });
  }, []);

  // Fill in the next creator's Moments when the viewer reaches them.
  useEffect(() => {
    const current = lane[index.creator];
    if (!current || current.moments.length > 0) return;
    let cancelled = false;
    void fetchMoments(current.entry.creatorId).then((moments) => {
      if (cancelled) return;
      setLane((existing) =>
        existing.map((slot, position) => (position === index.creator ? { ...slot, moments } : slot))
      );
    });
    return () => {
      cancelled = true;
    };
  }, [lane, index.creator, fetchMoments]);

  return { lane, index, open, close, setIndex, loading };
}
