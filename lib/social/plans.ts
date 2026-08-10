import { entitlementsFor } from "@/lib/billing/entitlements";
import type {
  HangoutStatus,
  PlanStatus,
  PollSelectionMode,
  RsvpStatus,
  SubscriptionPlan
} from "@/lib/supabase/database.types";

/**
 * Pure domain logic for Plans, RSVP, Plan Polls, and Hangout Mode (feature
 * architecture batch 3). No I/O, every rule here is deterministic and unit
 * tested, so the shared planning service (spec §60) and server actions can
 * depend on one audited source of truth for state machines, tier limits, and
 * poll resolution.
 */

// ---------------------------------------------------------------------------
// Tier limits (spec §11, §51, §61)
// ---------------------------------------------------------------------------

export type PlanTierLimits = {
  maxActivePlans: number; // Infinity = unlimited
  maxPlanParticipants: number;
  maxPollsPerPlan: number;
  maxActiveHangouts: number;
  maxHangoutCapacity: number;
};

/** Derived from the central entitlement registry (batch 10, spec §7). */
export function planTierLimitsFor(plan: SubscriptionPlan): PlanTierLimits {
  const entitlements = entitlementsFor(plan);
  return {
    maxActivePlans: entitlements.max_active_plans,
    maxPlanParticipants: entitlements.max_plan_participants,
    maxPollsPerPlan: entitlements.max_polls_per_plan,
    maxActiveHangouts: entitlements.max_active_hangouts,
    maxHangoutCapacity: entitlements.max_hangout_capacity
  };
}

export const PLAN_TIER_LIMITS: Record<SubscriptionPlan, PlanTierLimits> = {
  free: planTierLimitsFor("free"),
  buddy_plus: planTierLimitsFor("buddy_plus"),
  buddy_pro: planTierLimitsFor("buddy_pro")
};

// ---------------------------------------------------------------------------
// Validation (spec §5, §6, §46)
// ---------------------------------------------------------------------------

export const PLAN_TITLE_MAX_LENGTH = 80;
export const POLL_MIN_OPTIONS = 2;
export const POLL_MAX_OPTIONS = 6;
export const HANGOUT_MAX_DURATION_MS = 12 * 60 * 60 * 1000; // 12 hours

export function validatePlanTitle(title: string): string | null {
  const trimmed = title.trim();
  if (trimmed.length < 1) return "Give your plan a title.";
  if (trimmed.length > PLAN_TITLE_MAX_LENGTH) {
    return `Plan titles are at most ${PLAN_TITLE_MAX_LENGTH} characters.`;
  }
  return null;
}

/** A scheduled plan must start in the future; other types may defer timing. */
export function validatePlanTiming(input: {
  planType: "quick" | "scheduled" | "poll";
  startAtMs: number | null;
  endAtMs: number | null;
  nowMs: number;
}): string | null {
  if (input.planType === "scheduled" && input.startAtMs === null) {
    return "Choose a date and time for this plan.";
  }
  if (input.startAtMs !== null && input.startAtMs <= input.nowMs) {
    return "Choose a start time in the future.";
  }
  if (input.endAtMs !== null && input.startAtMs !== null && input.endAtMs < input.startAtMs) {
    return "The end time can't be before the start time.";
  }
  return null;
}

export function validatePollOptions(labels: string[]): string | null {
  const cleaned = labels.map((label) => label.trim()).filter((label) => label.length > 0);
  if (cleaned.length < POLL_MIN_OPTIONS) return `Add at least ${POLL_MIN_OPTIONS} options.`;
  if (cleaned.length > POLL_MAX_OPTIONS) return `Polls can have at most ${POLL_MAX_OPTIONS} options.`;
  const unique = new Set(cleaned.map((label) => label.toLowerCase()));
  if (unique.size !== cleaned.length) return "Poll options must be different from each other.";
  return null;
}

export function validateHangoutDuration(startMs: number, endMs: number): string | null {
  if (endMs <= startMs) return "Choose an end time after the start.";
  if (endMs - startMs > HANGOUT_MAX_DURATION_MS) return "An UpFor can last at most 12 hours.";
  return null;
}

// ---------------------------------------------------------------------------
// Plan state machine (spec §7)
// ---------------------------------------------------------------------------

