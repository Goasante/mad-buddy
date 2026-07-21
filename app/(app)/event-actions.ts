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
import { createEvent, listEvents, type EventView } from "@/lib/events/mobile";
import type { CheckInVisibility, EventGlowMuddyList } from "@/lib/events/types";

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
      event_glow_enabled: parsed.data.eventGlowEnabled ?? true,
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
      archives_at: new Date(archivesAtMs(nowMs, access.plan)).toISOString(),
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
