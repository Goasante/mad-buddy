import type {
  EventCircleRole,
  EventCircleStatus,
  EventStatus,
  SubscriptionPlan
} from "@/lib/supabase/database.types";

/**
 * Events domain core (feature architecture batch 5): check-in windows, Event
 * Glow eligibility, and Temporary Event Circle lifecycle/roles. Pure and
 * deterministic — the server services layer supplies the facts, this decides.
 *
 * Event Glow's defining rule (spec §34) lives here: presence is *asserted* by
 * a voluntary check-in, never inferred from device proximity. Nothing in this
 * module accepts coordinates.
 */

// ---------------------------------------------------------------------------
// Check-in window (spec §25, §26)
// ---------------------------------------------------------------------------

export type CheckInWindowInput = {
  eventStatus: EventStatus;
  startsAtMs: number;
  endsAtMs: number;
  opensMinutesBefore: number;
  nowMs: number;
};

export type CheckInWindowReason = "allowed" | "event_cancelled" | "too_early" | "event_ended";

export type CheckInWindowResult = {
  allowed: boolean;
  reason: CheckInWindowReason;
};

/**
 * Check-in is permitted from `opensMinutesBefore` ahead of the start until the
 * event ends. Deliberately refuses days-in-advance check-in (spec §25) — a
 * check-in must mean "I am here now".
 */
export function resolveCheckInWindow(input: CheckInWindowInput): CheckInWindowResult {
  if (input.eventStatus === "cancelled" || input.eventStatus === "draft") {
    return { allowed: false, reason: "event_cancelled" };
  }
  if (input.nowMs > input.endsAtMs || input.eventStatus === "ended") {
    return { allowed: false, reason: "event_ended" };
  }
  const opensAtMs = input.startsAtMs - input.opensMinutesBefore * 60 * 1000;
  if (input.nowMs < opensAtMs) return { allowed: false, reason: "too_early" };
  return { allowed: true, reason: "allowed" };
}

// ---------------------------------------------------------------------------
// Event Glow eligibility (spec §34, §37, §44)
// ---------------------------------------------------------------------------

export type EventGlowInput = {
  /** Both users must have a live check-in for the same event. */
  viewerCheckedIn: boolean;
  targetCheckedIn: boolean;
  /** The target opted their check-in into Event Glow. */
  targetGlowEnabled: boolean;
  targetVisibility: CheckInVisibilityLike;
  areApprovedMuddies: boolean;
  isBlockedEitherDirection: boolean;
  /** Ghost Mode overrides Event Glow entirely (spec §37). */
  targetGhostMode: boolean;
  eventActive: boolean;
};

type CheckInVisibilityLike = "private" | "participants" | "selected_muddies" | "anonymous_count";

export type EventGlowResult = {
  visible: boolean;
  reason:
    | "not_checked_in"
    | "target_not_present"
    | "glow_disabled"
    | "private_check_in"
    | "not_muddies"
    | "blocked"
    | "ghost_mode"
    | "event_inactive"
    | "visible";
};

/**
 * Decides whether `viewer` may see `target` in an event's Glow list. Strongest
 * deny first, mirroring the batch-2 precedence chain. A target who checked in
 * privately or disabled Glow is simply absent — the caller must not disclose
 * that they are present at all (spec §41).
 */
export function resolveEventGlow(input: EventGlowInput): EventGlowResult {
  if (input.isBlockedEitherDirection) return { visible: false, reason: "blocked" };
  if (!input.areApprovedMuddies) return { visible: false, reason: "not_muddies" };
  if (!input.eventActive) return { visible: false, reason: "event_inactive" };
  // Glow requires the *viewer* to be present too: it answers "who else is
  // here", not "who is at events I'm not attending".
  if (!input.viewerCheckedIn) return { visible: false, reason: "not_checked_in" };
  if (!input.targetCheckedIn) return { visible: false, reason: "target_not_present" };
  if (input.targetGhostMode) return { visible: false, reason: "ghost_mode" };
  if (!input.targetGlowEnabled) return { visible: false, reason: "glow_disabled" };
  if (input.targetVisibility === "private" || input.targetVisibility === "anonymous_count") {
    return { visible: false, reason: "private_check_in" };
  }
  return { visible: true, reason: "visible" };
}

