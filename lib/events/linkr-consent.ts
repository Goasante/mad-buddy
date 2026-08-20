import "server-only";

import { liveCheckIn } from "@/lib/events/service";
import { consumeRateLimit, rateLimitMessage } from "@/lib/security/rate-limit";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

/**
 * Event Linkr consent: "I am open to being shown to new people at this Event."
 *
 * SEPARATE FROM CHECK-IN, AND SEPARATE FROM EVENT GLOW. Three different
 * permissions that are easy to conflate and must never be:
 *
 *   check-in            "I am here."
 *   Event Glow          "Show my existing Muddies that I am here."
 *   Event Linkr         "Show my profile to eligible strangers at this Event."
 *
 * Arriving somewhere is not consent to be discovered by strangers, and telling
 * your friends you arrived is not either. Each is stored separately, written
 * separately, and checked separately.
 *
 * Consent is stored; ELIGIBILITY IS DERIVED. Whether somebody is actually
 * discoverable right now depends on facts that change without any row being
 * touched -- checking out, the Event ending, a block appearing. So the row
 * records only the decision, and resolveEventLinkrEligibility asks the rest at
 * request time.
 */

type Admin = ReturnType<typeof createSupabaseAdminClient>;

export type LinkrConsentResult = { ok: boolean; message: string; enabled?: boolean };

export type EventLinkrEligibility = {
  eligible: boolean;
  reason:
    | "eligible"
    | "event_not_found"
    | "event_not_live"
    | "not_checked_in"
    | "no_consent";
};

/**
 * Records or withdraws consent for one Event.
 *
 * Requires a live check-in to turn ON: consenting to meet people at an Event
 * you have not arrived at is not a decision anybody needs to make in advance,
 * and allowing it would let the row exist for someone who is nowhere near.
 * Turning OFF is always allowed -- withdrawal must never be harder than
 * granting, and someone who has already left should still be able to revoke.
 */
export async function setEventLinkrConsent(
  userId: string,
  eventId: string,
  enabled: boolean
): Promise<LinkrConsentResult> {
  const admin = createSupabaseAdminClient();

  if (enabled) {
    const limit = await consumeRateLimit({ action: "events.linkr_opt_in", userId });
    if (!limit.allowed) return { ok: false, message: rateLimitMessage(limit.resetAt) };

    const checkIn = await liveCheckIn(admin, userId, "event", eventId);
    if (!checkIn) {
      return { ok: false, message: "Check in first to meet people here." };
    }
  }

  const { error } = await admin
    .from("event_linkr_opt_ins")
    .upsert(
      { event_id: eventId, user_id: userId, enabled, updated_at: new Date().toISOString() },
      { onConflict: "event_id,user_id" }
    );
  if (error) return { ok: false, message: "Couldn't save that. Try again." };

  return {
    ok: true,
    enabled,
    message: enabled
      ? "You're open to meeting people here."
      : "You're no longer discoverable at this event."
  };
}

/** Whether this viewer has consent stored for the Event. */
export async function hasEventLinkrConsent(
  admin: Admin,
  userId: string,
  eventId: string
): Promise<boolean> {
  const { data } = await admin
    .from("event_linkr_opt_ins")
    .select("enabled")
    .eq("event_id", eventId)
    .eq("user_id", userId)
    .maybeSingle();
  return Boolean(data?.enabled);
}

/**
 * The single authority for "may this viewer enter Event Mode".
 *
 * Every condition is re-derived, so revocation and departure take effect
 * immediately without any cleanup job:
 *
 *   - the Event must exist, not be draft/cancelled, and not have ended
 *   - the viewer must hold a LIVE check-in (checking out removes them)
 *   - the viewer must have explicitly consented (revoking removes them)
 *
 * Fails closed: any unknown returns ineligible with a reason the caller may
 * use for an honest empty state rather than a blank screen.
 */
export async function resolveEventLinkrEligibility(
  admin: Admin,
  userId: string,
  eventId: string
): Promise<EventLinkrEligibility> {
  const { data: event } = await admin
    .from("events")
    .select("id, status, ends_at")
    .eq("id", eventId)
    .maybeSingle();
  if (!event) return { eligible: false, reason: "event_not_found" };

  const live =
    event.status !== "cancelled" &&
    event.status !== "draft" &&
    Date.parse(event.ends_at) > Date.now();
  if (!live) return { eligible: false, reason: "event_not_live" };

  const checkIn = await liveCheckIn(admin, userId, "event", eventId);
  if (!checkIn) return { eligible: false, reason: "not_checked_in" };

  if (!(await hasEventLinkrConsent(admin, userId, eventId))) {
    return { eligible: false, reason: "no_consent" };
  }

  return { eligible: true, reason: "eligible" };
}

/**
 * The other attendees who could appear in Event Mode.
 *
 * Returns IDS ONLY. This is deliberately not a directory: it hands the caller
 * a set to intersect with Linkr's own candidate policy, which is what applies
 * blocks, age and profile eligibility. Nobody becomes visible because they
 * appear here -- they become visible when Linkr also says so.
 *
 * Batched by construction: one query for consent, one for live check-ins.
 */
export async function eventLinkrCandidateIds(
  admin: Admin,
  viewerId: string,
  eventId: string
): Promise<Set<string>> {
  const { data: consenting } = await admin
    .from("event_linkr_opt_ins")
    .select("user_id")
    .eq("event_id", eventId)
    .eq("enabled", true);
  const consentingIds = (consenting ?? [])
    .map((row) => row.user_id)
    .filter((id) => id !== viewerId);
  if (consentingIds.length === 0) return new Set();

  // Consent without presence is not eligibility: someone who opted in and then
  // checked out must disappear without their row changing.
  const { data: present } = await admin
    .from("check_ins")
    .select("user_id")
    .eq("context_type", "event")
    .eq("context_id", eventId)
    .eq("status", "checked_in")
    .in("user_id", consentingIds);

  return new Set((present ?? []).map((row) => row.user_id));
}

/**
 * Below this, a count would describe individuals rather than a crowd.
 *
 * "3 people are open to connecting" at a small Event is close to naming them.
 * Above the threshold a number is genuinely a crowd statistic.
 */
export const EVENT_LINKR_COUNT_THRESHOLD = 5;

export function describeEventLinkrPool(count: number): string | null {
  if (count <= 0) return null;
  if (count < EVENT_LINKR_COUNT_THRESHOLD) return "People here are open to connecting.";
  return `${count} people are open to connecting.`;
}
