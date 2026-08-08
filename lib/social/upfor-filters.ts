/**
 * The UpFor filter registry.
 *
 * One place that defines what a filter IS: its id, its label, and the pure
 * predicate that decides whether a session matches. Adding a filter is a new
 * entry here — the page renders whatever the registry contains and never
 * knows a filter by name.
 *
 * Every predicate is a function of its arguments: no clock reads, no network,
 * no React. That is what makes the boundary conditions testable as arithmetic
 * rather than through a rendered component.
 *
 * WHAT IS DELIBERATELY ABSENT, and why:
 *
 *   Popular       — sorting by joiner count is not popularity semantics, and
 *                   the product deliberately has no engagement ranking.
 *   Just for you  — no recommendation model exists.
 *   Starting soon — `starts_at` defaults to now() and no code path ever sets
 *                   it, so every UpFor starts the instant it is created. The
 *                   filter would match everything or nothing, forever.
 *
 * Each of those needs architecture that does not exist yet. A filter that
 * looks live and quietly returns the unfiltered list is worse than one that
 * is simply not there.
 */

import { HANGOUT_ACTIVITY_LABELS } from "@/lib/social/plans";
import type { SocializeAreaTier } from "@/lib/social/socialize";
import { isUpForNearby } from "@/lib/social/upfor";
import type { HangoutActivityType } from "@/lib/supabase/database.types";

/**
 * The shape a filter needs to decide. Deliberately narrower than
 * `VisibleHangout`: a predicate that cannot see a field cannot filter on it,
 * which keeps the registry honest about its own inputs.
 */
export type UpForFilterable = {
  activityType: HangoutActivityType;
  /** Coarse band, or null when unknown. Null never counts as near. */
  areaTier: SocializeAreaTier | null;
  endsAt: string;
  goingCount: number;
  maxParticipants: number;
  myRequestStatus: string | null;
};

export type UpForFilterId = "nearby" | "happening_now" | "has_space" | "joined";

export type UpForFilterDefinition = {
  id: UpForFilterId;
  label: string;
  /** Shown as the control's tooltip, so the rule is never a mystery. */
  description: string;
  matches: (item: UpForFilterable, nowMs: number) => boolean;
};

/**
 * "Happening now" means inside its live window.
 *
 * `starts_at` is not consulted: it defaults to now() and nothing ever sets it,
 * so an UpFor is live from creation until `ends_at`. Reading a column that
 * carries no signal would imply a precision the data does not have.
 */
export function isHappeningNow(item: Pick<UpForFilterable, "endsAt">, nowMs: number): boolean {
  const endsAt = Date.parse(item.endsAt);
  return Number.isFinite(endsAt) && endsAt > nowMs;
}

/**
 * "Has space" compares accepted participants against the owner's own cap.
 *
 * `goingCount` is accepted joiners plus the owner, and `maxParticipants` is
 * the limit the owner set — the same pair `requestHangoutAction` enforces on
 * the server. Capacity is never inferred from how many people asked: pending
 * requests are not attendance, and counting them would hide a session that
 * still has room.
 */
export function hasSpace(item: Pick<UpForFilterable, "goingCount" | "maxParticipants">): boolean {
  return item.goingCount < item.maxParticipants;
}

/**
 * "Joined" is the canonical request state, not a local flag.
 *
 * Only `accepted` counts. A pending request is a question the owner has not
 * answered, and showing it as joined would tell someone they are going
 * somewhere they may yet be declined from.
 */
export function isJoined(item: Pick<UpForFilterable, "myRequestStatus">): boolean {
  return item.myRequestStatus === "accepted";
}

export const UPFOR_FILTERS: ReadonlyArray<UpForFilterDefinition> = [
  {
    id: "nearby",
    label: "Nearby",
    description: "Close by or nearby",
    // Real now: the tier is server-derived and aged out when stale, so this
    // filters on a fact rather than on the area text somebody typed.
    matches: (item) => isUpForNearby(item.areaTier)
  },
  {
    id: "happening_now",
    label: "Happening now",
    description: "Still inside its time window",
    matches: (item, nowMs) => isHappeningNow(item, nowMs)
  },
  {
    id: "has_space",
    label: "Has space",
    description: "Room for one more",
    matches: (item) => hasSpace(item)
  },
  {
    id: "joined",
    label: "Joined",
    description: "You are going to this",
    matches: (item) => isJoined(item)
  }
];

const FILTER_BY_ID = new Map(UPFOR_FILTERS.map((filter) => [filter.id, filter]));

/**
 * Activity is a separate axis from the toggles above.
 *
 * It is a CHOICE of one value rather than a switch, so combining it with the
 * toggles as another boolean would let a user select two activities and match
 * nothing. Kept as its own state, ANDed with the rest.
 *
 * Values come from the existing enum only — no new taxonomy in this stage.
 */
export const UPFOR_ACTIVITIES: ReadonlyArray<{ id: HangoutActivityType; label: string }> = (
  ["anything", "food", "study", "sports", "gym", "walk", "gaming", "chill"] as HangoutActivityType[]
).map((id) => ({ id, label: HANGOUT_ACTIVITY_LABELS[id] ?? id }));

export type UpForFilterState = {
  /** Active toggles. A set, so combining is order-independent. */
  toggles: ReadonlySet<UpForFilterId>;
  /** The chosen activity, or null for any. */
  activity: HangoutActivityType | null;
};

export const EMPTY_UPFOR_FILTERS: UpForFilterState = {
  toggles: new Set<UpForFilterId>(),
  activity: null
};

/**
 * Apply every active filter.
 *
 * AND, not OR: each selection narrows further, which is what "Has space" plus
 * "Joined" has to mean. Returns a NEW array — the caller holds server data and
 * this must never reorder or mutate it.
 */
export function applyUpForFilters<T extends UpForFilterable>(
  items: readonly T[],
  state: UpForFilterState,
  nowMs: number
): T[] {
  return items.filter((item) => {
    if (state.activity !== null && item.activityType !== state.activity) return false;
    for (const id of state.toggles) {
      const filter = FILTER_BY_ID.get(id);
      // An unknown id must not silently pass everything through. It cannot
      // happen through the UI, which renders from the registry, but a stale
      // persisted value could — and a filter that quietly stops filtering is
      // exactly the failure this registry exists to prevent.
      if (!filter || !filter.matches(item, nowMs)) return false;
    }
    return true;
  });
}

/** How many narrowings are active, for the control's badge. */
export function activeFilterCount(state: UpForFilterState): number {
  return state.toggles.size + (state.activity === null ? 0 : 1);
}

/** Toggle one filter, returning new state. Never mutates. */
export function toggleUpForFilter(state: UpForFilterState, id: UpForFilterId): UpForFilterState {
  const toggles = new Set(state.toggles);
  if (toggles.has(id)) toggles.delete(id);
  else toggles.add(id);
  return { ...state, toggles };
}

/** Choose an activity, or clear it by choosing the same one again. */
export function setUpForActivity(
  state: UpForFilterState,
  activity: HangoutActivityType | null
): UpForFilterState {
  return { ...state, activity: state.activity === activity ? null : activity };
}
