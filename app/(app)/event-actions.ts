"use server";

import { z } from "zod";
import type { Database } from "@/lib/supabase/database.types";
import { guardFeature } from "@/lib/admin/enforcement";
import { deliverNotification } from "@/lib/notifications/server";
import { getCurrentSubscriptionAccess } from "@/lib/premium/access";
import { createEventToken, verifyEventToken } from "@/lib/events/qr";
import {
  archivesAtMs,
  canSendAnnouncement,
  canTransitionEventCircle,
  eventCircleMaxMembersFor,
  isEventCircleWritable,
  resolveCheckInWindow,
  resolveJoinEventCircle,
  type JoinCircleReason
} from "@/lib/events/rules";
import {
  buildEventGlowList,
  eventTokenSecret,
  liveCheckIn,
  resolveEventCircleAccess
} from "@/lib/events/service";
import {
  canManageRoom,
  gatherJoinFacts,
  getEventRoom,
  isEventOperator,
  listEventRooms,
  listRoomMembers,
  listRoomNotices
} from "@/lib/events/rooms";
import { consumeRateLimit, rateLimitMessage } from "@/lib/security/rate-limit";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getSupabaseServerEnv } from "@/lib/supabase/env";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  createEvent,
  getEventDraftForHost,
  updateEventDraft,
  getEventViewForViewer,
  listEvents,
  setEventRsvp,
  type EventDraft,
  type EventView
} from "@/lib/events/mobile";
import { getEventForViewer } from "@/lib/events/access";
import type { CheckInVisibility, EventGlowMuddyList } from "@/lib/events/types";
import {
  addEventAdmin,
  createEventUpdate,
  editEventUpdate,
  listEventAdmins,
  listEventUpdates,
  removeEventAdmin,
  setUpdateReaction,
  type EventAdminView,
  type EventUpdateView
} from "@/lib/events/updates";
import {
  describeEventLinkrPool,
  eventLinkrCandidateIds,
  hasEventLinkrConsent,
  resolveEventLinkrEligibility,
  setEventLinkrConsent
} from "@/lib/events/linkr-consent";
import {
  listCommunityOptions,
  listInviteeOptions,
  type CommunityOption,
  type InviteeOption
} from "@/lib/events/audience-options";

export type EventActionState = {
  ok: boolean;
  message: string;
  eventId?: string;
  circleId?: string;
  checkInId?: string;
};

const uuidSchema = z.string().uuid();

/**
 * Retention cut-off for an archived Room, or null when it never expires.
 *
 * Wrapped because archivesAtMs deliberately returns `number | null` --
 * unlimited retention is null, never Infinity, since new Date(Infinity)
 * throws. Every caller has to make the same null decision, so it is made once.
 */
function archivesAtNullable(plan: Parameters<typeof archivesAtMs>[1]): string | null {
  const ms = archivesAtMs(Date.now(), plan);
  return ms === null ? null : new Date(ms).toISOString();
}

function missingEnvState(): EventActionState | null {
  const env = getSupabaseServerEnv();
  if (!env.url || !env.serviceRoleKey) {
    return { ok: false, message: "This action needs the server database configuration." };
  }
  return null;
}

async function getAuthedUserId() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
    error
  } = await supabase.auth.getUser();
  return error || !user ? null : user.id;
}

// ---------------------------------------------------------------------------
// Events list + creation (spec §24), the read surface for the events page.
// ---------------------------------------------------------------------------

// EventView lives in lib/events/mobile so the /api/events route shares it.

export async function getEventsAction(): Promise<EventView[]> {
  const userId = await getAuthedUserId();
  if (!userId) return [];
  return listEvents(userId);
}

export async function createEventAction(input: unknown): Promise<EventActionState> {
  const userId = await getAuthedUserId();
  if (!userId) return { ok: false, message: "Log in first." };
  return createEvent(userId, input);
}

// ---------------------------------------------------------------------------
// RSVP / Going (Plans + Events lifecycle, Stage C)
// ---------------------------------------------------------------------------

/**
 * Thin wrapper, same shape as every other action here: resolve the
 * authenticated user server-side, then hand off. All real validation --
 * event existence, blocks, cancelled/ended, the host exception -- lives in
 * setEventRsvp, not duplicated at this layer.
 */
export async function setEventRsvpAction(eventId: string, status: unknown): Promise<EventActionState> {
  const userId = await getAuthedUserId();
  if (!userId) return { ok: false, message: "Log in before RSVPing." };
  if (!uuidSchema.safeParse(eventId).success) return { ok: false, message: "Event not found." };
  return setEventRsvp(userId, eventId, status);
}

// ---------------------------------------------------------------------------
// Check in / out (spec §24, §26, §30)
// ---------------------------------------------------------------------------

const checkInSchema = z.object({
  eventId: uuidSchema,
  visibility: z.enum(["private", "participants", "selected_muddies", "anonymous_count"]).optional(),
  eventGlowEnabled: z.boolean().optional(),
  /** Signed QR token; required when checking in by QR. */
  token: z.string().max(500).optional()
});

export async function checkInToEventAction(input: unknown): Promise<EventActionState> {
  const missing = missingEnvState();
  if (missing) return missing;

  const parsed = checkInSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Check the check-in details and try again." };

  const userId = await getAuthedUserId();
  if (!userId) return { ok: false, message: "Log in before checking in." };

  const rateLimit = await consumeRateLimit({ action: "checkins.create", userId });
  if (!rateLimit.allowed) return { ok: false, message: rateLimitMessage(rateLimit.resetAt) };

  /* This Server Action is the browser check-in path. It must use the same
   * direct-access authority as Event detail and the mobile API; a guessed
   * private/community Event id is not permission to create a check-in. */
  const access = await getEventForViewer(parsed.data.eventId, userId);
  if (!access.ok) return { ok: false, message: "Event not found." };
  const event = access.event;

  const admin = createSupabaseAdminClient();

  // QR check-in: the token must be valid, unexpired, and for THIS event.
  let method: "manual" | "qr" = "manual";
  if (parsed.data.token) {
    const secret = eventTokenSecret();
    if (!secret) return { ok: false, message: "Check-in isn't available right now." };
    const verified = verifyEventToken(parsed.data.token, secret, Date.now());
    if (!verified.valid) {
      return {
        ok: false,
        message: verified.reason === "expired" ? "That code has expired." : "That code isn't valid."
      };
    }
    if (verified.payload.purpose !== "check_in" || verified.payload.contextId !== parsed.data.eventId) {
      return { ok: false, message: "That code isn't for this event." };
    }
    method = "qr";
  }

  const window = resolveCheckInWindow({
    eventStatus: event.status,
    startsAtMs: Date.parse(event.starts_at),
    endsAtMs: Date.parse(event.ends_at),
    opensMinutesBefore: event.checkin_opens_minutes_before,
    nowMs: Date.now()
  });
  if (!window.allowed) {
    const message =
      window.reason === "too_early"
        ? "Check-in isn't open yet."
        : window.reason === "event_ended"
          ? "This event has ended."
          : "This event isn't available.";
    return { ok: false, message };
  }

  const existing = await liveCheckIn(admin, userId, "event", parsed.data.eventId);
  if (existing) return { ok: true, message: `You're already checked in to ${event.name}.`, checkInId: existing.id };

  const { data: checkIn, error } = await admin
    .from("check_ins")
    .insert({
      user_id: userId,
      context_type: "event",
      context_id: parsed.data.eventId,
      method,
      visibility: (parsed.data.visibility ?? "participants") as CheckInVisibility,
      // Default OFF (Stage E). Being present at an event is not consent to be
      // shown as present -- the caller has to pass `true` explicitly, which
      // only happens when someone ticks "Let my Muddies see I'm here". This
      // used to default ON, which meant every check-in silently broadcast
      // location-adjacent presence to every Muddy.
      event_glow_enabled: parsed.data.eventGlowEnabled ?? false,
      status: "checked_in"
    })
    .select("id")
    .single();

  // The partial unique index makes a concurrent duplicate a conflict, not a
  // second row (spec §31 duplicate scan).
  if (error || !checkIn) {
    const retry = await liveCheckIn(admin, userId, "event", parsed.data.eventId);
    if (retry) return { ok: true, message: `You're already checked in to ${event.name}.`, checkInId: retry.id };
    return { ok: false, message: "Couldn't check you in. Try again." };
  }

  {
    const { grantAchievement } = await import("@/lib/engagement/achievements");
    await grantAchievement(admin, userId, "event_explorer");
  }
  return { ok: true, message: `Checked in to ${event.name}.`, checkInId: checkIn.id };
}

