"use server";

import { z } from "zod";
import { guardFeature } from "@/lib/admin/enforcement";
import { deliverNotification } from "@/lib/notifications/server";
import { getCurrentSubscriptionAccess } from "@/lib/premium/access";
import { verifyEventToken } from "@/lib/events/qr";
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
  eventCircleMemberCount,
  eventTokenSecret,
  liveCheckIn,
  resolveEventCircleAccess
} from "@/lib/events/service";
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

  const admin = createSupabaseAdminClient();
  const { data: event } = await admin
    .from("events")
    .select("id, name, status, starts_at, ends_at, checkin_opens_minutes_before")
    .eq("id", parsed.data.eventId)
    .maybeSingle();
  if (!event) return { ok: false, message: "Event not found." };

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

export async function joinEventCircleAction(
  circleId: string,
  token?: string
): Promise<EventActionState> {
  const missing = missingEnvState();
  if (missing) return missing;
  if (!uuidSchema.safeParse(circleId).success) return { ok: false, message: "Circle not found." };

  const userId = await getAuthedUserId();
  if (!userId) return { ok: false, message: "Log in first." };

  const rateLimit = await consumeRateLimit({ action: "event_circles.join", userId });
  if (!rateLimit.allowed) return { ok: false, message: rateLimitMessage(rateLimit.resetAt) };

  const admin = createSupabaseAdminClient();
  const { data: circle } = await admin
    .from("event_circles")
    .select("id, event_id, name, status, join_mode, opens_at, max_members")
    .eq("id", circleId)
    .maybeSingle();
  if (!circle) return { ok: false, message: "Circle not found." };

  let hasValidToken = false;
  if (token) {
    const secret = eventTokenSecret();
    const verified = secret ? verifyEventToken(token, secret, Date.now()) : null;
    hasValidToken =
      verified?.valid === true &&
      verified.payload.purpose === "circle_join" &&
      verified.payload.contextId === circleId;
  }

  const [{ data: member }, memberCount] = await Promise.all([
    admin
      .from("event_circle_members")
      .select("status")
      .eq("event_circle_id", circleId)
      .eq("user_id", userId)
      .maybeSingle(),
    eventCircleMemberCount(admin, circleId)
  ]);

  const hasEventCheckIn = circle.event_id
    ? Boolean(await liveCheckIn(admin, userId, "event", circle.event_id))
    : false;

  const decision = resolveJoinEventCircle({
    status: circle.status,
    joinMode: circle.join_mode,
    memberStatus: member?.status ?? null,
    memberCount,
    maxMembers: circle.max_members,
    hasEventCheckIn,
    hasValidToken,
    opensAtMs: circle.opens_at ? Date.parse(circle.opens_at) : null,
    nowMs: Date.now()
  });

  if (!decision.allowed) {
    const messages: Record<JoinCircleReason, string> = {
      allowed: "",
      // Deliberately generic: a banned user is never told they were banned.
      banned: "You can't join this circle.",
      already_joined: `You're already in ${circle.name}.`,
      closed: "This circle is closed.",
      not_open_yet: "This circle hasn't opened yet.",
      full: "This circle is full.",
      needs_check_in: "Check in to the event first.",
      needs_token: "You need an invite or QR code to join."
    };
    return { ok: decision.reason === "already_joined", message: messages[decision.reason] };
  }

  const { error } = await admin.from("event_circle_members").upsert(
    {
      event_circle_id: circleId,
      user_id: userId,
      role: "member",
      status: "joined",
      joined_at: new Date().toISOString(),
      left_at: null
    },
    { onConflict: "event_circle_id,user_id" }
  );
  if (error) return { ok: false, message: "Couldn't join the circle." };
  return { ok: true, message: `Joined ${circle.name}.`, circleId };
}

