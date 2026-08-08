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
import type { SocializeAreaTier } from "@/lib/social/socialize";
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

/**
 * What an UpFor is doing right now, as one value.
 *
 * Derived from the SERVER's timestamps and status, never from a client timer.
 * The page ticks a clock so the countdown moves between refreshes, but that
 * clock only re-evaluates this function — it is never the authority for
 * whether something is still open.
 */
export type UpForLiveState = "live" | "full" | "ended";

export function upForLiveState(
  session: { endsAt: string; goingCount: number; maxParticipants: number },
  nowMs: number
): UpForLiveState {
  const endsAt = Date.parse(session.endsAt);
  // An unparseable date is treated as over rather than open: failing closed on
  // a join control is the safe direction.
  if (!Number.isFinite(endsAt) || endsAt <= nowMs) return "ended";
  if (session.goingCount >= session.maxParticipants) return "full";
  return "live";
}

/**
 * Spots left, or null when the numbers do not produce a useful statement.
 *
 * Returns null at full (the state says that already) and above three, where
 * "5 spots left" is noise rather than information. No manufactured scarcity:
 * "1 spot left" appears only when exactly one seat genuinely remains.
 */
export function upForSpotsLeft(session: {
  goingCount: number;
  maxParticipants: number;
}): number | null {
  const left = session.maxParticipants - session.goingCount;
  if (left <= 0 || left > 3) return null;
  return left;
}

/** "Ends at 7:30 PM" — the fixed clock time, alongside the relative countdown. */
export function upForEndsAtLabel(endsAt: string): string | null {
  const parsed = Date.parse(endsAt);
  if (!Number.isFinite(parsed)) return null;
  return new Date(parsed).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

/**
 * Which action the viewer can take, decided once and reused by card and sheet.
 *
 * The viewer's own UpFor is never joinable; an ended or full session offers
 * nothing; and everything else follows the canonical request lifecycle from
 * Stage 3. The sheet renders what this returns rather than re-deriving the
 * rules, so the two surfaces can never disagree about what is possible.
 */
export type UpForViewerAction = "own" | "join" | "cancel_request" | "leave" | "unavailable";

export function upForViewerAction(
  session: {
    ownerId: string;
    allowPings: boolean;
    myRequestStatus: string | null;
    endsAt: string;
    goingCount: number;
    maxParticipants: number;
  },
  viewerId: string | null,
  nowMs: number
): UpForViewerAction {
  if (viewerId && session.ownerId === viewerId) return "own";

  // Withdrawing stays available even once full or ended: someone who joined
  // must always be able to say they are not coming.
  if (session.myRequestStatus === "accepted") return "leave";
  if (session.myRequestStatus === "pending") return "cancel_request";

  const state = upForLiveState(session, nowMs);
  if (state !== "live") return "unavailable";
  if (!session.allowPings) return "unavailable";
  return "join";
}

// ---------------------------------------------------------------------------
// Coarse place
// ---------------------------------------------------------------------------

/**
 * How near an UpFor is, in words.
 *
 * The vocabulary is Linkr's `SocializeAreaTier` — `close_by`, `nearby`,
 * `wider_area` — reused rather than reinvented, so one idea has one set of
 * words across the product.
 *
 * `null` means "we do not know", which is a real and common state: the
 * creator may have no location, or one too old to stand behind. It is
 * deliberately NOT rendered as "far away" — silence is honest where a guess
 * would not be.
 */
export type UpForAreaTier = SocializeAreaTier | null;

export const UPFOR_TIER_LABELS: Record<SocializeAreaTier, string> = {
  close_by: "Close by",
  nearby: "Nearby",
  wider_area: "Around your area"
};

/**
 * The ONE formatter for an UpFor's place, used by both the card and the sheet.
 *
 * Two independent formatters would eventually disagree, and a card saying
 * "Close by" over a sheet saying "Nearby" is the kind of contradiction that
 * makes every other number on the screen suspect.
 *
 * Either part may be missing. The broad area is text the creator typed, so it
 * survives a stale location; the tier does not, because it is a claim about
 * right now.
 */
export function upForPlaceLabel(place: {
  broadAreaText: string | null;
  areaTier: UpForAreaTier;
}): string | null {
  const area = place.broadAreaText?.trim() || null;
  const tier = place.areaTier ? UPFOR_TIER_LABELS[place.areaTier] : null;

  if (area && tier) return `${area} · ${tier}`;
  return area ?? tier;
}

/**
 * Which tiers count as "Nearby" for the filter.
 *
 * `wider_area` is excluded on purpose: it is the widest band the product has,
 * and a Nearby filter that admits it would return almost everything, which is
 * indistinguishable from no filter at all.
 *
 * A null tier never qualifies. Unknown is not near.
 */
export const UPFOR_NEARBY_TIERS: ReadonlyArray<SocializeAreaTier> = ["close_by", "nearby"];

export function isUpForNearby(areaTier: UpForAreaTier): boolean {
  return areaTier !== null && UPFOR_NEARBY_TIERS.includes(areaTier);
}