export async function checkOutAction(checkInId: string): Promise<EventActionState> {
  const missing = missingEnvState();
  if (missing) return missing;
  if (!uuidSchema.safeParse(checkInId).success) return { ok: false, message: "Check-in not found." };

  const userId = await getAuthedUserId();
  if (!userId) return { ok: false, message: "Log in first." };

  const admin = createSupabaseAdminClient();
  const { data: updated, error } = await admin
    .from("check_ins")
    .update({ status: "checked_out", checked_out_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq("id", checkInId)
    .eq("user_id", userId)
    .eq("status", "checked_in")
    .select("id");

  if (error) return { ok: false, message: "Couldn't check you out." };
  if (!updated?.length) return { ok: false, message: "You're not checked in." };
  // Checking out ends Event Glow immediately (spec §26, §37).
  return { ok: true, message: "Checked out. You no longer appear as here." };
}

/** Toggles Event Glow for a live check-in without checking out (spec §44). */
export async function setEventGlowAction(checkInId: string, enabled: boolean): Promise<EventActionState> {
  const missing = missingEnvState();
  if (missing) return missing;
  if (!uuidSchema.safeParse(checkInId).success) return { ok: false, message: "Check-in not found." };

  const userId = await getAuthedUserId();
  if (!userId) return { ok: false, message: "Log in first." };

  const admin = createSupabaseAdminClient();
  const { error } = await admin
    .from("check_ins")
    .update({ event_glow_enabled: enabled, updated_at: new Date().toISOString() })
    .eq("id", checkInId)
    .eq("user_id", userId)
    .eq("status", "checked_in");
  if (error) return { ok: false, message: "Couldn't update Event Glow." };
  return { ok: true, message: enabled ? "Muddies at this event can see you." : "You're hidden at this event." };
}

/** Event Glow list for the current viewer (spec §39). Server-authorized. */
export async function getEventGlowAction(eventId: string): Promise<EventGlowMuddyList> {
  const env = getSupabaseServerEnv();
  if (!env.url || !env.serviceRoleKey) return { count: 0, muddies: [] };
  if (!uuidSchema.safeParse(eventId).success) return { count: 0, muddies: [] };

  const userId = await getAuthedUserId();
  if (!userId) return { count: 0, muddies: [] };

  const admin = createSupabaseAdminClient();

  // Event Glow has its own kill switch and is force-disabled during a
  // location-exposure incident (batch 13 §47). Empty list rather than an
  // error: nobody is "here" while it's off.
  if (!(await guardFeature(admin, "event_glow")).allowed) return { count: 0, muddies: [] };

  return buildEventGlowList(admin, eventId, userId);
}

// ---------------------------------------------------------------------------
// Event circles (spec §48, §54)
// ---------------------------------------------------------------------------

/**
 * Join an Event Room.
 *
 * WHAT CHANGED AND WHY. This used to decide eligibility from a token and then
 * upsert a membership row, which meant:
 *   - "invite only" was satisfied by anyone holding a forwarded QR, and
 *   - "community" (Group members) was not checked AT ALL, so those Rooms
 *     admitted everybody.
 * Both are now decided by resolveJoinEventCircle from real facts gathered by
 * gatherJoinFacts, and the write itself goes through join_event_room, which
 * takes the Room's row lock, enforces capacity inside it, and reconciles Room
 * membership with conversation membership in one transaction.
 *
 * A token still matters -- for `qr` mode, which is the mode that is about
 * holding a code -- and is still verified for signature, purpose and context.
 */
export async function joinEventCircleAction(
  circleId: string,
  token?: string
): Promise<EventActionState> {
  const missing = missingEnvState();
  if (missing) return missing;
  if (!uuidSchema.safeParse(circleId).success) return { ok: false, message: "Room not found." };

  const userId = await getAuthedUserId();
  if (!userId) return { ok: false, message: "Log in first." };

  const rateLimit = await consumeRateLimit({ action: "event_circles.join", userId });
  if (!rateLimit.allowed) return { ok: false, message: rateLimitMessage(rateLimit.resetAt) };

  const admin = createSupabaseAdminClient();
  const facts = await gatherJoinFacts(admin, userId, circleId);
  if (!facts.room) return { ok: false, message: "Room not found." };
  const room = facts.room;

  // The token is verified for signature, expiry, purpose AND context. A
  // check_in token can never be replayed as a room join, and a token for
  // another Room does not open this one.
  let hasValidToken = false;
  if (token) {
    const secret = eventTokenSecret();
    const verified = secret ? verifyEventToken(token, secret, Date.now()) : null;
    hasValidToken =
      verified?.valid === true &&
      verified.payload.purpose === "circle_join" &&
      verified.payload.contextId === circleId;
  }

  const decision = resolveJoinEventCircle({
    status: room.status,
    joinMode: room.join_mode,
    memberStatus: facts.memberStatus,
    memberCount: facts.memberCount,
    maxMembers: room.max_members,
    hasEventCheckIn: facts.hasEventCheckIn,
    hasValidToken,
    hasInvitation: facts.hasInvitation,
    hasGroupTargets: facts.hasGroupTargets,
    isEligibleGroupMember: facts.isEligibleGroupMember,
    opensAtMs: room.opens_at ? Date.parse(room.opens_at) : null,
    nowMs: Date.now()
  });

  if (!decision.allowed) {
    const messages: Record<JoinCircleReason, string> = {
      allowed: "",
      // Deliberately generic: a banned user is never told they were banned.
      banned: "You can't join this room.",
      already_joined: `You're already in ${room.name}.`,
      closed: "This room is closed.",
      not_open_yet: "This room hasn't opened yet.",
      full: "This room is full.",
      needs_check_in: "Check in to the event first.",
      needs_token: "Scan the room QR code to join.",
      needs_invitation: "This room is invite only.",
      needs_group_membership: "This room is for members of selected groups."
    };
    return { ok: decision.reason === "already_joined", message: messages[decision.reason], circleId };
  }

  const { error } = await admin.rpc("join_event_room", {
    p_room_id: circleId,
    p_user_id: userId
  });
  if (error) {
    // The RPC re-checks capacity and ban status under the row lock, so a race
    // that slips past the read above still fails safely here.
    const message = String(error.message ?? "");
    if (message.includes("ROOM_FULL")) return { ok: false, message: "This room is full." };
    if (message.includes("ROOM_BANNED")) return { ok: false, message: "You can't join this room." };
    if (message.includes("ROOM_CLOSED")) return { ok: false, message: "This room is closed." };
    return { ok: false, message: "Couldn't join the room." };
  }

  // eventId travels back so a QR scan can open the Room inside its Event.
  return { ok: true, message: `Joined ${room.name}.`, circleId, eventId: room.event_id ?? undefined };
}

/**
 * Leave a Room. Membership and chat access move together, through the one
 * lifecycle authority -- leaving a Room must not leave the person sitting in
 * its conversation.
 */
export async function leaveEventCircleAction(circleId: string): Promise<EventActionState> {
  const missing = missingEnvState();
  if (missing) return missing;
  if (!uuidSchema.safeParse(circleId).success) return { ok: false, message: "Room not found." };

  const userId = await getAuthedUserId();
  if (!userId) return { ok: false, message: "Log in first." };

  const admin = createSupabaseAdminClient();
  const { error } = await admin.rpc("set_event_room_membership", {
    p_room_id: circleId,
    p_user_id: userId,
    p_status: "left"
  });
  if (error) return { ok: false, message: "Couldn't leave the room." };
  return { ok: true, message: "You've left this room." };
}

const announcementSchema = z.object({
  circleId: uuidSchema,
  title: z.string().min(1).max(120),
  body: z.string().min(1).max(1000),
  priority: z.enum(["normal", "high"]).optional()
});

export async function sendEventAnnouncementAction(input: unknown): Promise<EventActionState> {
  const missing = missingEnvState();
  if (missing) return missing;

  const parsed = announcementSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Check the notice and try again." };

  const userId = await getAuthedUserId();
  if (!userId) return { ok: false, message: "Log in first." };

  const rateLimit = await consumeRateLimit({ action: "event_announcements.send", userId });
  if (!rateLimit.allowed) return { ok: false, message: rateLimitMessage(rateLimit.resetAt) };

  const admin = createSupabaseAdminClient();
  const access = await resolveEventCircleAccess(admin, userId, parsed.data.circleId);
  if (!access.exists) return { ok: false, message: "Room not found." };
  if (!access.role || !canSendAnnouncement(access.role)) {
    return { ok: false, message: "Only the host can post notices." };
  }

  const { data: circle } = await admin
    .from("event_circles")
    .select("status, name, event_id")
    .eq("id", parsed.data.circleId)
    .maybeSingle();
  if (!circle || !isEventCircleWritable(circle.status)) {
    return { ok: false, message: "This room is read-only now." };
  }

  const { error } = await admin.from("event_announcements").insert({
    event_circle_id: parsed.data.circleId,
    author_id: userId,
    title: parsed.data.title.trim(),
    body: parsed.data.body.trim(),
    priority: parsed.data.priority ?? "normal"
  });
  if (error) return { ok: false, message: "Couldn't post the notice." };

  const { data: members } = await admin
    .from("event_circle_members")
    .select("user_id")
    .eq("event_circle_id", parsed.data.circleId)
    .eq("status", "joined")
    .neq("user_id", userId);

  await Promise.all(
    (members ?? []).map((member) =>
      deliverNotification(admin, {
        userId: member.user_id,
        senderId: userId,
        category: "plans",
        // The Room this notice belongs to, so the notification opens it.
        type: `event_room:${circle.event_id ?? ""}:${parsed.data.circleId}`,
        title: circle.name,
        message: parsed.data.title.trim()
      })
    )
  );

  return { ok: true, message: `Notice posted to ${(members ?? []).length} members.` };
}

/**
 * Archive a Room: read-only, nothing deleted.
 *
 * Archiving keeps every member and every message and sets the conversation to
 * 'archived', which the existing canSendMessage authority already refuses to
 * write to. Read-only therefore comes from the messaging rules that already
 * exist rather than from a second rule that could be forgotten.
 */
export async function archiveEventCircleAction(circleId: string): Promise<EventActionState> {
  const missing = missingEnvState();
  if (missing) return missing;
  if (!uuidSchema.safeParse(circleId).success) return { ok: false, message: "Room not found." };

  const userId = await getAuthedUserId();
  if (!userId) return { ok: false, message: "Log in first." };

  const admin = createSupabaseAdminClient();
  const { data: circle } = await admin
    .from("event_circles")
    .select("id, owner_id, status")
    .eq("id", circleId)
    .maybeSingle();
  if (!circle) return { ok: false, message: "Room not found." };

  const manage = await canManageRoom(admin, userId, circleId);
  if (!manage.allowed || manage.role !== "host") {
    return { ok: false, message: "Only the host can archive this room." };
  }
  if (!canTransitionEventCircle(circle.status, "archived")) {
    return { ok: false, message: "This room can't be archived." };
  }

  const access = await getCurrentSubscriptionAccess(userId);
  const { error } = await admin.rpc("archive_event_room", {
    p_room_id: circleId,
    // archivesAtMs returns null when retention is unlimited, which it now is on
    // every tier. new Date(null) would be the epoch, silently marking the room
    // as already past its retention date, so null passes through as "never".
    p_archives_at: archivesAtNullable(access.plan)
  });
  if (error) return { ok: false, message: "Couldn't archive the room." };

  return { ok: true, message: "Room archived. Content is read-only now." };
}

/**
 * Create an Event Room.
 *
 * Three writes became one RPC: the Room, its host membership and its canonical
 * conversation are created in a single transaction. Previously a failure
 * between them could leave a Room with no host, or (once chat existed) a Room
 * nobody could talk in.
 *
 * Capacity is bounded by the host's tier (spec §62).
 */
export async function createEventCircleAction(input: unknown): Promise<EventActionState> {
  const missing = missingEnvState();
  if (missing) return missing;

  const schema = z.object({
    name: z.string().min(1).max(80),
    description: z.string().max(500).optional(),
    eventId: uuidSchema.optional(),
    joinMode: z.enum(["invite", "check_in", "qr", "community"]).optional(),
    listed: z.boolean().optional(),
    maxMembers: z.number().int().min(1).max(5000).optional(),
    groupConversationIds: z.array(uuidSchema).max(20).optional()
  });
  const parsed = schema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Check the room details and try again." };

  const userId = await getAuthedUserId();
  if (!userId) return { ok: false, message: "Log in first." };

  const admin = createSupabaseAdminClient();

  // Only someone who operates the Event may create Rooms in it. Holding an
  // event id is not authority to attach a Room to it.
  if (parsed.data.eventId && !(await isEventOperator(admin, parsed.data.eventId, userId))) {
    return { ok: false, message: "Only the host can create rooms for this event." };
  }

  const access = await getCurrentSubscriptionAccess(userId);
  const tierCap = eventCircleMaxMembersFor(access.plan);
  // A host may set a SMALLER limit than their tier allows, never a larger one.
  const maxMembers = Math.min(parsed.data.maxMembers ?? tierCap, tierCap);

  const { data: roomId, error } = await admin.rpc("create_event_room", {
    p_owner_id: userId,
    p_event_id: parsed.data.eventId ?? null,
    p_name: parsed.data.name.trim(),
    p_description: parsed.data.description?.trim() || null,
    p_join_mode: parsed.data.joinMode ?? "invite",
    p_max_members: maxMembers,
    p_listed: parsed.data.listed ?? true,
    p_group_conversation_ids: parsed.data.groupConversationIds ?? []
  });

  if (error || !roomId) {
    const message = String(error?.message ?? "");
    if (message.includes("ROOM_GROUP_TARGET_REQUIRED")) {
      return { ok: false, message: "Choose at least one group for a group-only room." };
    }
    if (message.includes("ROOM_GROUP_TARGET_FORBIDDEN")) {
      return { ok: false, message: "You can only choose groups you're in." };
    }
    return { ok: false, message: "Couldn't create the room." };
  }

  return { ok: true, message: `${parsed.data.name.trim()} created.`, circleId: String(roomId) };
}

export async function listEventUpdatesAction(eventId: string): Promise<EventUpdateView[]> {
  const userId = await getAuthedUserId();
  if (!userId) return [];
  return listEventUpdates(eventId, userId);
}

/** Whether the current viewer may speak for this Event.
 * Delegated Event admins share this authority with the host. The mutation
 * re-checks it; this action only decides whether to show the composer. */
export async function canManageEventAction(eventId: string): Promise<boolean> {
  const userId = await getAuthedUserId();
  if (!userId || !uuidSchema.safeParse(eventId).success) return false;
  const access = await getEventForViewer(eventId, userId);
  return access.ok && access.canManage;
}

export async function postEventUpdateAction(input: unknown): Promise<EventActionState> {
  const userId = await getAuthedUserId();
  if (!userId) return { ok: false, message: "Log in first." };
  return createEventUpdate(userId, input);
}

export async function editEventUpdateAction(
  updateId: string,
  body: string
): Promise<EventActionState> {
  const userId = await getAuthedUserId();
  if (!userId) return { ok: false, message: "Log in first." };
  return editEventUpdate(userId, updateId, body);
}

export async function setEventUpdateReactionAction(
  updateId: string,
  reaction: string | null
): Promise<EventActionState> {
  const userId = await getAuthedUserId();
  if (!userId) return { ok: false, message: "Log in first." };
  return setUpdateReaction(userId, updateId, reaction);
}

export async function listEventAdminsAction(eventId: string): Promise<EventAdminView[]> {
  const userId = await getAuthedUserId();
  if (!userId) return [];
  return listEventAdmins(eventId, userId);
}

export async function addEventAdminAction(
  eventId: string,
  targetUserId: string
): Promise<EventActionState> {
  const userId = await getAuthedUserId();
  if (!userId) return { ok: false, message: "Log in first." };
  return addEventAdmin(userId, eventId, targetUserId);
}

export async function removeEventAdminAction(
  eventId: string,
  targetUserId: string
): Promise<EventActionState> {
  const userId = await getAuthedUserId();
  if (!userId) return { ok: false, message: "Log in first." };
  return removeEventAdmin(userId, eventId, targetUserId);
}

/**
 * Event Linkr consent. Separate action from check-in and from Event Glow,
 * because they are separate permissions -- see lib/events/linkr-consent.ts.
 */
export async function setEventLinkrConsentAction(
  eventId: string,
  enabled: boolean
): Promise<EventActionState> {
  const userId = await getAuthedUserId();
  if (!userId) return { ok: false, message: "Log in first." };
  if (!uuidSchema.safeParse(eventId).success) return { ok: false, message: "Event not found." };
  return setEventLinkrConsent(userId, eventId, enabled);
}

/**
 * ONE Event, by id, for a viewer who followed a direct link.
 *
 * The page used to resolve `?event=<id>` against the already-loaded discovery
 * list, so an unlisted "anyone with the link" Event -- which is never in that
 * list, by design -- opened nothing at all. Silently: no sheet, no error.
 *
 * Direct access is its own question, and getEventForViewer already answers it
 * (blocks first, then canViewEvent). Returning null for a refusal keeps the
 * client honest: it cannot tell a blocked Event from a missing one, which is
 * the same non-disclosure the rest of the surface maintains.
 */
export async function getEventByIdAction(eventId: string): Promise<EventView | null> {
  const userId = await getAuthedUserId();
  if (!userId) return null;
  if (!uuidSchema.safeParse(eventId).success) return null;
  return getEventViewForViewer(userId, eventId);
}

/**
 * Which of these Events are genuinely near the viewer.
 *
 * Returns null when there is no fresh location, so the UI can say so honestly
 * instead of showing a generic list under a heading that promises proximity.
 * Ids only -- no distance crosses this boundary.
 */
export async function nearbyEventIdsAction(eventIds: string[]): Promise<string[] | null> {
  const userId = await getAuthedUserId();
  if (!userId) return null;
  const safeIds = eventIds.filter((id) => uuidSchema.safeParse(id).success).slice(0, 200);
  const { nearbyEventIdsForViewer } = await import("@/lib/events/nearby");
  return nearbyEventIdsForViewer(userId, safeIds);
}

/** Whether the viewer may enter Event Mode right now, and why not if not. */
export async function getEventLinkrStateAction(
  eventId: string
): Promise<{ eligible: boolean; reason: string; consented: boolean; poolLabel: string | null }> {
  const userId = await getAuthedUserId();
  if (!userId) return { eligible: false, reason: "not_checked_in", consented: false, poolLabel: null };
  if (!uuidSchema.safeParse(eventId).success) {
    return { eligible: false, reason: "event_not_found", consented: false, poolLabel: null };
  }

  const admin = createSupabaseAdminClient();
  const [eligibility, consented] = await Promise.all([
    resolveEventLinkrEligibility(admin, userId, eventId),
    hasEventLinkrConsent(admin, userId, eventId)
  ]);

  /* The pool count is only computed for somebody already eligible. Showing a
   * would-be joiner how many people are inside would let them learn the size
   * of a private room without entering it. */
  let poolLabel: string | null = null;
  if (eligibility.eligible) {
    const candidates = await eventLinkrCandidateIds(admin, userId, eventId);
    poolLabel = describeEventLinkrPool(candidates.size);
  }

  return { eligible: eligibility.eligible, reason: eligibility.reason, consented, poolLabel };
}

/**
 * One draft, for its host to carry on editing.
 *
 * Resuming is not viewing: the creation flow needs the draft's VALUES, and
 * opening the Event detail instead is what produced a dimmed screen with no
 * editor. Returns null for anything that is not this host's own draft.
 */
export async function getEventDraftAction(eventId: string): Promise<EventDraft | null> {
  const userId = await getAuthedUserId();
  if (!userId) return null;
  if (!uuidSchema.safeParse(eventId).success) return null;
  return getEventDraftForHost(userId, eventId);
}

/**
 * Saves edits back onto an existing draft.
 *
 * Publishing a RESUMED draft must transition that same Event -- calling create
 * again would insert a second row and strand the original in Drafts.
 */
export async function updateEventDraftAction(eventId: string, input: unknown): Promise<EventActionState> {
  const userId = await getAuthedUserId();
  if (!userId) return { ok: false, message: "Log in first." };
  if (!uuidSchema.safeParse(eventId).success) return { ok: false, message: "Event not found." };
  return updateEventDraft(userId, eventId, input);
}

/**
 * Sends an Event's link into an existing conversation.
 *
 * REUSES CANONICAL MESSAGING, deliberately. Events does not get a second chat
 * engine: this composes the message and hands it to sendMessage, which already
 * owns membership checks, blocks, rate limiting and moderation. A structured
 * Event attachment (its own message_type with a rendered card) would be the
 * richer version and needs a migration plus a renderer; the link is the part
 * that works today and it opens through the same access authority.
 *
 * SHARING IS TRANSPORT, NOT PERMISSION. The recipient still meets whatever
 * canViewEvent says: forwarding an invite-only Event into a Group does not
 * invite the Group. Only Events the SENDER may see can be shared, so this is
 * not a way to discover an Event id either.
 */
export async function shareEventToConversationAction(
  eventId: string,
  conversationId: string
): Promise<EventActionState> {
  const userId = await getAuthedUserId();
  if (!userId) return { ok: false, message: "Log in first." };
  if (!uuidSchema.safeParse(eventId).success) return { ok: false, message: "Event not found." };
  if (!uuidSchema.safeParse(conversationId).success) {
    return { ok: false, message: "Conversation not found." };
  }

  /* The sender must be able to see the Event before they can pass it on. This
   * is the same authority the recipient will face -- it just refuses earlier,
   * so an id nobody may open cannot be posted into a chat. */
  const view = await getEventViewForViewer(userId, eventId);
  if (!view) return { ok: false, message: "Event not found." };
  if (view.status === "draft") {
    // A draft has no shareable identity yet; its link would refuse everybody.
    return { ok: false, message: "Publish this event before sharing it." };
  }

  const origin = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "") ?? "";
  const link = `${origin}/events/${eventId}`;
  const when = new Date(view.startsAt).toLocaleString([], {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit"
  });
  const place = [view.venueLabel, view.locality].filter(Boolean).join(", ");

  const { sendMessage } = await import("@/lib/messaging/mobile");
  const result = await sendMessage(userId, {
    conversationId,
    text: [view.name, when, place, link].filter(Boolean).join("\n"),
    /* REQUIRED by sendMessage, and its absence is why sharing into a chat
     * silently wrote nothing: the schema rejected the whole call, so the person
     * saw only "Check your message and try again." while no row was ever
     * written. Nothing in the UI distinguished that from a real failure.
     *
     * Freshly generated per send rather than derived from (sender, event,
     * conversation). A deterministic key would make the FIRST share permanent
     * and every later one a silent no-op -- sharing the same Event into the
     * same chat again next week is a legitimate thing to do, not a duplicate.
     * A lost response still retries this exact id, which is the case dedupe is
     * actually for. */
    clientMessageId: crypto.randomUUID()
  });
  return result.ok
    ? { ok: true, message: "Event shared." }
    : { ok: false, message: result.message };
}

/** Eligible Muddies and Groups for the audience pickers. */
export async function getAudienceOptionsAction(): Promise<{
  invitees: InviteeOption[];
  communities: CommunityOption[];
}> {
  const userId = await getAuthedUserId();
  if (!userId) return { invitees: [], communities: [] };
  const [invitees, communities] = await Promise.all([
    listInviteeOptions(userId),
    listCommunityOptions(userId)
  ]);
  return { invitees, communities };
}

// ---------------------------------------------------------------------------
// EVENT ROOMS -- read surfaces
//
// "Event Room" is what the product calls an event_circle. These actions are the
// only way the client reaches Room state, and every one of them re-derives
// authority from the session rather than trusting an id from the caller.
// ---------------------------------------------------------------------------

export async function listEventRoomsAction(eventId: string, includeUnlisted = false) {
  if (missingEnvState()) return [];
  if (!uuidSchema.safeParse(eventId).success) return [];
  const userId = await getAuthedUserId();
  if (!userId) return [];

  const admin = createSupabaseAdminClient();
  // Unlisted Rooms are only ever included for someone who operates the Event.
  // A client asking for them is not permission to receive them.
  const allowUnlisted = includeUnlisted && (await isEventOperator(admin, eventId, userId));
  return listEventRooms(admin, userId, eventId, { includeUnlisted: allowUnlisted });
}

export async function getEventRoomAction(roomId: string) {
  if (missingEnvState()) return null;
  if (!uuidSchema.safeParse(roomId).success) return null;
  const userId = await getAuthedUserId();
  if (!userId) return null;
  return getEventRoom(createSupabaseAdminClient(), userId, roomId);
}

export async function listRoomMembersAction(roomId: string) {
  if (missingEnvState()) return [];
  if (!uuidSchema.safeParse(roomId).success) return [];
  const userId = await getAuthedUserId();
  if (!userId) return [];
  return listRoomMembers(createSupabaseAdminClient(), userId, roomId);
}

export async function listRoomNoticesAction(roomId: string) {
  if (missingEnvState()) return [];
  if (!uuidSchema.safeParse(roomId).success) return [];
  const userId = await getAuthedUserId();
  if (!userId) return [];
  return listRoomNotices(createSupabaseAdminClient(), userId, roomId);
}

// ---------------------------------------------------------------------------
// EVENT ROOMS -- settings
// ---------------------------------------------------------------------------

/**
 * Save Room Settings.
 *
 * Every control on the Settings screen persists here. "Show in event" is a real
 * column (listed_in_event) rather than local state, and it controls LISTING
 * only -- an unlisted Room is still reachable by the people already in it and
 * by anyone holding its QR or an invitation. Hiding is not revoking.
 */
export async function updateEventRoomAction(input: unknown): Promise<EventActionState> {
  const missing = missingEnvState();
  if (missing) return missing;

  const schema = z.object({
    roomId: uuidSchema,
    name: z.string().min(1).max(80).optional(),
    description: z.string().max(500).nullable().optional(),
    joinMode: z.enum(["invite", "check_in", "qr", "community"]).optional(),
    maxMembers: z.number().int().min(1).max(5000).optional(),
    status: z.enum(["draft", "open", "active", "closing", "archived"]).optional(),
    listed: z.boolean().optional(),
    groupConversationIds: z.array(uuidSchema).max(20).optional()
  });
  const parsed = schema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Check the room settings and try again." };

  const userId = await getAuthedUserId();
  if (!userId) return { ok: false, message: "Log in first." };

  const admin = createSupabaseAdminClient();
  const manage = await canManageRoom(admin, userId, parsed.data.roomId);
  if (!manage.allowed) return { ok: false, message: "You cannot manage this room." };

  const { data: room } = await admin
    .from("event_circles")
    .select("id, owner_id, status, max_members, join_mode")
    .eq("id", parsed.data.roomId)
    .maybeSingle();
  if (!room) return { ok: false, message: "Room not found." };

  // Typed against the table rather than Record<string, unknown>, so a typo in a
  // column name is a compile error instead of a silently ignored update.
  const update: Database["public"]["Tables"]["event_circles"]["Update"] = {
    updated_at: new Date().toISOString()
  };
  if (parsed.data.name !== undefined) update.name = parsed.data.name.trim();
  if (parsed.data.description !== undefined) {
    update.description = parsed.data.description?.trim() || null;
  }
  if (parsed.data.listed !== undefined) update.listed_in_event = parsed.data.listed;

  // The member limit is still bounded by the Room owner's tier. A host may
  // lower it below the current member count -- existing members are never
  // ejected by a settings change, the Room simply stops admitting new ones.
  if (parsed.data.maxMembers !== undefined) {
    const ownerAccess = await getCurrentSubscriptionAccess(room.owner_id);
    update.max_members = Math.min(parsed.data.maxMembers, eventCircleMaxMembersFor(ownerAccess.plan));
  }

  if (parsed.data.joinMode !== undefined) {
    // Switching TO group-gated without targets would produce a Room nobody can
    // join. Refuse rather than silently create a dead Room.
    if (parsed.data.joinMode === "community") {
      const targets = parsed.data.groupConversationIds;
      const { count } = await admin
        .from("event_circle_group_targets")
        .select("id", { count: "exact", head: true })
        .eq("event_circle_id", parsed.data.roomId);
      if ((targets?.length ?? count ?? 0) === 0) {
        return { ok: false, message: "Choose at least one group for a group-only room." };
      }
    }
    update.join_mode = parsed.data.joinMode;
  }

  // Status changes follow the same server-authoritative transition table as
  // everything else; archiving goes through its own RPC so chat closes with it.
  if (parsed.data.status !== undefined && parsed.data.status !== room.status) {
    if (!canTransitionEventCircle(room.status, parsed.data.status)) {
      return { ok: false, message: "That status change is not allowed." };
    }
    if (parsed.data.status === "archived") {
      const access = await getCurrentSubscriptionAccess(room.owner_id);
      const { error: archiveError } = await admin.rpc("archive_event_room", {
        p_room_id: parsed.data.roomId,
        p_archives_at: archivesAtNullable(access.plan)
      });
      if (archiveError) return { ok: false, message: "Couldn't archive the room." };
    } else {
      update.status = parsed.data.status;
    }
  }

  if (parsed.data.groupConversationIds !== undefined) {
    // Replace the target set, but only with Groups the actor is actually in --
    // otherwise a host could grant Room access to a Group they have no standing
    // in using nothing but its id.
    const wanted = parsed.data.groupConversationIds;
    if (wanted.length > 0) {
      const { data: mine } = await admin
        .from("conversation_members")
        .select("conversation_id")
        .eq("user_id", userId)
        .eq("status", "joined")
        .in("conversation_id", wanted);
      const allowed = new Set((mine ?? []).map((row) => row.conversation_id));
      if (wanted.some((id) => !allowed.has(id))) {
        return { ok: false, message: "You can only choose groups you are in." };
      }
    }
    await admin.from("event_circle_group_targets").delete().eq("event_circle_id", parsed.data.roomId);
    if (wanted.length > 0) {
      await admin.from("event_circle_group_targets").insert(
        wanted.map((groupId) => ({
          event_circle_id: parsed.data.roomId,
          group_conversation_id: groupId
        }))
      );
    }
  }

  if (Object.keys(update).length > 1) {
    const { error } = await admin.from("event_circles").update(update).eq("id", parsed.data.roomId);
    if (error) return { ok: false, message: "Couldn't save the room settings." };
  }

  // Names and roles surface in the conversation, so reconcile after any change.
  await admin.rpc("reconcile_event_room_conversation", { p_room_id: parsed.data.roomId });
  return { ok: true, message: "Room settings saved.", circleId: parsed.data.roomId };
}

// ---------------------------------------------------------------------------
// EVENT ROOMS -- invitations
//
// The row IS the invitation. This is what makes "invite only" mean invited
// rather than "holding a token somebody forwarded".
// ---------------------------------------------------------------------------

export async function inviteToEventRoomAction(input: unknown): Promise<EventActionState> {
  const missing = missingEnvState();
  if (missing) return missing;

  const schema = z.object({ roomId: uuidSchema, userIds: z.array(uuidSchema).min(1).max(50) });
  const parsed = schema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Check who you are inviting and try again." };

  const userId = await getAuthedUserId();
  if (!userId) return { ok: false, message: "Log in first." };

  const admin = createSupabaseAdminClient();
  const manage = await canManageRoom(admin, userId, parsed.data.roomId);
  if (!manage.allowed) return { ok: false, message: "You cannot invite people to this room." };

  const { data: room } = await admin
    .from("event_circles")
    .select("id, name, status")
    .eq("id", parsed.data.roomId)
    .maybeSingle();
  if (!room) return { ok: false, message: "Room not found." };
  if (!isEventCircleWritable(room.status)) return { ok: false, message: "This room is closed." };

  // A banned person must not be invitable back in by a co-host who did not
  // know. The ban outranks the invitation.
  const { data: banned } = await admin
    .from("event_circle_members")
    .select("user_id")
    .eq("event_circle_id", parsed.data.roomId)
    .eq("status", "banned")
    .in("user_id", parsed.data.userIds);
  const bannedIds = new Set((banned ?? []).map((row) => row.user_id));
  const invitable = parsed.data.userIds.filter((id) => !bannedIds.has(id));
  if (invitable.length === 0) return { ok: false, message: "Those people cannot be invited." };

  const { error } = await admin.from("event_circle_invitations").upsert(
    invitable.map((invitedId) => ({
      event_circle_id: parsed.data.roomId,
      invited_user_id: invitedId,
      invited_by: userId,
      status: "pending",
      updated_at: new Date().toISOString()
    })),
    { onConflict: "event_circle_id,invited_user_id" }
  );
  if (error) return { ok: false, message: "Couldn't send the invitations." };

  await Promise.all(
    invitable.map((invitedId) =>
      deliverNotification(admin, {
        userId: invitedId,
        senderId: userId,
        category: "plans",
        // Deep link carrying both ids, so tapping opens THIS Room rather than
        // generic Events Home.
        type: `event_room:${manage.eventId ?? ""}:${parsed.data.roomId}`,
        title: room.name,
        message: `You have been invited to ${room.name}.`
      })
    )
  );

  return { ok: true, message: `Invited ${invitable.length}.`, circleId: parsed.data.roomId };
}

// ---------------------------------------------------------------------------
// EVENT ROOMS -- moderation
// ---------------------------------------------------------------------------

export async function setEventRoomMemberStatusAction(input: unknown): Promise<EventActionState> {
  const missing = missingEnvState();
  if (missing) return missing;

  const schema = z.object({
    roomId: uuidSchema,
    userId: uuidSchema,
    status: z.enum(["removed", "banned"])
  });
  const parsed = schema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Check the request and try again." };

  const actorId = await getAuthedUserId();
  if (!actorId) return { ok: false, message: "Log in first." };

  const admin = createSupabaseAdminClient();
  const manage = await canManageRoom(admin, actorId, parsed.data.roomId);
  if (!manage.allowed) return { ok: false, message: "You cannot manage this room." };

  const { data: room } = await admin
    .from("event_circles")
    .select("owner_id")
    .eq("id", parsed.data.roomId)
    .maybeSingle();
  // The Room owner cannot be removed from their own Room by anyone.
  if (!room || room.owner_id === parsed.data.userId) {
    return { ok: false, message: "You cannot remove the host." };
  }

  const { error } = await admin.rpc("set_event_room_membership", {
    p_room_id: parsed.data.roomId,
    p_user_id: parsed.data.userId,
    p_status: parsed.data.status
  });
  if (error) return { ok: false, message: "Couldn't update that member." };

  return {
    ok: true,
    message: parsed.data.status === "banned" ? "Member banned." : "Member removed.",
    circleId: parsed.data.roomId
  };
}

export async function setEventRoomRoleAction(input: unknown): Promise<EventActionState> {
  const missing = missingEnvState();
  if (missing) return missing;

  const schema = z.object({
    roomId: uuidSchema,
    userId: uuidSchema,
    role: z.enum(["co_host", "moderator", "member"])
  });
  const parsed = schema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Check the request and try again." };

  const actorId = await getAuthedUserId();
  if (!actorId) return { ok: false, message: "Log in first." };

  const admin = createSupabaseAdminClient();
  const manage = await canManageRoom(admin, actorId, parsed.data.roomId);
  // Only the Room host promotes. A co-host managing members must not be able to
  // mint more co-hosts.
  if (!manage.allowed || manage.role !== "host") {
    return { ok: false, message: "Only the room host can change roles." };
  }

  const { error } = await admin.rpc("set_event_room_role", {
    p_room_id: parsed.data.roomId,
    p_user_id: parsed.data.userId,
    p_role: parsed.data.role
  });
  if (error) return { ok: false, message: "Couldn't change that role." };
  return { ok: true, message: "Role updated.", circleId: parsed.data.roomId };
}

// ---------------------------------------------------------------------------
// EVENT ROOMS -- Notice reactions
//
// The reference shows reactions on a Room notice, so they are real. One per
// person per notice, changeable, tapping the same one again clears it.
// ---------------------------------------------------------------------------

export async function setRoomNoticeReactionAction(input: unknown): Promise<EventActionState> {
  const missing = missingEnvState();
  if (missing) return missing;

  const schema = z.object({
    noticeId: uuidSchema,
    reaction: z.enum(["heart", "fire", "applause", "wow"]).nullable()
  });
  const parsed = schema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Couldn't react to that." };

  const userId = await getAuthedUserId();
  if (!userId) return { ok: false, message: "Log in first." };

  const admin = createSupabaseAdminClient();
  const { data: notice } = await admin
    .from("event_announcements")
    .select("id, event_circle_id")
    .eq("id", parsed.data.noticeId)
    .maybeSingle();
  if (!notice) return { ok: false, message: "That notice is gone." };

  // Only a joined member of the Room may react. Holding a notice id is not
  // membership.
  const access = await resolveEventCircleAccess(admin, userId, notice.event_circle_id);
  if (!access.isMember) return { ok: false, message: "Join the room first." };

  const { data: room } = await admin
    .from("event_circles")
    .select("status")
    .eq("id", notice.event_circle_id)
    .maybeSingle();
  if (!room || !isEventCircleWritable(room.status)) {
    return { ok: false, message: "This room is read-only now." };
  }

  if (parsed.data.reaction === null) {
    await admin
      .from("event_announcement_reactions")
      .delete()
      .eq("event_announcement_id", parsed.data.noticeId)
      .eq("user_id", userId);
    return { ok: true, message: "Reaction removed." };
  }

  // The unique constraint is what stops a double tap inflating the count: the
  // second tap updates the same row rather than adding one.
  const { error } = await admin.from("event_announcement_reactions").upsert(
    {
      event_announcement_id: parsed.data.noticeId,
      user_id: userId,
      reaction_type: parsed.data.reaction,
      updated_at: new Date().toISOString()
    },
    { onConflict: "event_announcement_id,user_id" }
  );
  if (error) return { ok: false, message: "Couldn't react to that." };
  return { ok: true, message: "Reaction saved." };
}

// ---------------------------------------------------------------------------
// EVENT + ROOM QR
//
// A QR carries a signed, expiring, purpose-bound, context-bound token and
// NOTHING else -- no user data, no secrets, no database ids beyond the context
// the token is for. Minting is server-side and authorized; the client renders
// the string it is given and can neither forge nor extend one.
//
// The 5-minute lifetime is what makes a photographed QR stop working. Refresh
// mints a fresh token rather than extending the old one, because extending
// would mean the token said one expiry and meant another.
// ---------------------------------------------------------------------------

const QR_TOKEN_TTL_MS = 5 * 60 * 1000;

/**
 * Mint an Event check-in QR. Host and Event admins only: a check-in code is the
 * authority to mark people present at someone else's Event.
 */
export async function createEventCheckInQrAction(
  eventId: string
): Promise<{ ok: boolean; message: string; token?: string; expiresAtMs?: number; eventName?: string }> {
  const missing = missingEnvState();
  if (missing) return { ok: false, message: missing.message };
  if (!uuidSchema.safeParse(eventId).success) return { ok: false, message: "Event not found." };

  const userId = await getAuthedUserId();
  if (!userId) return { ok: false, message: "Log in first." };

  const secret = eventTokenSecret();
  if (!secret) return { ok: false, message: "This action needs the server database configuration." };

  const admin = createSupabaseAdminClient();
  if (!(await isEventOperator(admin, eventId, userId))) {
    return { ok: false, message: "Only the host can show the check-in code." };
  }

  const { data: event } = await admin.from("events").select("name, status").eq("id", eventId).maybeSingle();
  if (!event) return { ok: false, message: "Event not found." };
  // A cancelled or ended Event must not mint codes that would check people in.
  if (event.status === "cancelled" || event.status === "ended") {
    return { ok: false, message: "This event is over." };
  }

  const expiresAtMs = Date.now() + QR_TOKEN_TTL_MS;
  return {
    ok: true,
    message: "Code ready.",
    token: createEventToken({ contextId: eventId, purpose: "check_in", expiresAtMs }, secret),
    expiresAtMs,
    eventName: event.name
  };
}

/**
 * Mint a Room join QR. Anyone who may manage the Room -- its host or co-host,
 * or an operator of the Event it belongs to.
 */
export async function createRoomJoinQrAction(
  roomId: string
): Promise<{ ok: boolean; message: string; token?: string; expiresAtMs?: number; roomName?: string }> {
  const missing = missingEnvState();
  if (missing) return { ok: false, message: missing.message };
  if (!uuidSchema.safeParse(roomId).success) return { ok: false, message: "Room not found." };

  const userId = await getAuthedUserId();
  if (!userId) return { ok: false, message: "Log in first." };

  const secret = eventTokenSecret();
  if (!secret) return { ok: false, message: "This action needs the server database configuration." };

  const admin = createSupabaseAdminClient();
  const manage = await canManageRoom(admin, userId, roomId);
  if (!manage.allowed) return { ok: false, message: "You cannot share this room." };

  const { data: room } = await admin
    .from("event_circles")
    .select("name, status")
    .eq("id", roomId)
    .maybeSingle();
  if (!room) return { ok: false, message: "Room not found." };
  // A closed Room must not mint join codes. The scan would be refused anyway;
  // refusing to mint means the host is told now rather than the guest later.
  if (!isEventCircleWritable(room.status)) return { ok: false, message: "This room is closed." };

  const expiresAtMs = Date.now() + QR_TOKEN_TTL_MS;
  return {
    ok: true,
    message: "Code ready.",
    token: createEventToken({ contextId: roomId, purpose: "circle_join", expiresAtMs }, secret),
    expiresAtMs,
    roomName: room.name
  };
}

// ---------------------------------------------------------------------------
// HOST TOOLS -- Guest List
//
// Built from existing participation truth: RSVPs and live check-ins. No new
// attendance store, and deliberately no contact details -- a host needs to know
// who is coming and who has arrived, which is display identity, not an export
// of their guests' account records.
// ---------------------------------------------------------------------------

export async function listEventGuestsAction(eventId: string) {
  if (missingEnvState()) return { going: 0, checkedIn: 0, interested: 0, guests: [] };
  if (!uuidSchema.safeParse(eventId).success) {
    return { going: 0, checkedIn: 0, interested: 0, guests: [] };
  }

  const userId = await getAuthedUserId();
  if (!userId) return { going: 0, checkedIn: 0, interested: 0, guests: [] };

  const admin = createSupabaseAdminClient();
  // The guest list is operational information for whoever runs the Event.
  if (!(await isEventOperator(admin, eventId, userId))) {
    return { going: 0, checkedIn: 0, interested: 0, guests: [] };
  }

  const [{ data: rsvps }, { data: checkIns }, { data: invites }] = await Promise.all([
    admin.from("event_rsvps").select("user_id, status").eq("event_id", eventId),
    admin
      .from("check_ins")
      .select("user_id, checked_in_at")
      .eq("context_type", "event")
      .eq("context_id", eventId)
      .eq("status", "checked_in"),
    admin.from("event_audience_targets").select("target_id").eq("event_id", eventId).eq("target_type", "user")
  ]);

  const checkedInIds = new Map((checkIns ?? []).map((row) => [row.user_id, row.checked_in_at] as const));
  const rsvpById = new Map((rsvps ?? []).map((row) => [row.user_id, row.status] as const));
  const invitedIds = new Set((invites ?? []).map((row) => row.target_id));

  const userIds = Array.from(
    new Set([...rsvpById.keys(), ...checkedInIds.keys(), ...invitedIds])
  ).filter(Boolean);
  if (userIds.length === 0) return { going: 0, checkedIn: 0, interested: 0, guests: [] };

  const { data: profiles } = await admin
    .from("profiles")
    .select("user_id, full_name, avatar_url")
    .in("user_id", userIds);
  const byId = new Map((profiles ?? []).map((profile) => [profile.user_id, profile] as const));

  const guests = userIds
    .map((id) => {
      const profile = byId.get(id);
      return {
        userId: id,
        displayName: profile?.full_name ?? "Someone",
        avatarUrl: profile?.avatar_url ?? null,
        rsvp: rsvpById.get(id) ?? null,
        invited: invitedIds.has(id),
        checkedIn: checkedInIds.has(id),
        checkedInAt: checkedInIds.get(id) ?? null
      };
    })
    // Arrived first, then going, then everyone else: the list is read during an
    // Event, when who is actually here is the useful ordering.
    .sort((a, b) => {
      if (a.checkedIn !== b.checkedIn) return a.checkedIn ? -1 : 1;
      const rank = (status: string | null) => (status === "going" ? 0 : status === "interested" ? 1 : 2);
      return rank(a.rsvp) - rank(b.rsvp) || a.displayName.localeCompare(b.displayName);
    });

  return {
    going: guests.filter((guest) => guest.rsvp === "going").length,
    interested: guests.filter((guest) => guest.rsvp === "interested").length,
    checkedIn: guests.filter((guest) => guest.checkedIn).length,
    guests
  };
}

// ---------------------------------------------------------------------------
// HOST TOOLS -- End Event
//
// Not decorative. Ends the Event, and moves its Rooms to 'closing' rather than
// deleting them: an after-party conversation should not be destroyed because
// the calendar says the Event finished. Nothing attendees wrote is deleted.
// ---------------------------------------------------------------------------

export async function endEventAction(eventId: string): Promise<EventActionState> {
  const missing = missingEnvState();
  if (missing) return missing;
  if (!uuidSchema.safeParse(eventId).success) return { ok: false, message: "Event not found." };

  const userId = await getAuthedUserId();
  if (!userId) return { ok: false, message: "Log in first." };

  const admin = createSupabaseAdminClient();
  const { data: event } = await admin
    .from("events")
    .select("id, host_id, status, name")
    .eq("id", eventId)
    .maybeSingle();
  if (!event) return { ok: false, message: "Event not found." };
  // Ending an Event is the host's call alone, not an Event admin's.
  if (event.host_id !== userId) return { ok: false, message: "Only the host can end this event." };
  if (event.status === "ended") return { ok: true, message: "This event has already ended." };
  if (event.status === "cancelled") return { ok: false, message: "This event was cancelled." };

  const { error } = await admin
    .from("events")
    .update({ status: "ended", updated_at: new Date().toISOString() })
    .eq("id", eventId)
    .eq("host_id", userId);
  if (error) return { ok: false, message: "Couldn't end the event." };

  // Deterministic Room transition: open/active Rooms move to closing. History
  // stays readable and existing members keep talking; no new members join.
  await admin.rpc("close_event_rooms_for_event", { p_event_id: eventId });

  return { ok: true, message: `${event.name} has ended.`, eventId };
}

/**
 * The Groups the viewer may point a Group-gated Room at.
 *
 * Only Groups they are a joined member of: targeting a Group you have no
 * standing in would let a host grant Room access to somebody else's community
 * using nothing but its id. The RPCs enforce the same rule again on write --
 * this list is a convenience, never the authorization.
 */
export async function listRoomGroupOptionsAction() {
  if (missingEnvState()) return [];
  const userId = await getAuthedUserId();
  if (!userId) return [];

  const admin = createSupabaseAdminClient();
  const { data: memberships } = await admin
    .from("conversation_members")
    .select("conversation_id")
    .eq("user_id", userId)
    .eq("status", "joined");
  const ids = (memberships ?? []).map((row) => row.conversation_id);
  if (ids.length === 0) return [];

  const { data: groups } = await admin
    .from("conversations")
    .select("id")
    .eq("conversation_type", "group")
    .eq("status", "active")
    .in("id", ids);
  const groupIds = (groups ?? []).map((row) => row.id);
  if (groupIds.length === 0) return [];

  const { data: settings } = await admin
    .from("group_settings")
    .select("conversation_id, name")
    .in("conversation_id", groupIds);

  return (settings ?? [])
    .map((row) => ({ id: row.conversation_id, name: row.name }))
    .sort((a, b) => a.name.localeCompare(b.name));
}