const PLAN_TRANSITIONS: Record<PlanStatus, PlanStatus[]> = {
  draft: ["inviting", "polling", "cancelled"],
  inviting: ["polling", "confirmed", "cancelled", "expired"],
  polling: ["confirmed", "cancelled", "expired"],
  confirmed: ["completed", "cancelled"],
  cancelled: [],
  completed: [],
  expired: []
};

export function canTransitionPlan(from: PlanStatus, to: PlanStatus): boolean {
  return PLAN_TRANSITIONS[from]?.includes(to) ?? false;
}

export function isTerminalPlanStatus(status: PlanStatus): boolean {
  return status === "cancelled" || status === "completed" || status === "expired";
}

// ---------------------------------------------------------------------------
// Plan lifecycle: the ONE rule every surface reads
// ---------------------------------------------------------------------------

/**
 * How long an undated plan may sit in Upcoming before it is set aside.
 *
 * WHY UNDATED PLANS EXIST AT ALL. `quick` and `poll` plans are allowed to have
 * no start time -- the schema permits it deliberately (only `scheduled`
 * carries `plans_scheduled_needs_start`), because "let's do something, time
 * TBD" and "vote on when" are the point of those two types. So an undated plan
 * is not corrupt data and must never be treated as such.
 *
 * WHAT WENT WRONG. `isPastPlan` returned false for a null start, so an undated
 * plan could never become past, and the Plans page -- which buckets purely on
 * that helper -- kept it under Upcoming forever. Nine of them are in
 * production right now, across six accounts, up to 23 days old.
 *
 * WHY A DEADLINE RATHER THAN A REQUIRED DATE. Forcing a date on creation would
 * delete the feature: a poll has no date until it resolves. Instead the plan
 * stays live for two weeks, which is long enough to actually agree on a time,
 * and is then set aside rather than deleted.
 *
 * Fourteen days, in one place. Scattering the number is how two surfaces come
 * to disagree about whether the same plan is still live.
 */
export const UNSCHEDULED_PLAN_GRACE_DAYS = 14;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Where a plan sits in time.
 *
 * FOUR PHASES, and every surface derives its own view from this one function
 * rather than re-deciding. The bug this replaces was exactly that: the Home
 * loader filtered in SQL, the Plans page bucketed in the client, and the
 * completion job used a third rule -- so the same plan could be upcoming in
 * one place and past in another.
 */
export type PlanPhase =
  /** Dated, still to happen. */
  | "upcoming"
  /** Dated and finished, or terminal by status. */
  | "past"
  /** No date yet, still inside the grace window. */
  | "unscheduled"
  /** No date, and the grace window has run out. Set aside, never deleted. */
  | "archived_unscheduled";

export type PlanTiming = {
  status: PlanStatus;
  startAt: string | null;
  /** Optional. Most plans have none, which is why the fallback below matters. */
  endAt?: string | null;
  /** When the plan was created. Anchors the grace window for undated plans. */
  createdAt?: string | null;
};

/** Milliseconds, or null when the value is absent or unparseable. */
function parseMs(value: string | null | undefined): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * The canonical phase.
 *
 * TIME IS COMPARED IN ABSOLUTE MILLISECONDS. Every timestamp here is a UTC
 * instant from the database, and `Date.parse` on an ISO string with an offset
 * yields the same number in every timezone -- so a server job in UTC and a
 * browser in Accra or Los Angeles agree on whether a plan has ended. The
 * plan's own `timezone` column is for DISPLAY, and must never be used to
 * decide this.
 */
export function planPhase(plan: PlanTiming, nowMs = Date.now()): PlanPhase {
  // Status wins: a cancelled plan is over whatever its clock says.
  if (isTerminalPlanStatus(plan.status)) return "past";

  const startMs = parseMs(plan.startAt);

  if (startMs === null) {
    // Undated. Live until the grace window closes, then set aside.
    const createdMs = parseMs(plan.createdAt);
    // No creation date to measure from -- keep it visible rather than
    // archiving something on the strength of a missing field.
    if (createdMs === null) return "unscheduled";
    const deadline = createdMs + UNSCHEDULED_PLAN_GRACE_DAYS * DAY_MS;
    return nowMs >= deadline ? "archived_unscheduled" : "unscheduled";
  }

  // END TIME WINS WHERE THERE IS ONE. A plan running 7pm-11pm is still on at
  // 8pm, and treating it as past the moment it starts is what made a plan
  // vanish from Upcoming while people were at it.
  const endMs = parseMs(plan.endAt);
  if (endMs !== null) return nowMs >= endMs ? "past" : "upcoming";

  // No end time -- which is every dated plan in production today. Falls back
  // to the start, so it becomes past once it has begun. Deliberately no grace
  // period: a start-only plan carries no information about how long it runs,
  // and inventing a duration would be a guess applied to every plan alike.
  return nowMs >= startMs ? "past" : "upcoming";
}

