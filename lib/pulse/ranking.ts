/**
 * The Pulse ranking core (feature architecture batch 4, spec §4, §5). Pure,
 * explainable priority scoring so the home screen orders items by usefulness,
 * never by opaque popularity signals. The aggregation service assigns each
 * item a PulseItem and calls rankPulseItems; all authorization happens before
 * items reach here.
 */

export type PulseItemType =
  | "meeting_ping"
  | "plan_starting_soon"
  | "plan_invite"
  | "poll_closing"
  | "proximity"
  | "wave"
  | "hangout"
  | "circle_activity";

export type PulseItem = {
  id: string;
  type: PulseItemType;
  /** Base priority from the type (spec §4 ordering). Higher = more urgent. */
  priority: number;
  createdAtMs: number;
  expiresAtMs: number | null;
  /** Optional modifiers used to break ties within a type. */
  isCloseFriend?: boolean;
  isVeryClose?: boolean;
  unread?: boolean;
  data?: Record<string, unknown>;
};

// Base priority bands from the spec §4 priority model (strongest first).
export const PULSE_BASE_PRIORITY: Record<PulseItemType, number> = {
  meeting_ping: 90,
  plan_starting_soon: 85,
  plan_invite: 80,
  proximity: 70, // very-close nudged above nearby via the isVeryClose modifier
  wave: 60,
  hangout: 55,
  poll_closing: 50,
  circle_activity: 30
};

export function basePriorityFor(type: PulseItemType): number {
  return PULSE_BASE_PRIORITY[type] ?? 0;
}

/**
 * Effective score = base priority + small, explainable modifiers. Close-friend
 * and very-close nudges are deliberately small so they refine order within a
 * band without letting a low-urgency item leapfrog a high-urgency one.
 */
export function effectiveScore(item: PulseItem): number {
  let score = item.priority;
  if (item.isVeryClose) score += 6;
  if (item.isCloseFriend) score += 4;
  if (item.unread) score += 2;
  return score;
}

/** Whether an item is still current at `nowMs` (expired items drop out). */
export function isPulseItemLive(item: PulseItem, nowMs: number): boolean {
  return item.expiresAtMs === null || item.expiresAtMs > nowMs;
}

/**
 * Ranks live items by effective score, then by recency, then by id for a
 * stable, deterministic order (spec §14: ranking must be stable). Expired
 * items are removed. Never mutates the input.
 */
export function rankPulseItems(items: PulseItem[], nowMs: number): PulseItem[] {
  return items
    .filter((item) => isPulseItemLive(item, nowMs))
    .map((item) => ({ item, score: effectiveScore(item) }))
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      if (b.item.createdAtMs !== a.item.createdAtMs) return b.item.createdAtMs - a.item.createdAtMs;
      return a.item.id < b.item.id ? -1 : a.item.id > b.item.id ? 1 : 0;
    })
    .map((entry) => entry.item);
}
