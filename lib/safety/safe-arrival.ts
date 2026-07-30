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
  if (count < 1) return "Choose at least one Muddy to watch over your journey.";
  if (count > limits.maxContacts) {
    return plan === "free"
      ? `Your plan lets ${limits.maxContacts} Muddies watch over a journey. Upgrade to choose more.`
      : `You can choose up to ${limits.maxContacts} Muddies.`;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Arrival-time composition
// ---------------------------------------------------------------------------

/**
 * Combines a calendar day with a wall-clock time into an instant, in the
 * VIEWER's own timezone.
 *
 * This exists because the previous setup form built its timestamp from two
 * independent `<input type="date">` / `<input type="time">` fields and required
 * BOTH to be filled. The date defaulted to empty, so a traveller who only set a
 * time ("I'll be there by 9") produced no timestamp at all and Start stayed
 * disabled with nothing explaining why. Reaching for tomorrow happened to open
 * the date picker, which populated the missing field, which is why later-today
 * appeared broken while next-day worked. Day is now always known (today by
 * default), so a time alone is always sufficient.
 *
 * `dayOffset` is 0 for today and 1 for tomorrow. `time` is "HH:MM" (24h, as
 * emitted by <input type="time">). Returns NaN when the time is unparseable.
 */
export function composeArrivalMs(input: {
  dayOffset: number;
  time: string;
  /** The viewer's "now"; the day offset is applied to ITS local calendar day. */
  nowMs: number;
}): number {
  const match = /^(\d{1,2}):(\d{2})$/.exec(input.time.trim());
  if (!match) return Number.NaN;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return Number.NaN;

  // Built via the local-time Date constructor, so the result is the correct
  // instant in whatever zone the traveller is in (Africa/Accra included) and
  // survives conversion to UTC for storage. Day arithmetic goes through
  // setDate, which handles month/year rollover and DST shifts for us.
  const base = new Date(input.nowMs);
  const composed = new Date(base.getFullYear(), base.getMonth(), base.getDate(), hours, minutes, 0, 0);
  composed.setDate(composed.getDate() + input.dayOffset);
  return composed.getTime();
}

/**
 * "in 2h 15m" / "in 45 min". Deliberately duration-only: it says how long the
 * journey has, never where anyone is.
 */
export function durationUntilLabel(targetMs: number, nowMs: number): string | null {
  const totalMinutes = Math.round((targetMs - nowMs) / 60_000);
  if (!Number.isFinite(totalMinutes) || totalMinutes <= 0) return null;
  if (totalMinutes < 60) return `${totalMinutes} min`;
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return minutes === 0 ? `${hours}h` : `${hours}h ${minutes}m`;
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

/**
 * The watcher-facing notification set: one title/message pair per lifecycle
 * event. Centralised so the traveller's screen, the watcher's screen, and the
 * overdue job all describe the same event identically, and so the privacy rule
 * is enforced in one place: a notification may name the destination LABEL, the
 * expected time, and the status. Never a position, distance, route, or speed.
 *
 * `timeLabel` is pre-formatted by the caller in the RECIPIENT-neutral way the
 * rest of the app formats times, and is optional so a missing time degrades to
 * a still-useful message rather than "undefined".
 */
export type SafeArrivalNotificationEvent = "started" | "extended" | "overdue" | "arrived" | "cancelled";

export function safeArrivalNotification(
  event: SafeArrivalNotificationEvent,
  input: { travellerName: string; destinationLabel?: string; timeLabel?: string }
): { title: string; message: string } {
  const who = input.travellerName;
  switch (event) {
    case "started":
      return {
        title: `${who} started Safe Arrival`,
        message:
          input.destinationLabel && input.timeLabel
            ? `Expected at ${input.destinationLabel} by ${input.timeLabel}.`
            : `${who} asked you to check they get there safely.`
      };
    case "extended":
      return {
        title: `${who} updated their arrival time`,
        message: input.timeLabel ? `New expected arrival: ${input.timeLabel}.` : `${who} needs a little longer.`
      };
    case "overdue":
      // Neutral by construction (spec §9): the confirmation simply has not
      // landed. Never "missing", never an emergency.
      return {
        title: `${who} hasn't confirmed arrival yet`,
        message: input.timeLabel ? `Expected arrival was ${input.timeLabel}.` : unconfirmedAlertMessage(who)
      };
    case "arrived":
      return { title: `${who} has arrived safely`, message: arrivedMessage(who) };
    case "cancelled":
      return { title: "Safe Arrival ended", message: `${who} ended Safe Arrival.` };
  }
}

/** Sent to the traveller when a chosen contact accepts. No location, ever. */
export function watcherAcceptedMessage(watcherName: string): string {
  return `${watcherName} is watching your journey.`;
}

/** Sent to watchers when the traveller ends the session. No location, ever. */
export function cancelledMessage(travellerName: string): string {
  return `${travellerName}'s Safe Arrival was cancelled.`;
}
