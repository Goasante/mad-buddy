import "server-only";

import { z } from "zod";
import { resolveCheckInWindow } from "@/lib/events/rules";
import { liveCheckIn } from "@/lib/events/service";
import { consumeRateLimit, rateLimitMessage } from "@/lib/security/rate-limit";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getSupabaseServerEnv } from "@/lib/supabase/env";
import type { CheckInVisibility } from "@/lib/events/types";

/**
 * Transport-agnostic Events read/create (mobile v1: list + create). Check-in,
 * QR, glow, and event circles stay in event-actions.ts (web-only for now). The
 * web getEventsAction/createEventAction are thin wrappers over these.
 */

export type EventView = {
  id: string;
  name: string;
  description: string | null;
  venueLabel: string | null;
  startsAt: string;
  endsAt: string;
  status: string;
  hostName: string;
  isHost: boolean;
  myCheckInId: string | null;
  myGlowEnabled: boolean;
};

export type EventResult = { ok: boolean; message: string; eventId?: string; checkInId?: string };

const uuidSchema = z.string().uuid();

export const createEventSchema = z.object({
  name: z.string().min(2).max(120),
  description: z.string().max(1000).optional(),
  venueLabel: z.string().max(160).optional(),
  startsAt: z.string().datetime({ offset: true }),
  endsAt: z.string().datetime({ offset: true })
});

function hasServiceRoleEnv(): boolean {
  const env = getSupabaseServerEnv();
  return Boolean(env.url && env.serviceRoleKey);
}

export async function listEvents(userId: string): Promise<EventView[]> {
  if (!hasServiceRoleEnv()) return [];

  const admin = createSupabaseAdminClient();
  const nowIso = new Date().toISOString();
  const { data: events } = await admin
    .from("events")
    .select("id, host_id, name, description, venue_label, starts_at, ends_at, visibility, status")
    .in("status", ["scheduled", "active"])
    .gte("ends_at", nowIso)
    .order("starts_at", { ascending: true })
    .limit(100);
  if (!events?.length) return [];

  const visible = events.filter((event) => event.visibility !== "invite" || event.host_id === userId);
  if (visible.length === 0) return [];

  const [{ data: checkIns }, { data: hosts }] = await Promise.all([
    admin
      .from("check_ins")
      .select("id, context_id, event_glow_enabled")
      .eq("user_id", userId)
      .eq("context_type", "event")
      .eq("status", "checked_in")
      .in(
        "context_id",
        visible.map((event) => event.id)
      ),
    admin
      .from("profiles")
      .select("user_id, full_name")
      .in("user_id", [...new Set(visible.map((event) => event.host_id))])
  ]);

  const checkInByEvent = new Map((checkIns ?? []).map((row) => [row.context_id, row]));
  const hostNames = new Map((hosts ?? []).map((row) => [row.user_id, row.full_name]));

  return visible.map((event) => {
    const checkIn = checkInByEvent.get(event.id);
    return {
      id: event.id,
      name: event.name,
      description: event.description,
      venueLabel: event.venue_label,
      startsAt: event.starts_at,
      endsAt: event.ends_at,
      status: event.status,
      hostName: event.host_id === userId ? "You" : hostNames.get(event.host_id)?.trim() || "A Muddy",
      isHost: event.host_id === userId,
      myCheckInId: checkIn?.id ?? null,
      myGlowEnabled: checkIn?.event_glow_enabled ?? false
    };
  });
}

export async function createEvent(userId: string, input: unknown): Promise<EventResult> {
  if (!hasServiceRoleEnv()) {
    return { ok: false, message: "This action needs the server database configuration." };
  }

  const parsed = createEventSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Check the event details and try again." };

  const startsMs = Date.parse(parsed.data.startsAt);
  const endsMs = Date.parse(parsed.data.endsAt);
  if (endsMs <= startsMs) return { ok: false, message: "The event must end after it starts." };

  const rateLimit = await consumeRateLimit({ action: "events.create", userId });
  if (!rateLimit.allowed) return { ok: false, message: rateLimitMessage(rateLimit.resetAt) };

  const admin = createSupabaseAdminClient();
  const { data: event, error } = await admin
    .from("events")
    .insert({
      host_id: userId,
      name: parsed.data.name.trim(),
      description: parsed.data.description?.trim() || null,
      venue_label: parsed.data.venueLabel?.trim() || null,
      starts_at: parsed.data.startsAt,
      ends_at: parsed.data.endsAt,
      visibility: "community",
      status: "scheduled"
    })
    .select("id")
    .single();
  if (error || !event) return { ok: false, message: "Couldn't create the event." };

  {
    const { grantAchievement } = await import("@/lib/engagement/achievements");
    await grantAchievement(admin, userId, "event_host");
  }
  return { ok: true, message: `${parsed.data.name.trim()} created.`, eventId: event.id };
}

/** Simple manual check-in (no QR). Mobile v1 of checkInToEventAction. */
export async function checkInToEvent(userId: string, eventId: string): Promise<EventResult> {
  if (!hasServiceRoleEnv()) return { ok: false, message: "This action needs the server database configuration." };
  if (!uuidSchema.safeParse(eventId).success) return { ok: false, message: "Event not found." };

  const admin = createSupabaseAdminClient();
  const { data: event } = await admin
    .from("events")
    .select("id, name, host_id, visibility, status, starts_at, ends_at, checkin_opens_minutes_before")
    .eq("id", eventId)
    .maybeSingle();
  if (!event || (event.visibility === "invite" && event.host_id !== userId)) {
    return { ok: false, message: "Event not found." };
  }

  const window = resolveCheckInWindow({
    eventStatus: event.status,
    startsAtMs: Date.parse(event.starts_at),
    endsAtMs: Date.parse(event.ends_at),
    opensMinutesBefore: event.checkin_opens_minutes_before,
    nowMs: Date.now()
  });
  if (!window.allowed) {
    return {
      ok: false,
      message:
        window.reason === "too_early"
          ? "Check-in isn't open yet."
          : window.reason === "event_ended"
            ? "This event has ended."
            : "This event isn't available."
    };
  }

  const existing = await liveCheckIn(admin, userId, "event", eventId);
  if (existing) return { ok: true, message: `You're already checked in to ${event.name}.`, checkInId: existing.id };

  const { data: checkIn, error } = await admin
    .from("check_ins")
    .insert({
      user_id: userId,
      context_type: "event",
      context_id: eventId,
      method: "manual",
      visibility: "participants" as CheckInVisibility,
      event_glow_enabled: true,
      status: "checked_in"
    })
    .select("id")
    .single();

  if (error || !checkIn) {
    const retry = await liveCheckIn(admin, userId, "event", eventId);
    if (retry) return { ok: true, message: `You're already checked in to ${event.name}.`, checkInId: retry.id };
    return { ok: false, message: "Couldn't check you in. Try again." };
  }

  {
    const { grantAchievement } = await import("@/lib/engagement/achievements");
    await grantAchievement(admin, userId, "event_explorer");
  }
  return { ok: true, message: `Checked in to ${event.name}.`, checkInId: checkIn.id };
}

export async function checkOutEvent(userId: string, checkInId: string): Promise<EventResult> {
  if (!hasServiceRoleEnv()) return { ok: false, message: "This action needs the server database configuration." };
  if (!uuidSchema.safeParse(checkInId).success) return { ok: false, message: "Check-in not found." };

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
  return { ok: true, message: "Checked out." };
}