export async function leaveEventCircleAction(circleId: string): Promise<EventActionState> {
  const missing = missingEnvState();
  if (missing) return missing;
  if (!uuidSchema.safeParse(circleId).success) return { ok: false, message: "Circle not found." };

  const userId = await getAuthedUserId();
  if (!userId) return { ok: false, message: "Log in first." };

  const admin = createSupabaseAdminClient();
  const { error } = await admin
    .from("event_circle_members")
    .update({ status: "left", left_at: new Date().toISOString() })
    .eq("event_circle_id", circleId)
    .eq("user_id", userId)
    .eq("status", "joined");
  if (error) return { ok: false, message: "Couldn't leave the circle." };
  return { ok: true, message: "You've left this circle." };
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
  if (!parsed.success) return { ok: false, message: "Check the announcement and try again." };

  const userId = await getAuthedUserId();
  if (!userId) return { ok: false, message: "Log in first." };

  const rateLimit = await consumeRateLimit({ action: "event_announcements.send", userId });
  if (!rateLimit.allowed) return { ok: false, message: rateLimitMessage(rateLimit.resetAt) };

  const admin = createSupabaseAdminClient();
  const access = await resolveEventCircleAccess(admin, userId, parsed.data.circleId);
  if (!access.exists) return { ok: false, message: "Circle not found." };
  if (!access.role || !canSendAnnouncement(access.role)) {
    return { ok: false, message: "Only the host can send announcements." };
  }

  const { data: circle } = await admin
    .from("event_circles")
    .select("status, name")
    .eq("id", parsed.data.circleId)
    .maybeSingle();
  if (!circle || !isEventCircleWritable(circle.status)) {
    return { ok: false, message: "This circle is read-only now." };
  }

  const { error } = await admin.from("event_announcements").insert({
    event_circle_id: parsed.data.circleId,
    author_id: userId,
    title: parsed.data.title.trim(),
    body: parsed.data.body.trim(),
    priority: parsed.data.priority ?? "normal"
  });
  if (error) return { ok: false, message: "Couldn't send the announcement." };

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
        type: "event:announcement",
        title: circle.name,
        message: parsed.data.title.trim()
      })
    )
  );

  return { ok: true, message: `Announcement sent to ${(members ?? []).length} members.` };
}

export async function archiveEventCircleAction(circleId: string): Promise<EventActionState> {
  const missing = missingEnvState();
  if (missing) return missing;
  if (!uuidSchema.safeParse(circleId).success) return { ok: false, message: "Circle not found." };

  const userId = await getAuthedUserId();
  if (!userId) return { ok: false, message: "Log in first." };

  const admin = createSupabaseAdminClient();
  const { data: circle } = await admin
    .from("event_circles")
    .select("id, owner_id, status")
    .eq("id", circleId)
    .maybeSingle();
  if (!circle) return { ok: false, message: "Circle not found." };
  if (circle.owner_id !== userId) return { ok: false, message: "Only the host can archive this circle." };
  if (!canTransitionEventCircle(circle.status, "archived")) {
    return { ok: false, message: "This circle can't be archived." };
  }

  const access = await getCurrentSubscriptionAccess(userId);
  const nowMs = Date.now();
  await admin
    .from("event_circles")
    .update({
      status: "archived",
      closes_at: new Date(nowMs).toISOString(),
      /* null when retention is unlimited, which it now is on every tier. The
         column is nullable and "no archive date" is the honest value -- the
         previous expression threw RangeError on a non-finite timestamp. */
      archives_at: (() => {
        const at = archivesAtMs(nowMs, access.plan);
        return at === null ? null : new Date(at).toISOString();
      })(),
      updated_at: new Date(nowMs).toISOString()
    })
    .eq("id", circleId)
    .eq("owner_id", userId);

  return { ok: true, message: "Circle archived. Content is read-only now." };
}

/** Host-only: capacity is bounded by the host's tier (spec §62). */
export async function createEventCircleAction(input: unknown): Promise<EventActionState> {
  const missing = missingEnvState();
  if (missing) return missing;

  const schema = z.object({
    name: z.string().min(1).max(80),
    description: z.string().max(500).optional(),
    eventId: uuidSchema.optional(),
    joinMode: z.enum(["invite", "check_in", "qr", "community"]).optional()
  });
  const parsed = schema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Check the circle details and try again." };

  const userId = await getAuthedUserId();
  if (!userId) return { ok: false, message: "Log in first." };

  const admin = createSupabaseAdminClient();
  const access = await getCurrentSubscriptionAccess(userId);

  const { data: circle, error } = await admin
    .from("event_circles")
    .insert({
      owner_id: userId,
      event_id: parsed.data.eventId ?? null,
      name: parsed.data.name.trim(),
      description: parsed.data.description?.trim() || null,
      join_mode: parsed.data.joinMode ?? "invite",
      status: "open",
      max_members: eventCircleMaxMembersFor(access.plan)
    })
    .select("id")
    .single();
  if (error || !circle) return { ok: false, message: "Couldn't create the circle." };

  await admin.from("event_circle_members").insert({
    event_circle_id: circle.id,
    user_id: userId,
    role: "host",
    status: "joined"
  });

  return { ok: true, message: `${parsed.data.name.trim()} created.`, circleId: circle.id };
}

// ---------------------------------------------------------------------------
// Events 2.0: Updates, reactions, admins
//
// Thin wrappers. Every rule lives in lib/events/updates.ts so the web actions,
// the mobile API and the tests all reach the same authority -- a permission
// re-implemented per transport is a permission that will eventually disagree
// with itself.
// ---------------------------------------------------------------------------

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
 * canViewEvent says: forwarding an invite-only Event into a Circle does not
 * invite the Circle. Only Events the SENDER may see can be shared, so this is
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

/** Eligible Muddies and Circles for the audience pickers. */
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
