import { entitlementsFor } from "@/lib/billing/entitlements";
import type { SafeArrivalStatus, SubscriptionPlan } from "@/lib/supabase/database.types";

/**
 * Safe Arrival domain core (feature architecture batch 5, spec §2-§19).
 * Pure, deterministic logic for the safety workflow: contact limits, timing
 * validation, the session state machine, and grace-period resolution. No I/O.
 *
 * Two rules are load-bearing and encoded here rather than in callers:
 *  - Nothing in this module ever touches location. A Safe Arrival carries a
 *    destination *label* only (spec §6, §7).
 *  - The unconfirmed alert is neutral by construction (spec §9): it reports
 *    "hasn't confirmed yet", never "missing", and never implies an emergency.
 */

// ---------------------------------------------------------------------------
// Tier limits (spec §17, §62)
// ---------------------------------------------------------------------------

export type SafeArrivalLimits = {
  maxContacts: number;
  maxActiveSessions: number;
};

/** Derived from the central entitlement registry (batch 10, spec §7). */
export function safeArrivalLimitsFor(plan: SubscriptionPlan): SafeArrivalLimits {
  const entitlements = entitlementsFor(plan);
  return {
    maxContacts: entitlements.max_safe_arrival_contacts,
    maxActiveSessions: entitlements.max_active_safe_arrivals
  };
}

export const SAFE_ARRIVAL_LIMITS: Record<SubscriptionPlan, SafeArrivalLimits> = {
  free: safeArrivalLimitsFor("free"),
  buddy_plus: safeArrivalLimitsFor("buddy_plus"),
  buddy_pro: safeArrivalLimitsFor("buddy_pro")
};

// ---------------------------------------------------------------------------
// Validation (spec §5, §14)
// ---------------------------------------------------------------------------

export const DESTINATION_LABEL_MAX_LENGTH = 120;
export const GRACE_PERIOD_MIN_MINUTES = 5;
export const GRACE_PERIOD_MAX_MINUTES = 120;
/** A session can't be scheduled absurdly far out; it's a journey, not a plan. */
export const MAX_EXPECTED_ARRIVAL_AHEAD_MS = 24 * 60 * 60 * 1000;

export function validateDestinationLabel(label: string): string | null {
  const trimmed = label.trim();
  if (trimmed.length < 1) return "Where are you heading?";
  if (trimmed.length > DESTINATION_LABEL_MAX_LENGTH) {
    return `Destination is at most ${DESTINATION_LABEL_MAX_LENGTH} characters.`;
  }
  return null;
}

export function validateExpectedArrival(expectedArrivalMs: number, nowMs: number): string | null {
  if (!Number.isFinite(expectedArrivalMs)) return "Choose an expected arrival time.";
  if (expectedArrivalMs <= nowMs) return "Choose an arrival time in the future.";
  if (expectedArrivalMs - nowMs > MAX_EXPECTED_ARRIVAL_AHEAD_MS) {
    return "Safe Arrival covers journeys within the next 24 hours.";
  }
  return null;
}

export function validateGracePeriod(minutes: number): string | null {
  if (!Number.isInteger(minutes)) return "Choose a grace period.";
  if (minutes < GRACE_PERIOD_MIN_MINUTES || minutes > GRACE_PERIOD_MAX_MINUTES) {
    return `Grace period must be between ${GRACE_PERIOD_MIN_MINUTES} and ${GRACE_PERIOD_MAX_MINUTES} minutes.`;
  }
  return null;
}

export function validateContactCount(count: number, plan: SubscriptionPlan): string | null {
  const limits = safeArrivalLimitsFor(plan);
  if (count < 1) return "Choose at least one trusted contact.";
  if (count > limits.maxContacts) {
    return plan === "free"
      ? `Free plan allows up to ${limits.maxContacts} trusted contacts. Upgrade for more.`
      : `You can choose up to ${limits.maxContacts} trusted contacts.`;
  }
  return null;
}

// ---------------------------------------------------------------------------
// State machine (spec §11)
// ---------------------------------------------------------------------------

