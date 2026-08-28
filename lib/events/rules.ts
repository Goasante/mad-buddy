import { entitlementsFor } from "@/lib/billing/entitlements";
import type {
  EventCircleRole,
  EventCircleStatus,
  EventStatus,
  SubscriptionPlan
} from "@/lib/supabase/database.types";

/**
 * Events domain core (feature architecture batch 5): check-in windows, Event
 * Glow eligibility, and Temporary Event Circle lifecycle/roles. Pure and
 * deterministic, the server services layer supplies the facts, this decides.
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
 * event ends. Deliberately refuses days-in-advance check-in (spec §25), a
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
// Event lifecycle (Plans + Events lifecycle, Stage C)
// ---------------------------------------------------------------------------

/**
 * Purely time-derived. Where a moment sits between an event's own start and
 * end -- nothing else.
 *
 * upcoming: not yet started.
 * live:     started, not yet ended. Includes the exact start instant.
 * past:     ended. Includes the exact end instant.
 *
 * NO FALLBACK DURATION. `events.ends_at` is `not null` with a
 * `ends_at > starts_at` check constraint (20260717120000_safe_arrival_
 * checkins_events.sql), and a production audit before this was written found
 * zero events with a null end. Inventing a fallback for a case the schema
 * cannot produce would be guessing at a rule nobody asked for.
 *
 * CANCELLATION IS DELIBERATELY NOT HERE. `events.status` (draft / scheduled /
 * active / ended / cancelled) is the authoritative record of whether an event
 * was called off, independent of what its clock says -- a cancelled event
 * that would still be "live" by time alone must not present as live. Callers
 * check status themselves (as resolveCheckInWindow already does) rather than
 * this function silently absorbing that decision; mixing "where in time" with
 * "was it cancelled" into one return value is how the two get conflated.
 *
 * Boundaries are closed on the live side and open on the upcoming side:
 * `nowMs === startsAtMs` is live (the event has begun), `nowMs === endsAtMs`
 * is past (it has finished) -- the same "the instant it starts, it has
 * started" rule planPhase in lib/social/plans.ts applies to a start-only Plan.
 */
export type EventPhase = "upcoming" | "live" | "past";

export type EventTiming = {
  startsAtMs: number;
  endsAtMs: number;
};

export function eventPhase({ startsAtMs, endsAtMs }: EventTiming, nowMs: number): EventPhase {
  if (nowMs < startsAtMs) return "upcoming";
  if (nowMs < endsAtMs) return "live";
  return "past";
}

export function isUpcomingEvent(timing: EventTiming, nowMs: number): boolean {
  return eventPhase(timing, nowMs) === "upcoming";
}

/** Upcoming OR live: a currently-current commitment, still worth agenda space. */
export function isCurrentEvent(timing: EventTiming, nowMs: number): boolean {
  const phase = eventPhase(timing, nowMs);
  return phase === "upcoming" || phase === "live";
}