/**
 * Past: finished, or terminal by status.
 *
 * KEPT for the surfaces that only need the boolean. The signature widened from
 * (status, startAt) to the timing object so `end_at` could be honoured -- the
 * old two-argument form could not see it, which is why a plan mid-way through
 * its own evening was already being called past.
 */
export function isPastPlan(plan: PlanTiming, nowMs = Date.now()): boolean {
  return planPhase(plan, nowMs) === "past";
}

/**
 * Upcoming: dated, and still to happen.
 *
 * INDEPENDENT OF RSVP by construction -- there is no participant argument.
 * Going, maybe, not going, invited and host all resolve identically, so no
 * caller can accidentally keep a finished plan alive by reading someone's
 * answer to it.
 */
export function isUpcomingPlan(plan: PlanTiming, nowMs = Date.now()): boolean {
  return planPhase(plan, nowMs) === "upcoming";
}

/** Undated and still inside its grace window. */
export function isUnscheduledPlan(plan: PlanTiming, nowMs = Date.now()): boolean {
  return planPhase(plan, nowMs) === "unscheduled";
}

/**
 * Undated, past the grace window, set aside.
 *
 * NOT DELETED and not cancelled: the plan and its conversation stay readable,
 * it simply stops occupying Upcoming and Home. Derived from timestamps at read
 * time, so nothing has to run for it to take effect and nothing has to be
 * undone if the grace period is ever changed.
 */
export function isArchivedUnscheduledPlan(plan: PlanTiming, nowMs = Date.now()): boolean {
  return planPhase(plan, nowMs) === "archived_unscheduled";
}

/**
 * When an undated plan will be set aside, or null if it is not undated.
 *
 * Lets the owner be told "add a time before the 20th" rather than discovering
 * the plan has quietly left Upcoming.
 */
export function unscheduledDeadlineMs(plan: PlanTiming): number | null {
  if (isTerminalPlanStatus(plan.status)) return null;
  if (parseMs(plan.startAt) !== null) return null;
  const createdMs = parseMs(plan.createdAt);
  return createdMs === null ? null : createdMs + UNSCHEDULED_PLAN_GRACE_DAYS * DAY_MS;
}

// ---------------------------------------------------------------------------
// RSVP (spec §8, §22, §23, §30)
// ---------------------------------------------------------------------------

/** The three RSVP choices a participant may set themselves. */
export const RSVP_CHOICES = ["going", "maybe", "not_going"] as const;
export type RsvpChoice = (typeof RSVP_CHOICES)[number];

export function isRsvpChoice(value: string): value is RsvpChoice {
  return (RSVP_CHOICES as readonly string[]).includes(value);
}

export type RsvpAttempt = {
  currentStatus: RsvpStatus;
  desired: RsvpChoice;
  planStatus: PlanStatus;
  rsvpDeadlineMs: number | null;
  nowMs: number;
  /** Going seats already taken by others (excludes this participant). */
  goingCount: number;
  maxParticipants: number;
};

export type RsvpDecision =
  | { allowed: true; status: RsvpChoice; waitlisted: boolean }
  | {
      allowed: false;
      reason: "removed" | "plan_closed" | "deadline_passed";
    };

/**
 * Decides whether a participant may set the desired RSVP now. A "Going"
 * response that would exceed capacity is accepted as waitlisted rather than
 * rejected (spec §26). Deadline and terminal-plan checks come first.
 */
