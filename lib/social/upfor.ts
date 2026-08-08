/**
 * UpFor — pure presentation helpers.
 *
 * "UpFor" is the user-facing name for what the schema still calls a hangout.
 * The rename is deliberately UI-only: `hangout_sessions`, `hangout_requests`,
 * the `/hangout-mode` route, the feature flag and every action name stay
 * exactly as they are. Renaming those would be a migration and an API break
 * for a change that is entirely about what people read on screen.
 */

import { HANGOUT_ACTIVITY_LABELS } from "@/lib/social/plans";
import type { HangoutActivityType } from "@/lib/supabase/database.types";

/** Discovery filters. Ordered as they appear in the row. */
export type UpForFilterId = "all" | "nearby" | "popular" | "for_you";

export const UPFOR_FILTERS: ReadonlyArray<{ id: UpForFilterId; label: string }> = [
  { id: "all", label: "All UpFors" },
  { id: "nearby", label: "Nearby" },
  { id: "popular", label: "Popular" },
  { id: "for_you", label: "Just for you" }
];

/**
 * Time left, in words.
 *
 * An UpFor is temporary — that is the whole point of the feature — so the
 * countdown is the most load-bearing text on the card. Rounded DOWN, so a
 * card never claims more time than it has: "40 min left" on something with
 * 40:59 is honest; on something with 39:01 it is a promise the session cannot
 * keep.
 */
export function upForTimeLeft(endsAt: string, nowMs: number): string | null {
  const msLeft = Date.parse(endsAt) - nowMs;
  if (!Number.isFinite(msLeft) || msLeft <= 0) return null;

  const totalMinutes = Math.floor(msLeft / 60_000);
  if (totalMinutes < 1) return "Ending now";
  if (totalMinutes < 60) return `${totalMinutes} min left`;

  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return minutes === 0 ? `${hours}h left` : `${hours}h ${minutes}m left`;
}

/** True once an UpFor is close enough to ending to be worth flagging. */
export function isEndingSoon(endsAt: string, nowMs: number): boolean {
  const msLeft = Date.parse(endsAt) - nowMs;
  return Number.isFinite(msLeft) && msLeft > 0 && msLeft <= 15 * 60_000;
}

/**
 * "2 going", or null.
 *
 * Never "0 going" and never "1 going": every UpFor has its owner, so one is
 * simply the resting state and stating it makes a new session look empty
 * rather than new.
 */
export function upForGoingLabel(goingCount: number): string | null {
  return goingCount > 1 ? `${goingCount} going` : null;
}

/**
 * The card's title.
 *
 * The mockup shows "Coffee now", "Football now" — the activity plus a word
 * that says this is happening RIGHT NOW, which is what separates an UpFor
 * from a plan. Built from the canonical activity label, never a second
 * vocabulary.
 */
export function upForTitle(activity: HangoutActivityType): string {
  const label = HANGOUT_ACTIVITY_LABELS[activity] ?? "Anything";
  return activity === "anything" ? "Up for anything" : `${label} now`;
}

/**
 * Quick-start ideas.
 *
 * Every id is a real HangoutActivityType, so tapping one opens the setup
 * sheet with that activity already chosen rather than routing somewhere new.
 */
export const UPFOR_QUICK_IDEAS: ReadonlyArray<{ id: HangoutActivityType; label: string; emoji: string }> = [
  { id: "food", label: "Food", emoji: "🍔" },
  { id: "study", label: "Study", emoji: "📚" },
  { id: "walk", label: "Walk", emoji: "👟" },
  { id: "sports", label: "Sports", emoji: "⚽" },
  { id: "gaming", label: "Gaming", emoji: "🎮" },
  { id: "chill", label: "Chill", emoji: "🌙" }
];

/**
 * Apply a discovery filter.
 *
 * "Nearby" and "Just for you" are ABSENT from this switch on purpose. The
 * projection carries a broad area string, not a distance, and there is no
 * recommendation model — so neither filter can be implemented truthfully
 * today. They are rendered disabled with a reason rather than silently
 * returning the unfiltered list, which would look like a working control that
 * does nothing.
 */
export function applyUpForFilter<T extends { goingCount: number }>(
  items: readonly T[],
  filter: UpForFilterId
): T[] {
  if (filter === "popular") {
    // Ordered by who is actually coming. Not a score, not a ranking of
    // people — just the sessions with the most accepted joiners first.
    return [...items].sort((a, b) => b.goingCount - a.goingCount);
  }
  return [...items];
}

/** Which filters the product can honestly offer today. */
export function isUpForFilterAvailable(filter: UpForFilterId): boolean {
  return filter === "all" || filter === "popular";
}
