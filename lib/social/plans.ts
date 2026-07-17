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
 * architecture batch 3). No I/O — every rule here is deterministic and unit
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
  if (endMs - startMs > HANGOUT_MAX_DURATION_MS) return "Hangout sessions can last at most 12 hours.";
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
