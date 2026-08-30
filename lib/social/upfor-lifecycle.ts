/**
 * The single place that answers "what phase is this UpFor in?".
 *
 * SCHEDULING CHANGED WHAT `status = 'active'` MEANS. It used to imply "happening
 * now", because `starts_at` always defaulted to `now()`. With "Later today" a
 * future UpFor is stored as `active` too, and only the clock separates the two:
 *
 *   SCHEDULED   now < starts_at
 *   LIVE        starts_at <= now < ends_at
 *   TERMINAL    status in (expired, cancelled, converted_to_plan)
 *
 * There is deliberately NO stored `scheduled` status. The timestamps already
 * carry that fact, and a second copy of it would drift the moment a sweep ran
 * late. This module is the derivation, so no surface re-invents it.
 *
 * Pure: no Supabase, no clock of its own -- every function takes `nowMs`, so the
 * whole lifecycle is testable without a database.
 */

/** Statuses that represent a live intent the owner still holds. */
export const LIVE_UPFOR_STATUSES = ["active", "paused", "full"] as const;

/** Statuses that represent a finished intent. A slot is freed the moment one applies. */
export const TERMINAL_UPFOR_STATUSES = ["expired", "cancelled", "converted_to_plan"] as const;

export type UpForStatus =
  | (typeof LIVE_UPFOR_STATUSES)[number]
  | (typeof TERMINAL_UPFOR_STATUSES)[number]
  | "draft";

export type UpForPhase = "draft" | "scheduled" | "live" | "terminal";

export type UpForTiming = {
  status: string;
  startsAt: string;
  endsAt: string;
};

/**
 * Whether this row consumes one of the owner's concurrent slots.
 *
 * The rule is "a live intent the owner currently holds", which covers BOTH a
 * scheduled UpFor and a running one: having committed to something at 18:00 is
 * as real a commitment as being out right now.
 *
 *   draft              NO   never published; not an intent anyone can see
 *   active  (future)   YES  scheduled -- a commitment already made
 *   active  (current)  YES  running
 *   paused             YES  live intent, temporarily not accepting -- the owner
 *                           can resume it, so the slot is still spoken for
 *   full               YES  live intent at capacity -- still visible, still
 *                           running, and it frees itself when it ends
 *   expired            NO   terminal
 *   cancelled          NO   terminal
 *   converted_to_plan  NO   terminal -- the intent became a Plan
 *
 * `paused` and `full` count precisely because they are NOT terminal: excluding
 * them would let someone hold unlimited sessions by pausing each one.
 *
 * Mirrors the SQL in `create_upfor_session`, which is the enforcing authority;
 * this is the read-side agreement with it.
 */
export function consumesUpForSlot(row: UpForTiming, nowMs: number): boolean {
  if (!(LIVE_UPFOR_STATUSES as readonly string[]).includes(row.status)) return false;
  const endsMs = Date.parse(row.endsAt);
  return Number.isFinite(endsMs) && endsMs > nowMs;
}

export function upForPhase(row: UpForTiming, nowMs: number): UpForPhase {
  if (row.status === "draft") return "draft";
  if ((TERMINAL_UPFOR_STATUSES as readonly string[]).includes(row.status)) return "terminal";

  const startsMs = Date.parse(row.startsAt);
  const endsMs = Date.parse(row.endsAt);

  // A row whose timestamps cannot be read is treated as terminal rather than
  // published: the safe direction is showing nothing, not showing something
  // whose window nobody can evaluate.
  if (!Number.isFinite(startsMs) || !Number.isFinite(endsMs)) return "terminal";

  if (endsMs <= nowMs) return "terminal";
  if (nowMs < startsMs) return "scheduled";
  return "live";
}

/**
 * Whether this UpFor may appear on a DISCOVERY surface.
 *
 * Discovery is publication: the nearby feed, a Muddy's list of what people are
 * up to. A scheduled UpFor must NOT appear here before it starts, or creating
 * one at 14:00 for 18:00 broadcasts it four hours early -- which the owner did
 * not ask for. Enforced in RLS as well; this keeps application reads agreeing
 * with the database rather than relying on it alone.
 */
export function isDiscoverableUpFor(row: UpForTiming, nowMs: number): boolean {
  return upForPhase(row, nowMs) === "live" && row.status === "active";
}

/**
 * Whether this UpFor belongs in Home's "Coming Up".
 *
 * DELIBERATELY NOT `consumesUpForSlot`. Slot accounting and presentation are
 * different questions, and they disagree on purpose:
 *
 *   paused   spends a slot (it is a live intent the owner still holds, and if
 *            pausing freed a slot somebody could hold unlimited sessions) but
 *            is NOT coming up -- it is not accepting anyone
 *   full     spends a slot but is NOT coming up -- there is no room in it
 *
 * So this requires `active` specifically, not merely "not terminal". Home lists
 * what a person is actually waiting for, not what is occupying a slot.
 */
export function isComingUpUpFor(row: UpForTiming, nowMs: number): boolean {
  return row.status === "active" && upForPhase(row, nowMs) === "scheduled";
}

/**
 * Whether the OWNER should see it on their own management surface.
 *
 * Broader than discovery on purpose: you must be able to see, edit and cancel
 * the UpFor you scheduled for 18:00 before 18:00 arrives.
 */
export function isOwnerVisibleUpFor(row: UpForTiming, nowMs: number): boolean {
  const phase = upForPhase(row, nowMs);
  return phase === "scheduled" || phase === "live";
}
