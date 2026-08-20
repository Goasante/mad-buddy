import "server-only";

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
 * Until that module lands on this branch, the functions below resolve it at
 * runtime and FAIL CLOSED when it is absent -- no consent module means no
 * Event Mode, never "assume everyone consented". See the integration note in
 * the handoff: when Events merges, the dynamic import becomes a static one and
 * nothing else moves.
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

let cached: EventLinkrConsentModule | null | undefined;

/**
 * Resolves the Events consent module if this branch has it.
 *
 * Cached including the negative result, so a branch without Events does not
 * pay for a failed module resolution on every discovery request.
 */
/**
 * The specifier is built rather than written literally, so TypeScript does not
 * try to resolve it at compile time. On this branch `lib/events/linkr-consent`
 * does not exist yet -- it arrives with Events 2.0 -- and a literal import
 * would fail the build for a dependency that is meant to be optional.
 *
 * WHEN EVENTS MERGES this becomes a plain static import and the whole
 * indirection disappears. See the integration note in the handoff.
 */
const CONSENT_MODULE = ["@/lib/events", "linkr-consent"].join("/");

async function loadConsentModule(): Promise<EventLinkrConsentModule | null> {
  if (cached !== undefined) return cached;
  try {
    const mod = (await import(/* webpackIgnore: false */ CONSENT_MODULE)) as unknown as
      | EventLinkrConsentModule
      | undefined;
    cached = typeof mod?.resolveEventLinkrEligibility === "function" ? mod : null;
  } catch {
    // FAILS CLOSED. No consent module means no Event Mode -- never "assume
    // everybody at the event consented".
    cached = null;
  }
  return cached;
}

/** Test seam: lets the suite supply a stub Events module, or clear it. */
export function __setEventConsentModuleForTests(mod: EventLinkrConsentModule | null | undefined) {
  cached = mod;
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
