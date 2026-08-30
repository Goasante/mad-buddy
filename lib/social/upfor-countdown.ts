import { upForPhase, type UpForTiming } from "@/lib/social/upfor-lifecycle";

/**
 * The one line of time an UpFor card shows.
 *
 * ONE LINE, NEVER A STACK. A card that says "Scheduled · Today · 6:00 PM ·
 * Starts in 47m · Upcoming" has said one thing five times. The phase decides
 * which single sentence applies:
 *
 *   scheduled   "Starts in 47m"
 *   live        "42m left"
 *   terminal    nothing at all
 *
 * Derived from the canonical timestamps every time it renders. Nothing is
 * persisted, no timer writes to the database, and the caller re-renders on its
 * own interval -- a minute is plenty for a label whose smallest unit is a
 * minute.
 */
export function upForCountdownLabel(row: UpForTiming, nowMs: number): string | null {
  const phase = upForPhase(row, nowMs);

  // A finished UpFor shows no time. Explicitly returning null here is what
  // stops an expired card from displaying a stale positive countdown that was
  // true when the tab was last awake.
  if (phase === "terminal" || phase === "draft") return null;

  if (phase === "scheduled") {
    const untilStart = Date.parse(row.startsAt) - nowMs;
    // On the boundary the sentence collapses to the single word rather than
    // "Starts in Now", which reads like a bug.
    if (untilStart < 60_000) return "Now";
    return `Starts in ${humanGap(untilStart)}`;
  }

  const untilEnd = Date.parse(row.endsAt) - nowMs;
  // Within the final minute, "0m left" would read as broken. It is still live,
  // so it says so.
  if (untilEnd < 60_000) return "Now";
  return `${humanGap(untilEnd)} left`;
}

/**
 * A gap as the coarsest unit that is still honest.
 *
 * Under a minute is "Now" rather than "0m": at that resolution the difference
 * between 40 seconds and 10 seconds is not information a person can act on, and
 * a ticking seconds display is exactly the kind of restless UI this avoids.
 */
function humanGap(ms: number): string {
  if (ms < 60_000) return "Now";

  const totalMinutes = Math.floor(ms / 60_000);
  if (totalMinutes < 60) return `${totalMinutes}m`;

  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  // Past an hour the minutes stop mattering: "2h" is easier to read than
  // "2h 3m" and is just as actionable.
  return minutes === 0 ? `${hours}h` : `${hours}h ${minutes}m`;
}

/**
 * How often a countdown should be recomputed, in ms.
 *
 * Thirty seconds: the label's smallest unit is a minute, so this guarantees it
 * is never more than half a unit stale, while costing two wakeups a minute
 * rather than sixty. There is no per-second timer and nothing polls the server
 * -- the value is derived from timestamps the client already holds.
 */
export const UPFOR_COUNTDOWN_REFRESH_MS = 30_000;
