import { upForPhase, type UpForTiming } from "@/lib/social/upfor-lifecycle";

/**
 * How the owner's own UpFors are presented, derived from canonical truth.
 *
 * A person may hold up to three at once -- some running, some scheduled for
 * later today. The screen has to make that legible without becoming an
 * administration console, so this module answers only two questions: which
 * order do they go in, and what does each one say about its time.
 *
 * Pure and clock-injected. No stored UI status: live versus scheduled is
 * derived from the timestamps every time, which is what lets a scheduled UpFor
 * become live on its own as the clock passes it, with no refresh and no second
 * source of truth to drift.
 */

export type OwnedUpFor = UpForTiming & {
  id: string;
  activityType: string;
  audienceType: string;
  message: string | null;
  discoveryScope?: string;
  requestCount?: number;
};

export type OwnedUpForView = OwnedUpFor & {
  /** "live" while it runs, "scheduled" before it starts. */
  phase: "live" | "scheduled";
  /** The single line of time this row shows. */
  timeLabel: string;
};

/**
 * Live first, then scheduled by when they begin.
 *
 * Deliberately boring: the owner's own sessions are not a ranked feed, and a
 * clever relevance order would make a person hunt for the one they just made.
 * What is happening now comes first; everything else is a queue in start order.
 */
export function orderOwnedUpFors(rows: readonly OwnedUpFor[], nowMs: number): OwnedUpFor[] {
  return [...rows]
    .filter((row) => {
      const phase = upForPhase(row, nowMs);
      return phase === "live" || phase === "scheduled";
    })
    .sort((a, b) => {
      const aLive = upForPhase(a, nowMs) === "live";
      const bLive = upForPhase(b, nowMs) === "live";
      if (aLive !== bLive) return aLive ? -1 : 1;
      // Live rows: the one ending soonest needs attention first. Scheduled
      // rows: the one starting soonest is the one coming up.
      const key = (row: OwnedUpFor) => Date.parse(aLive ? row.endsAt : row.startsAt);
      const delta = key(a) - key(b);
      // Ties break on id so the list cannot reshuffle on a countdown tick.
      return delta !== 0 ? delta : a.id.localeCompare(b.id);
    });
}

/**
 * The one line of time an owner row shows.
 *
 * "Live now · 42m left" or "Starts 6:30 PM · in 1h 18m" -- the state and the
 * number in one sentence rather than a status pill beside a time beside a
 * countdown, which says the same thing three times.
 *
 * The words "Live now" are load-bearing for accessibility: state must never be
 * carried by colour alone.
 */
export function ownedUpForTimeLabel(row: OwnedUpFor, nowMs: number, locale?: string): string {
  const phase = upForPhase(row, nowMs);

  if (phase === "scheduled") {
    const startsMs = Date.parse(row.startsAt);
    const clock = new Intl.DateTimeFormat(locale, { hour: "numeric", minute: "2-digit" }).format(
      new Date(startsMs)
    );
    const gap = humanGap(startsMs - nowMs);
    return gap ? `Starts ${clock} · in ${gap}` : `Starts ${clock}`;
  }

  const left = humanGap(Date.parse(row.endsAt) - nowMs);
  return left ? `Live now · ${left} left` : "Live now · ending";
}

/** Rows ready to render: ordered, with phase and time line resolved. */
export function ownedUpForViews(
  rows: readonly OwnedUpFor[],
  nowMs: number,
  locale?: string
): OwnedUpForView[] {
  return orderOwnedUpFors(rows, nowMs).map((row) => ({
    ...row,
    phase: upForPhase(row, nowMs) === "live" ? "live" : "scheduled",
    timeLabel: ownedUpForTimeLabel(row, nowMs, locale)
  }));
}

/**
 * Whether another UpFor may be offered.
 *
 * The client uses this only to decide how prominently to invite a fourth. The
 * database still decides whether one may exist -- a client that disagreed
 * would either block something legitimate or promise something the server will
 * refuse.
 */
export const OWNED_UPFOR_LIMIT = 3;

export function canOfferAnotherUpFor(rows: readonly OwnedUpFor[], nowMs: number): boolean {
  return orderOwnedUpFors(rows, nowMs).length < OWNED_UPFOR_LIMIT;
}

/** "2 of 3 today" -- capacity stated plainly, without database vocabulary. */
export function ownedUpForCapacityLabel(rows: readonly OwnedUpFor[], nowMs: number): string {
  return `${orderOwnedUpFors(rows, nowMs).length} of ${OWNED_UPFOR_LIMIT} today`;
}

/** Coarsest honest unit; under a minute reads as "now" rather than "0m". */
function humanGap(ms: number): string {
  if (ms < 60_000) return "";
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours}h` : `${hours}h ${rest}m`;
}