// ---------------------------------------------------------------------------
// Event Circle lifecycle + roles (spec §47, §49, §51)
// ---------------------------------------------------------------------------

const EVENT_CIRCLE_TRANSITIONS: Record<EventCircleStatus, EventCircleStatus[]> = {
  draft: ["open", "deleted"],
  open: ["active", "closing", "archived", "deleted"],
  active: ["closing", "archived", "deleted"],
  closing: ["archived", "deleted"],
  archived: ["deleted"],
  deleted: []
};

export function canTransitionEventCircle(from: EventCircleStatus, to: EventCircleStatus): boolean {
  return EVENT_CIRCLE_TRANSITIONS[from]?.includes(to) ?? false;
}

/** Content becomes read-only once the circle stops being open/active (§51). */
export function isEventCircleWritable(status: EventCircleStatus): boolean {
  return status === "open" || status === "active";
}

export function canModerateEventCircle(role: EventCircleRole): boolean {
  return role === "host" || role === "co_host" || role === "moderator";
}

export function canSendAnnouncement(role: EventCircleRole): boolean {
  return role === "host" || role === "co_host";
}

export function canManageMembers(role: EventCircleRole): boolean {
  return role === "host" || role === "co_host";
}

// Archive retention by tier (spec §51).
export const ARCHIVE_RETENTION_DAYS: Record<SubscriptionPlan, number> = {
  free: 7,
  buddy_plus: 30,
  buddy_pro: 90
};

export function archiveRetentionDaysFor(plan: SubscriptionPlan): number {
  return ARCHIVE_RETENTION_DAYS[plan] ?? ARCHIVE_RETENTION_DAYS.free;
}

export function archivesAtMs(closesAtMs: number, plan: SubscriptionPlan): number {
  return closesAtMs + archiveRetentionDaysFor(plan) * 24 * 60 * 60 * 1000;
}

// Circle capacity by tier (spec §62).
export const EVENT_CIRCLE_MAX_MEMBERS: Record<SubscriptionPlan, number> = {
  free: 50,
  buddy_plus: 250,
  buddy_pro: 5000
};

export function eventCircleMaxMembersFor(plan: SubscriptionPlan): number {
  return EVENT_CIRCLE_MAX_MEMBERS[plan] ?? EVENT_CIRCLE_MAX_MEMBERS.free;
}

// ---------------------------------------------------------------------------
// Join eligibility (spec §48, §57)
// ---------------------------------------------------------------------------

export type JoinCircleInput = {
  status: EventCircleStatus;
  joinMode: "invite" | "check_in" | "qr" | "community";
  memberStatus: "joined" | "left" | "removed" | "banned" | null;
  memberCount: number;
  maxMembers: number;
  /** True when the joiner holds a live check-in for the circle's event. */
  hasEventCheckIn: boolean;
  /** True when a valid, unexpired invite/QR token was presented. */
  hasValidToken: boolean;
  opensAtMs: number | null;
  nowMs: number;
};

export type JoinCircleReason =
  | "allowed"
  | "banned"
  | "already_joined"
  | "closed"
  | "not_open_yet"
  | "full"
  | "needs_check_in"
  | "needs_token";

export type JoinCircleResult = {
  allowed: boolean;
  reason: JoinCircleReason;
};

export function resolveJoinEventCircle(input: JoinCircleInput): JoinCircleResult {
  // A ban is terminal — rejoining is never allowed (spec §59).
  if (input.memberStatus === "banned") return { allowed: false, reason: "banned" };
  if (input.memberStatus === "joined") return { allowed: false, reason: "already_joined" };
  if (!isEventCircleWritable(input.status)) return { allowed: false, reason: "closed" };
  if (input.opensAtMs !== null && input.nowMs < input.opensAtMs) {
    return { allowed: false, reason: "not_open_yet" };
  }
  if (input.memberCount >= input.maxMembers) return { allowed: false, reason: "full" };
  if (input.joinMode === "check_in" && !input.hasEventCheckIn) {
    return { allowed: false, reason: "needs_check_in" };
  }
  if ((input.joinMode === "qr" || input.joinMode === "invite") && !input.hasValidToken) {
    return { allowed: false, reason: "needs_token" };
  }
  return { allowed: true, reason: "allowed" };
}