export function isPastEvent(timing: EventTiming, nowMs: number): boolean {
  return eventPhase(timing, nowMs) === "past";
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
 * privately or disabled Glow is simply absent, the caller must not disclose
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

/** Derived from the central entitlement registry (batch 10, spec §7). */
export function archiveRetentionDaysFor(plan: SubscriptionPlan): number {
  return entitlementsFor(plan).event_circle_archive_days;
}

// Archive retention by tier (spec §51).
export const ARCHIVE_RETENTION_DAYS: Record<SubscriptionPlan, number> = {
  free: archiveRetentionDaysFor("free"),
  buddy_plus: archiveRetentionDaysFor("buddy_plus"),
  buddy_pro: archiveRetentionDaysFor("buddy_pro")
};

/**
 * When an archived circle's content stops being retained.
 *
 * Returns `null` when retention is UNLIMITED, which it now is on every tier:
 * the Monetization Reset made event-circle archival free-core, and a tiered
 * "how long you keep your own history" window was monetizing the past.
 *
 * NULL, NOT INFINITY. `archiveRetentionDaysFor` returns `UNLIMITED`
 * (Infinity), and the caller does `new Date(archivesAtMs(...)).toISOString()`,
 * which THROWS `RangeError: Invalid time value` on a non-finite input. Closing
 * a circle would have failed at runtime while every unit test passed, because
 * none of them called the action. Returning null forces the caller to handle
 * "never archives" explicitly, and the type makes that unmissable.
 */
export function archivesAtMs(closesAtMs: number, plan: SubscriptionPlan): number | null {
  const days = archiveRetentionDaysFor(plan);
  if (!Number.isFinite(days)) return null;
  return closesAtMs + days * 24 * 60 * 60 * 1000;
}

/** Derived from the central entitlement registry (batch 10, spec §7). */
export function eventCircleMaxMembersFor(plan: SubscriptionPlan): number {
  return entitlementsFor(plan).max_event_circle_members;
}

// Circle capacity by tier (spec §62).
export const EVENT_CIRCLE_MAX_MEMBERS: Record<SubscriptionPlan, number> = {
  free: eventCircleMaxMembersFor("free"),
  buddy_plus: eventCircleMaxMembersFor("buddy_plus"),
  buddy_pro: eventCircleMaxMembersFor("buddy_pro")
};

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
  /**
   * True when a real invitation row names this user for this Room.
   *
   * SEPARATE FROM hasValidToken ON PURPOSE. "Invite only" used to be satisfied
   * by any valid circle_join token, which meant anyone who had been forwarded a
   * QR could join a Room whose whole promise was that they could not. An
   * invitation is a fact about a person; a token is a fact about a string.
   */
  hasInvitation?: boolean;
  /**
   * True when the user is a current joined member of at least one Group this
   * Room admits. Evaluated live at join time -- leaving the Group ends
   * eligibility, so this is never cached.
   */
  isEligibleGroupMember?: boolean;
  /**
   * True when the Room has at least one Group target configured. A
   * Group-gated Room with no targets admits nobody, rather than everybody.
   */
  hasGroupTargets?: boolean;
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
  | "needs_token"
  | "needs_invitation"
  | "needs_group_membership";

export type JoinCircleResult = {
  allowed: boolean;
  reason: JoinCircleReason;
};

/**
 * TWO AUTHORIZATION HOLES THIS CLOSES, both of which let the UI promise
 * something the backend did not enforce:
 *
 * 1. `community` had NO BRANCH AT ALL. It fell through every check to
 *    `allowed`, so a Room whose join mode said "Group members" admitted the
 *    entire internet. It now requires live membership of a Group the Room
 *    actually targets, and a Room with no targets admits nobody rather than
 *    everybody -- absence of configuration is not permission.
 *
 * 2. `invite` accepted any valid circle_join token, making "invite only" mean
 *    "anyone holding a QR". It now requires a real invitation naming this user.
 *    A token still satisfies `qr`, which is the mode that is *about* holding a
 *    code.
 *
 * Order matters: ban, then membership, then Room state, then capacity, then
 * mode. Someone banned is never told which of the later gates they would also
 * have failed.
 */
export function resolveJoinEventCircle(input: JoinCircleInput): JoinCircleResult {
  // A ban is terminal, rejoining is never allowed (spec §59).
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
  if (input.joinMode === "qr" && !input.hasValidToken) {
    return { allowed: false, reason: "needs_token" };
  }
  if (input.joinMode === "invite" && !input.hasInvitation) {
    return { allowed: false, reason: "needs_invitation" };
  }
  if (input.joinMode === "community") {
    // Fails closed on both counts: an unconfigured Room and a non-member are
    // refused identically, so a probe cannot map a Room's target Groups.
    if (!input.hasGroupTargets || !input.isEligibleGroupMember) {
      return { allowed: false, reason: "needs_group_membership" };
    }
  }
  return { allowed: true, reason: "allowed" };
}

// ---------------------------------------------------------------------------
// Audience: who may find an Event, and who may open one
// ---------------------------------------------------------------------------

/**
 * What the viewer's relationship to an Event's audience is.
 *
 * Supplied by the service layer, which has already looked up the targets --
 * these rules stay pure so the same answer can be reached from the web feed,
 * the ranking query, the mobile API and a test, without four lookups.
 */
export type EventAudienceContext = {
  visibility: string;
  hostId: string;
  /** The viewer is explicitly named on the Event's invite list. */
  isInvited?: boolean;
  /** The viewer belongs to a Circle this Event is targeted at. */
  isCommunityMember?: boolean;
  /** The Event carries at least one community target. */
  hasCommunityTarget?: boolean;
};

/**
 * BROWSING. Whether an Event may appear in a general discovery listing.
 *
 * The rule that matters here is that an unlisted Event which shows up in the
 * feed is not unlisted. `link` is reachable by anyone holding the link and
 * must never be browsable; `invite` is private however many people are going.
 *
 * `community` requires both a selected community and current membership.
 * Older untargeted rows fail closed: absence of an audience target is not
 * permission to expose the Event broadly.
 *
 * Fails closed: an audience this function does not recognise gets no
 * discovery, rather than inheriting it by falling through a !== check.
 */
export function isDiscoverableInFeed(event: EventAudienceContext, viewerId: string): boolean {
  if (event.hostId === viewerId) return true;
  switch (event.visibility) {
    case "public":
    case "nearby":
      return true;
    case "community":
      return Boolean(event.hasCommunityTarget && event.isCommunityMember);
    case "invite":
    case "link":
    default:
      return false;
  }
}

/**
 * BROAD RANKING. Whether an Event may enter Top 100 / Home Top 5.
 *
 * Stricter than browsing on purpose. A community Event is legitimately
 * discoverable by its members, but "trending across Mad Buddy" is a claim
 * about the whole product, and an Event whose audience is one Circle has not
 * earned it. Visibility precedes score: this is asked before any number is
 * calculated, so a private wedding with five thousand Going can never rank.
 */
export function isBroadlyRankable(event: { visibility: string }): boolean {
  return event.visibility === "public" || event.visibility === "nearby";
}

/**
 * DIRECT ACCESS. Whether a viewer may open an Event they already hold the id
 * for -- a deep link, a notification, a shared URL.
 *
 * Deliberately more permissive than browsing, and that gap is the entire point
 * of an unlisted audience: holding the link IS the permission for `link`.
 * `invite` asks a different question, answered by the invite list rather than
 * by the audience value alone.
 *
 * A draft is never openable by anyone but its host, whatever its audience --
 * an unpublished Event is not yet an Event as far as everyone else is
 * concerned.
 */
export function canViewEvent(
  event: EventAudienceContext & { status: string },
  viewerId: string
): boolean {
  if (event.hostId === viewerId) return true;
  if (event.status === "draft") return false;
  switch (event.visibility) {
    case "public":
    case "nearby":
    case "link":
      return true;
    case "community":
      return Boolean(event.hasCommunityTarget && event.isCommunityMember);
    case "invite":
      return Boolean(event.isInvited);
    default:
      return false;
  }
}

/**
 * Whether this viewer may act as the Event's voice: publish Updates, manage
 * details.
 *
 * The host always can. Admins are the delegation path, and they exist as their
 * own table rather than as Event Circle membership because circle capacity is
 * capped by the host's subscription -- a limit that must never decide who can
 * announce a moved gate.
 */
export function canManageEvent(
  event: { hostId: string },
  viewerId: string,
  isAdmin: boolean
): boolean {
  return event.hostId === viewerId || isAdmin;
}

/** Only the host: appointing admins, cancelling, changing the audience. */
export function isEventOwner(event: { hostId: string }, viewerId: string): boolean {
  return event.hostId === viewerId;
}