export function resolveRsvp(attempt: RsvpAttempt): RsvpDecision {
  if (attempt.currentStatus === "removed") return { allowed: false, reason: "removed" };
  if (isTerminalPlanStatus(attempt.planStatus)) return { allowed: false, reason: "plan_closed" };

  // Changing away from Going is always allowed even past the deadline; only
  // committing to Going/Maybe is gated by the deadline.
  const isCommitting = attempt.desired === "going" || attempt.desired === "maybe";
  if (isCommitting && attempt.rsvpDeadlineMs !== null && attempt.nowMs > attempt.rsvpDeadlineMs) {
    return { allowed: false, reason: "deadline_passed" };
  }

  if (attempt.desired === "going") {
    const seatsLeft = attempt.maxParticipants - attempt.goingCount;
    const alreadyGoing = attempt.currentStatus === "going";
    // Keep a seat the participant already holds; otherwise waitlist when full.
    const waitlisted = !alreadyGoing && seatsLeft <= 0;
    return { allowed: true, status: "going", waitlisted };
  }

  return { allowed: true, status: attempt.desired, waitlisted: false };
}

// ---------------------------------------------------------------------------
// Poll winner logic (spec §36)
// ---------------------------------------------------------------------------

export type PollTally = {
  optionId: string;
  votes: number;
  /** Comparable ordering value (e.g. ISO time). Lower wins a tie when asked. */
  sortValue?: string | number;
};

export type PollWinner =
  | { resolved: true; winnerId: string; tieBroken: boolean }
  | { resolved: false; reason: "no_votes" | "tie"; tiedOptionIds: string[] };

/**
 * Resolves a poll's winning option. With a clear plurality, returns it. On a
 * tie, defers to the host by default (resolved:false, reason:"tie"); when
 * `tieBreak` is "earliest" (time/date polls) the tied option with the lowest
 * sortValue wins instead, matching spec §36's "choose earliest time among
 * tied options."
 */
export function resolvePollWinner(
  tallies: PollTally[],
  tieBreak: "host" | "earliest" = "host"
): PollWinner {
  const maxVotes = tallies.reduce((max, tally) => Math.max(max, tally.votes), 0);
  if (maxVotes === 0) return { resolved: false, reason: "no_votes", tiedOptionIds: [] };

  const leaders = tallies.filter((tally) => tally.votes === maxVotes);
  if (leaders.length === 1) return { resolved: true, winnerId: leaders[0].optionId, tieBroken: false };

  if (tieBreak === "earliest" && leaders.every((leader) => leader.sortValue !== undefined)) {
    const earliest = [...leaders].sort((a, b) =>
      a.sortValue! < b.sortValue! ? -1 : a.sortValue! > b.sortValue! ? 1 : 0
    )[0];
    return { resolved: true, winnerId: earliest.optionId, tieBroken: true };
  }

  return { resolved: false, reason: "tie", tiedOptionIds: leaders.map((leader) => leader.optionId) };
}

/** Single-choice polls store one vote per user; multiple-choice may store many. */
export function maxVotesPerUser(mode: PollSelectionMode): number {
  return mode === "single" ? 1 : POLL_MAX_OPTIONS;
}

// ---------------------------------------------------------------------------
// Hangout Mode state machine (spec §50)
// ---------------------------------------------------------------------------

const HANGOUT_TRANSITIONS: Record<HangoutStatus, HangoutStatus[]> = {
  draft: ["active", "cancelled"],
  active: ["paused", "full", "expired", "cancelled", "converted_to_plan"],
  paused: ["active", "expired", "cancelled"],
  full: ["active", "expired", "cancelled", "converted_to_plan"],
  expired: [],
  cancelled: [],
  converted_to_plan: []
};

export function canTransitionHangout(from: HangoutStatus, to: HangoutStatus): boolean {
  return HANGOUT_TRANSITIONS[from]?.includes(to) ?? false;
}

export function isHangoutJoinable(status: HangoutStatus, endsAtMs: number, nowMs: number): boolean {
  if (status !== "active") return false;
  return endsAtMs > nowMs;
}

// ---------------------------------------------------------------------------
// Labels (presentation helpers kept pure for reuse + testing)
// ---------------------------------------------------------------------------

export const RSVP_LABELS: Record<RsvpChoice, string> = {
  going: "Going",
  maybe: "Maybe",
  not_going: "Can't make it"
};

export const HANGOUT_ACTIVITY_LABELS: Record<string, string> = {
  food: "Food",
  study: "Study",
  sports: "Sports",
  gym: "Gym",
  walk: "Walk",
  gaming: "Gaming",
  chill: "Chill",
  anything: "Open to anything"
};
