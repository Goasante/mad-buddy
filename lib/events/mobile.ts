import "server-only";

import { z } from "zod";
import { isPastEvent, resolveCheckInWindow } from "@/lib/events/rules";
import { liveCheckIn } from "@/lib/events/service";
import { consumeRateLimit, rateLimitMessage } from "@/lib/security/rate-limit";
import { batchBlockedIds, isBlockedEitherDirection } from "@/lib/social/permissions";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getSupabaseServerEnv } from "@/lib/supabase/env";
import type { CheckInVisibility } from "@/lib/events/types";
import { loadEffectivePlansForUsers } from "@/lib/billing/service";
import type { EventRsvpStatus, SubscriptionPlan } from "@/lib/supabase/database.types";

/**
 * Transport-agnostic Events read/create (mobile v1: list + create). Check-in,
 * QR, glow, and event circles stay in event-actions.ts (web-only for now). The
 * web getEventsAction/createEventAction are thin wrappers over these.
 */

/**
 * Pre-event participation intent (Plans + Events lifecycle, Stage C).
 *
 * Separate from check-in by design: Going means "I intend to attend",
 * check-in means "I am here". A host is never one of these -- hosting is
 * derived from `isHost`, never fabricated as a row -- so `null` covers both
 * "never RSVP'd" and "is the host", and callers that need to tell those apart
 * already have `isHost` alongside this field.
 */
export function isEventRsvpStatus(value: string): value is EventRsvpStatus {
  return value === "interested" || value === "going" || value === "not_going";
}

export type EventView = {
  id: string;
  name: string;
  description: string | null;
  venueLabel: string | null;
  startsAt: string;
  endsAt: string;
  status: string;
  hostName: string;
  hostPlan: SubscriptionPlan;
  isHost: boolean;
  myCheckInId: string | null;
  myGlowEnabled: boolean;
  /** null: never RSVP'd (includes the host, who needs none). */
  myRsvp: EventRsvpStatus | null;
};

export type EventResult = { ok: boolean; message: string; eventId?: string; checkInId?: string };

const uuidSchema = z.string().uuid();

const rsvpStatusSchema = z.enum(["interested", "going", "not_going"]);

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

  const visibilityFiltered = events.filter((event) => event.visibility !== "invite" || event.host_id === userId);
  if (visibilityFiltered.length === 0) return [];

  // BLOCK GAP FIX (Plans + Events lifecycle, Stage C).
  //
  // Pre-existing hole, not new Stage C surface: listEvents filtered
  // visibility but never checked blocks at all, so a blocked host's events
  // were fully listable and joinable through this path regardless of what
  // block enforcement did everywhere else in the product. RSVP would
  // otherwise have shipped a new mutation on top of that hole rather than
  // closing it.
  //
  // The canonical helper, batched: batchBlockedIds is the same
  // isBlockedEitherDirection semantics behind one query for every host
  // instead of one per event, mirroring batchEligibleMuddyIds in the same
  // file for the identical reason -- up to 100 events must not become up to
  // 100 round trips.
  const hostIdsToCheck = [...new Set(visibilityFiltered.map((event) => event.host_id))];
  const blockedHostIds = await batchBlockedIds(admin, userId, hostIdsToCheck);
  // Fails closed: a host on either side of a block is dropped. The viewer's
  // own events survive this by construction -- batchBlockedIds already
  // excludes the viewer's own id from what it checks.
  const visible = visibilityFiltered.filter((event) => !blockedHostIds.has(event.host_id));
  if (visible.length === 0) return [];

  const hostIds = [...new Set(visible.map((event) => event.host_id))];
  const [{ data: checkIns }, { data: hosts }, hostPlans, { data: rsvps }] = await Promise.all([
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
      .in("user_id", hostIds),
    loadEffectivePlansForUsers(admin, hostIds),
    // The viewer's own RSVP only -- one row per event at most, enforced by
    // the (event_id, user_id) unique constraint. Never another user's row:
    // this is scoped to userId the same way the check-in read above is.
    admin
      .from("event_rsvps")
      .select("event_id, status")
      .eq("user_id", userId)
      .in(
        "event_id",
        visible.map((event) => event.id)
      )
  ]);

  const checkInByEvent = new Map((checkIns ?? []).map((row) => [row.context_id, row]));
  const hostNames = new Map((hosts ?? []).map((row) => [row.user_id, row.full_name]));
  const rsvpByEvent = new Map((rsvps ?? []).map((row) => [row.event_id, row.status]));

  return visible.map((event) => {
    const checkIn = checkInByEvent.get(event.id);
    const rsvpStatus = rsvpByEvent.get(event.id);
    return {
      id: event.id,
      name: event.name,
      description: event.description,
      venueLabel: event.venue_label,
      startsAt: event.starts_at,
      endsAt: event.ends_at,
      status: event.status,
      hostName: event.host_id === userId ? "You" : hostNames.get(event.host_id)?.trim() || "A Muddy",
      hostPlan: hostPlans.get(event.host_id) ?? "free",
      isHost: event.host_id === userId,
      myCheckInId: checkIn?.id ?? null,
      myGlowEnabled: checkIn?.event_glow_enabled ?? false,
      myRsvp: rsvpStatus && isEventRsvpStatus(rsvpStatus) ? rsvpStatus : null
    };
  });
}

