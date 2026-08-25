import "server-only";

import * as eventConsentModule from "@/lib/events/linkr-consent";

/**
 * THE LINKR SIDE OF THE EVENT MODE SEAM.
 *
 * This file is the only place in Linkr that knows Events exist. Everything
 * else -- candidate policy, the card, the mutual-connect transaction --
 * receives a plain set of ids and a name, and cannot tell an Event apart from
 * any other narrowing.
 *
 * WHY AN ADAPTER RATHER THAN A DIRECT IMPORT. Events 2.0 is being built in
 * parallel and owns `lib/events/linkr-consent.ts`, which is the authority for:
 *
 *     resolveEventLinkrEligibility(admin, userId, eventId) -> eligible + reason
 *     eventLinkrCandidateIds(admin, viewerId, eventId)     -> Set<user_id>
 *     describeEventLinkrPool(count)                        -> string | null
 *     EVENT_LINKR_COUNT_THRESHOLD
 *
 * Linkr consumes those and re-implements none of them. Event check-in
 * authority, Event Linkr consent and the small-pool threshold stay entirely on
 * the Events side, so a change there changes Linkr's behaviour without Linkr
 * being edited.
 *
 * The Events module has landed, so production imports it statically. The
 * previous constructed dynamic import could not be bundled by Turbopack: it
 * caught its own resolution failure and silently disabled Event Mode even when
 * check-in and consent were valid. Tests may still replace the module through
 * the explicit seam below, including with null to prove failure stays closed.
 *
 * WHAT THIS ADAPTER MAY NOT DO, and does not:
 *   - decide whether somebody checked in
 *   - decide whether somebody consented to Event Linkr
 *   - treat Event Glow as Event Linkr consent
 *   - widen ordinary Linkr eligibility for anybody
 */

import { createSupabaseAdminClient } from "@/lib/supabase/admin";

type Admin = ReturnType<typeof createSupabaseAdminClient>;

export type EventModeEligibility = {
  eligible: boolean;
  reason:
    | "eligible"
    | "event_not_found"
    | "event_not_live"
    | "not_checked_in"
    | "no_consent"
    | "consent_module_unavailable";
};

/** Shape of the Events module this adapter consumes. Mirrors it, owns none of it. */
type EventLinkrConsentModule = {
  resolveEventLinkrEligibility: (
    admin: Admin,
    userId: string,
    eventId: string
  ) => Promise<{ eligible: boolean; reason: string }>;
  eventLinkrCandidateIds: (admin: Admin, viewerId: string, eventId: string) => Promise<Set<string>>;
  describeEventLinkrPool: (count: number) => string | null;
  EVENT_LINKR_COUNT_THRESHOLD: number;
};

let consentModuleOverride: EventLinkrConsentModule | null | undefined;

function loadConsentModule(): EventLinkrConsentModule | null {
  return consentModuleOverride === undefined
    ? eventConsentModule
    : consentModuleOverride;
}

/** Test seam: lets the suite supply a stub Events module, or clear it. */
export function __setEventConsentModuleForTests(mod: EventLinkrConsentModule | null | undefined) {
  consentModuleOverride = mod;
}

/**
 * May this viewer enter Event Mode for this Event?
 *
 * Delegates wholly to the Events authority. Every condition -- Event live,
 * live check-in, explicit consent -- is re-derived there at request time, so
 * checking out or the Event ending takes effect immediately with no cleanup.
 */
export async function resolveViewerEventMode(
  admin: Admin,
  userId: string,
  eventId: string
): Promise<EventModeEligibility> {
  const mod = await loadConsentModule();
  if (!mod) return { eligible: false, reason: "consent_module_unavailable" };
  const result = await mod.resolveEventLinkrEligibility(admin, userId, eventId);
  return {
    eligible: result.eligible,
    reason: (result.reason as EventModeEligibility["reason"]) ?? "no_consent"
  };
}

/**
 * The attendee ids Linkr may consider at this Event.
 *
 * IDS ONLY, and intersected -- never unioned -- with Linkr's own candidate
 * set. Appearing here makes nobody visible; it only permits Linkr to ask its
 * own questions about them. An empty set on any failure is the safe answer,
 * and is what an absent Events module returns.
 */
export async function eventModeCandidateIds(
  admin: Admin,
  viewerId: string,
  eventId: string
): Promise<Set<string>> {
  const mod = await loadConsentModule();
  if (!mod) return new Set();
  try {
    return await mod.eventLinkrCandidateIds(admin, viewerId, eventId);
  } catch {
    return new Set();
  }
}

/**
 * The crowd line under the Event Mode intro.
 *
 * Uses the Events threshold rather than a Linkr one. Two thresholds would
 * mean two answers to "is this pool small enough that a count names people",
 * and the lower of them would be the real policy by accident.
 */
export async function describeEventPool(count: number): Promise<string | null> {
  const mod = await loadConsentModule();
  if (!mod) return count > 0 ? "People here are open to connecting." : null;
  return mod.describeEventLinkrPool(count);
}

/** Event name and live state for the intro screen. Read-only, no writes. */
export async function loadEventContext(
  admin: Admin,
  eventId: string
): Promise<{ id: string; name: string; startsAt: string | null; venueLabel: string | null } | null> {
  const { data } = await admin
    .from("events")
    .select("id, name, starts_at, ends_at, status, venue_label")
    .eq("id", eventId)
    .maybeSingle();
  if (!data) return null;
  const live =
    data.status !== "cancelled" && data.status !== "draft" && Date.parse(data.ends_at) > Date.now();
  if (!live) return null;
  return {
    id: data.id,
    name: data.name,
    startsAt: data.starts_at ?? null,
    venueLabel: data.venue_label ?? null
  };
}