const SAFE_ARRIVAL_TRANSITIONS: Record<SafeArrivalStatus, SafeArrivalStatus[]> = {
  draft: ["pending_acknowledgement", "active", "cancelled"],
  pending_acknowledgement: ["active", "cancelled", "expired"],
  active: ["grace_period", "extended", "completed", "cancelled"],
  grace_period: ["extended", "completed", "cancelled", "unconfirmed"],
  extended: ["grace_period", "completed", "cancelled", "unconfirmed"],
  unconfirmed: ["completed", "cancelled"],
  completed: [],
  cancelled: [],
  expired: []
};

export function canTransitionSafeArrival(from: SafeArrivalStatus, to: SafeArrivalStatus): boolean {
  return SAFE_ARRIVAL_TRANSITIONS[from]?.includes(to) ?? false;
}

export function isTerminalSafeArrivalStatus(status: SafeArrivalStatus): boolean {
  return status === "completed" || status === "cancelled" || status === "expired";
}

/**
 * Only the traveller may confirm/cancel/extend their own session (spec §14).
 * Every non-terminal status still allows action, including `unconfirmed`, so
 * a late "I've arrived" always lands rather than being rejected.
 */
export function canTravellerAct(status: SafeArrivalStatus): boolean {
  return !isTerminalSafeArrivalStatus(status);
}

// ---------------------------------------------------------------------------
// Grace-period resolution (spec §8, §9)
// ---------------------------------------------------------------------------

export type SafeArrivalPhase = "before_expected" | "grace_period" | "overdue";

export type SafeArrivalTiming = {
  expectedArrivalMs: number;
  gracePeriodMinutes: number;
  nowMs: number;
};

export function gracePeriodEndMs(timing: Pick<SafeArrivalTiming, "expectedArrivalMs" | "gracePeriodMinutes">): number {
  return timing.expectedArrivalMs + timing.gracePeriodMinutes * 60 * 1000;
}

/**
 * Where a live session sits relative to its expected arrival. `overdue` means
 * the grace period has fully elapsed without confirmation, the point at which
 * contacts get the neutral unconfirmed alert.
 */
export function resolveSafeArrivalPhase(timing: SafeArrivalTiming): SafeArrivalPhase {
  if (timing.nowMs < timing.expectedArrivalMs) return "before_expected";
  if (timing.nowMs < gracePeriodEndMs(timing)) return "grace_period";
  return "overdue";
}

/**
 * Should the neutral "hasn't confirmed yet" alert fire now? Requires: a live
 * (non-terminal, unconfirmed) session, the grace period fully elapsed, and no
 * prior alert, so it fires at most once per session (spec §9, §16).
 */
export function shouldSendUnconfirmedAlert(input: {
  status: SafeArrivalStatus;
  alreadyNotified: boolean;
  timing: SafeArrivalTiming;
}): boolean {
  if (input.alreadyNotified) return false;
  if (isTerminalSafeArrivalStatus(input.status) || input.status === "unconfirmed") return false;
  if (input.status === "draft" || input.status === "pending_acknowledgement") return false;
  return resolveSafeArrivalPhase(input.timing) === "overdue";
}

/** Extending pushes expected arrival out; the grace period restarts from it. */
export function extendedArrivalMs(currentExpectedMs: number, extraMinutes: number, nowMs: number): number {
  // Extend from whichever is later: the original time or now. Extending an
  // already-overdue session from the stale original would re-fire instantly.
  const base = Math.max(currentExpectedMs, nowMs);
  return base + extraMinutes * 60 * 1000;
}

export const EXTENSION_OPTIONS_MINUTES = [10, 20, 30, 60] as const;

export function validateExtension(minutes: number): string | null {
  return (EXTENSION_OPTIONS_MINUTES as readonly number[]).includes(minutes)
    ? null
    : "Choose a valid extension.";
}

// ---------------------------------------------------------------------------
// Neutral copy (spec §9, never alarmist, never "missing")
// ---------------------------------------------------------------------------

export function unconfirmedAlertMessage(travellerName: string): string {
  return `${travellerName} has not confirmed arrival yet.`;
}

export function arrivedMessage(travellerName: string): string {
  return `${travellerName} has arrived safely.`;
}

export function extendedMessage(travellerName: string, extraMinutes: number): string {
  return `${travellerName} needs ${extraMinutes} more minutes.`;
}