/**
 * Server-authoritative RSVP mutation (Plans + Events lifecycle, Stage C).
 *
 * ONE canonical path. Interested, Going and Not Going all flow through this;
 * there is no separate "un-RSVP" mutation, because not_going IS the stored
 * state for "no longer interested" -- deleting the row would throw away the
 * explicit signal Stage D needs to suppress a reminder.
 *
 * VALIDATES EVERYTHING A CLIENT COULD LIE ABOUT, same shape checkInToEvent
 * already uses for the same table of concerns:
 *   - the event exists and is not soft-invisible to this viewer (draft/invite)
 *   - the host is not blocked from the viewer, in either direction
 *   - the event has not ended -- RSVPing to something already over is not a
 *     real intention, it is stale UI state from a tab left open
 *   - the event is not cancelled
 *
 * UPSERT ON (event_id, user_id), never insert-then-update: the unique
 * constraint from the migration is what makes Going -> Going -> Going produce
 * exactly one row under a rapid double-tap, the same guarantee the job queue's
 * idempotency key gives cron enqueues.
 */
export async function setEventRsvp(userId: string, eventId: string, status: unknown): Promise<EventResult> {
  if (!hasServiceRoleEnv()) return { ok: false, message: "This action needs the server database configuration." };
  if (!uuidSchema.safeParse(eventId).success) return { ok: false, message: "Event not found." };

  const parsedStatus = rsvpStatusSchema.safeParse(status);
  if (!parsedStatus.success) return { ok: false, message: "Choose Interested, Going or Not Going." };

  const admin = createSupabaseAdminClient();
  const { data: event } = await admin
    .from("events")
    .select("id, name, host_id, visibility, status, starts_at, ends_at")
    .eq("id", eventId)
    .maybeSingle();
  if (!event || (event.visibility === "invite" && event.host_id !== userId)) {
    return { ok: false, message: "Event not found." };
  }

  // Hosting and RSVPing are different concepts. A host does not need to tell
  // themselves they are going to their own event, and a stray RSVP row for
  // the host would be a second, competing source of truth for something
  // isHost already answers.
  if (event.host_id === userId) {
    return { ok: false, message: "You're hosting this event." };
  }

  if (await isBlockedEitherDirection(admin, userId, event.host_id)) {
    // Same message as "not found": confirming a block exists to the blocked
    // party is its own small information leak, and every other blocked-access
    // path in this product already answers this way.
    return { ok: false, message: "Event not found." };
  }

  if (event.status === "cancelled" || event.status === "draft") {
    return { ok: false, message: "This event isn't available." };
  }

  // RSVPing to something already over is stale intent, not a real signal --
  // the phase this compares against is exactly eventPhase's own boundary,
  // called directly rather than re-deriving "is it over" here.
  if (isPastEvent({ startsAtMs: Date.parse(event.starts_at), endsAtMs: Date.parse(event.ends_at) }, Date.now())) {
    return { ok: false, message: "This event has ended." };
  }

  const rateLimit = await consumeRateLimit({ action: "events.rsvp", userId });
  if (!rateLimit.allowed) return { ok: false, message: rateLimitMessage(rateLimit.resetAt) };

  const { error } = await admin
    .from("event_rsvps")
    .upsert(
      { event_id: eventId, user_id: userId, status: parsedStatus.data },
      { onConflict: "event_id,user_id" }
    );
  if (error) return { ok: false, message: "Couldn't update your RSVP. Try again." };

  const message =
    parsedStatus.data === "going"
      ? `You're going to ${event.name}.`
      : parsedStatus.data === "interested"
        ? `Marked interested in ${event.name}.`
        : `You're not going to ${event.name}.`;
  return { ok: true, message, eventId };
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

/**
 * Simple manual check-in (no QR). Mobile v1 of checkInToEventAction.
 *
 * `eventGlowEnabled` defaults to false for the same reason the web action
 * does (Stage E): presence is not consent to be seen. A mobile client that
 * sends nothing gets the private behaviour, not the broadcasting one.
 */
export async function checkInToEvent(
  userId: string,
  eventId: string,
  eventGlowEnabled = false
): Promise<EventResult> {
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
      event_glow_enabled: eventGlowEnabled,
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
