import "server-only";

import { z } from "zod";
import { isDiscoverableInFeed, isPastEvent, resolveCheckInWindow } from "@/lib/events/rules";
import { getEventForViewer } from "@/lib/events/access";
import { liveCheckIn } from "@/lib/events/service";
import { consumeRateLimit, rateLimitMessage } from "@/lib/security/rate-limit";
import {
  batchBlockedIds,
  batchEligibleMuddyIds
} from "@/lib/social/permissions";
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

  /* PRESENTATION FACTS (Events 2.0 visual rebuild).
   *
   * The approved design leads with artwork and social proof rather than with a
   * form field, so the projection has to carry them. All of it is batched into
   * the round trips listEvents already made -- a hero card must never become a
   * per-card request (see the cover and count blocks below).
   *
   * Deliberately absent: any attendee position or distance. A venue is
   * programme information the host published; where a person is standing is
   * not. attendance-surfacing.test.ts pins that boundary. */
  coverUrl: string | null;
  focalX: number;
  focalY: number;
  /** Published venue locality ("Osu, Accra"), never a viewer-relative distance. */
  locality: string | null;
  /** Audience the host chose. Drives the Hosting badge and the link/public copy. */
  visibility: string;
  goingCount: number;
  interestedCount: number;
  /** Whether this viewer was individually invited -- powers the Invited tab. */
  isInvited: boolean;
};

export type EventResult = { ok: boolean; message: string; eventId?: string; checkInId?: string };

const uuidSchema = z.string().uuid();

const rsvpStatusSchema = z.enum(["interested", "going", "not_going"]);

type Admin = ReturnType<typeof createSupabaseAdminClient>;

/** Community targets are groups the creator currently belongs to, not ids a
 * client is trusted to name. Both conditions matter: conversation_members also
 * contains direct, Plan and Event conversations, none of which is an Event
 * community audience. */
async function eligibleCommunityTargetIds(
  admin: Admin,
  userId: string,
  targetIds: readonly string[]
): Promise<string[]> {
  if (targetIds.length === 0) return [];
  const { data: memberships } = await admin
    .from("conversation_members")
    .select("conversation_id")
    .eq("user_id", userId)
    .eq("status", "joined")
    .in("conversation_id", [...targetIds]);
  const joinedIds = [...new Set((memberships ?? []).map((row) => row.conversation_id))];
  if (joinedIds.length === 0) return [];

  const { data: groups } = await admin
    .from("conversations")
    .select("id")
    .eq("conversation_type", "group")
    .in("id", joinedIds);
  return (groups ?? []).map((row) => row.id);
}

export const createEventSchema = z.object({
  name: z.string().min(2).max(120),
  description: z.string().max(1000).optional(),
  venueLabel: z.string().max(160).optional(),
  startsAt: z.string().datetime({ offset: true }),
  endsAt: z.string().datetime({ offset: true }),
  /**
   * Accepted and ignored.
   *
   * Creation ALWAYS produces a draft. This used to accept `false` to create a
   * scheduled event directly, which was a hole straight through the
   * published-cover rule: an event created that way went public without ever
   * passing publishEventAction, the only place the cover is verified. A rule
   * with a documented bypass is a convention, not a rule.
   *
   * Kept in the schema so an older client sending it still succeeds rather
   * than failing validation -- it simply no longer changes the outcome.
   * publishEventAction is now the only transition to `scheduled`.
   */
  draft: z.boolean().optional(),
  /* WHO SHOULD KNOW ABOUT THIS EVENT.
   *
   * Creation used to hardcode `community`, so the one decision that governs
   * distribution was never asked. It defaults to `community` here ONLY so an
   * older client that omits the field keeps its previous behaviour rather than
   * failing validation -- new clients always send a deliberate choice. */
  visibility: z.enum(["invite", "link", "community", "nearby", "public"]).optional(),
  /** Muddies for an invited Event; Circle conversation ids for a community one. */
  audienceTargetIds: z.array(z.string().uuid()).max(200).optional(),
  /** Required to publish a Nearby Event -- see validateAudienceRequirements. */
  location: z
    .object({
      latitude: z.number().min(-90).max(90),
      longitude: z.number().min(-180).max(180),
      locality: z.string().max(120).optional(),
      region: z.string().max(120).optional()
    })
    .optional()
});

/**
 * An audience is only real if the thing it points at exists.
 *
 * Enforced on the SERVER, never left to the form: a client that skips the
 * picker must not be able to publish an "invited people" Event with nobody
 * invited (which is private to nobody) or a Nearby Event with no geography
 * (which cannot be found by anyone).
 */
export function validateAudienceRequirements(input: {
  visibility: string;
  targetCount: number;
  hasLocation: boolean;
}): { ok: true } | { ok: false; message: string } {
  if (input.visibility === "invite" && input.targetCount === 0) {
    return { ok: false, message: "Choose at least one person to invite." };
  }
  if (input.visibility === "community" && input.targetCount === 0) {
    return { ok: false, message: "Choose the community to share this with." };
  }
  if (input.visibility === "nearby" && !input.hasLocation) {
    return { ok: false, message: "Add where it's happening so people nearby can find it." };
  }
  return { ok: true };
}

function hasServiceRoleEnv(): boolean {
  const env = getSupabaseServerEnv();
  return Boolean(env.url && env.serviceRoleKey);
}

/**
 * The viewer's relationship to a set of Events' audiences, in two queries.
 *
 * Kept out of the pure rules on purpose: rules decide, this fetches. Returns
 * sets rather than rows because every caller only ever asks "is this Event in
 * it?", and a set makes the N+1 shape impossible to write by accident.
 */
async function loadAudienceContext(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  userId: string,
  eventIds: string[]
): Promise<{
  invitedEventIds: Set<string>;
  communityTargetedEventIds: Set<string>;
  memberCommunityEventIds: Set<string>;
}> {
  const empty = {
    invitedEventIds: new Set<string>(),
    communityTargetedEventIds: new Set<string>(),
    memberCommunityEventIds: new Set<string>()
  };
  if (eventIds.length === 0) return empty;

  const { data: targets } = await admin
    .from("event_audience_targets")
    .select("event_id, target_type, target_id")
    .in("event_id", eventIds);
  if (!targets?.length) return empty;

  const invitedEventIds = new Set<string>();
  const communityTargetedEventIds = new Set<string>();
  const communityTargets: Array<{ eventId: string; conversationId: string }> = [];
  for (const row of targets) {
    if (row.target_type === "user") {
      if (row.target_id === userId) invitedEventIds.add(row.event_id);
    } else if (row.target_type === "community") {
      communityTargetedEventIds.add(row.event_id);
      communityTargets.push({ eventId: row.event_id, conversationId: row.target_id });
    }
  }

  const memberCommunityEventIds = new Set<string>();
  if (communityTargets.length > 0) {
    // Circles are group conversations, so membership is conversation_members --
    // there is no second community system to consult. Only `joined` counts: an
    // invited-but-not-joined member has not accepted the Circle yet, and a
    // removed one must lose the Event with it.
    const conversationIds = [...new Set(communityTargets.map((target) => target.conversationId))];
    const { data: memberships } = await admin
      .from("conversation_members")
      .select("conversation_id")
      .eq("user_id", userId)
      .eq("status", "joined")
      .in("conversation_id", conversationIds);
    const joined = new Set((memberships ?? []).map((row) => row.conversation_id));
    for (const target of communityTargets) {
      if (joined.has(target.conversationId)) memberCommunityEventIds.add(target.eventId);
    }
  }

  return { invitedEventIds, communityTargetedEventIds, memberCommunityEventIds };
}

export async function listEvents(userId: string): Promise<EventView[]> {
  if (!hasServiceRoleEnv()) return [];

  const admin = createSupabaseAdminClient();
  const nowIso = new Date().toISOString();
  const { data: events } = await admin
    .from("events")
    .select(
      "id, host_id, name, description, venue_label, starts_at, ends_at, visibility, status, cover_media_id, cover_focal_x, cover_focal_y"
    )
    // Drafts included so a HOST can find their own unpublished event and
    // finish it (Stage F): creation now produces a draft, so filtering them
    // out here would hide the event from the only person who can publish it.
    // The filter below drops other people's drafts.
    .in("status", ["draft", "scheduled", "active"])
    .gte("ends_at", nowIso)
    .order("starts_at", { ascending: true })
    .limit(100);
  if (!events?.length) return [];

  /* AUDIENCE CONTEXT, BATCHED.
   *
   * Two queries for the whole page, never one per Event: the targets attached
   * to these Events, and the Circles this viewer belongs to. isDiscoverableInFeed
   * is pure and needs the answers handed to it -- which is what lets the same
   * rule serve the feed, the mobile API and a test without three lookups. */
  const audience = await loadAudienceContext(
    admin,
    userId,
    events.map((event) => event.id)
  );

  const visibilityFiltered = events.filter((event) => {
    // A draft belongs to its host alone: never listed to anyone else, whatever
    // its visibility says (Stage F).
    if (event.status === "draft" && event.host_id !== userId) return false;
    // One owner for "may this be browsed" -- see isDiscoverableInFeed.
    return isDiscoverableInFeed(
      {
        visibility: event.visibility,
        hostId: event.host_id,
        isInvited: audience.invitedEventIds.has(event.id),
        hasCommunityTarget: audience.communityTargetedEventIds.has(event.id),
        isCommunityMember: audience.memberCommunityEventIds.has(event.id)
      },
      userId
    );
  });
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
  const visibleIds = visible.map((event) => event.id);
  const [{ data: checkIns }, { data: hosts }, hostPlans, { data: rsvps }, { data: locations }, { data: allRsvps }] =
    await Promise.all([
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
      ),
    /* PUBLISHED LOCALITY, not a viewer distance. event_locations holds the
     * venue the host chose to publish; the coordinates in that table stay on
     * the server and never enter EventView. */
    admin.from("event_locations").select("event_id, locality, region").in("event_id", visibleIds),
    /* SOCIAL PROOF, one query for the page. Every RSVP row for these Events,
     * tallied in memory below -- the alternative (a count per card) is the
     * N+1 the design brief explicitly forbids. Ids are never retained, only
     * summed, so this reveals no individual's answer. */
    admin.from("event_rsvps").select("event_id, status").in("event_id", visibleIds)
  ]);

  const checkInByEvent = new Map((checkIns ?? []).map((row) => [row.context_id, row]));
  const hostNames = new Map((hosts ?? []).map((row) => [row.user_id, row.full_name]));
  const rsvpByEvent = new Map((rsvps ?? []).map((row) => [row.event_id, row.status]));

  /* LOCALITY LABEL. "Osu, Accra" reads as a place; "Osu" alone often does not,
   * and region-only is meaningless. Region is appended only when it adds
   * something the locality did not already say. */
  const localityByEvent = new Map<string, string>();
  for (const row of locations ?? []) {
    const locality = row.locality?.trim() ?? "";
    const region = row.region?.trim() ?? "";
    const label = locality && region && region !== locality ? `${locality}, ${region}` : locality || region;
    if (label) localityByEvent.set(row.event_id, label);
  }

  // Tallies, from the single RSVP sweep above.
  const goingByEvent = new Map<string, number>();
  const interestedByEvent = new Map<string, number>();
  for (const row of allRsvps ?? []) {
    const bucket = row.status === "going" ? goingByEvent : row.status === "interested" ? interestedByEvent : null;
    if (bucket) bucket.set(row.event_id, (bucket.get(row.event_id) ?? 0) + 1);
  }

  /* COVER ART, batched and moderation-aware. signMediaForAsset is the
   * canonical resolver -- it already refuses deleted, removed and restricted
   * assets, so a moderated cover degrades to the branded fallback rather than
   * rendering a broken image. Same pattern as ranked-events.ts, deliberately:
   * one resolver, not a second copy of the rules. */
  const coverIds = [...new Set(visible.map((event) => event.cover_media_id).filter(Boolean))] as string[];
  const coverUrlById = new Map<string, string>();
  if (coverIds.length > 0) {
    const { signMediaForAsset } = await import("@/lib/content/service");
    const signed = await Promise.all(
      coverIds.map(async (id) => [id, await signMediaForAsset(admin, id, "feed")] as const)
    );
    for (const [id, url] of signed) if (url) coverUrlById.set(id, url);
  }

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
      myRsvp: rsvpStatus && isEventRsvpStatus(rsvpStatus) ? rsvpStatus : null,
      coverUrl: event.cover_media_id ? coverUrlById.get(event.cover_media_id) ?? null : null,
      focalX: event.cover_focal_x ?? 0.5,
      focalY: event.cover_focal_y ?? 0.5,
      locality: localityByEvent.get(event.id) ?? null,
      visibility: event.visibility,
      goingCount: goingByEvent.get(event.id) ?? 0,
      interestedCount: interestedByEvent.get(event.id) ?? 0,
      isInvited: audience.invitedEventIds.has(event.id)
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

  /* RSVP uses the SAME direct-access authority as opening Event detail.
   *
   * The old shortcut rejected every invite-only Event for every non-host,
   * including people who really were invited, and checked no community
   * membership at all. That made legitimate invitees unable to answer while
   * a guessed community Event id could still be mutated. getEventForViewer
   * resolves invite targets, joined-community membership, draft status and
   * blocks, and fails closed for every unknown audience. */
  const access = await getEventForViewer(eventId, userId);
  if (!access.ok) return { ok: false, message: "Event not found." };
  const event = access.event;

  // Hosting and RSVPing are different concepts. A host does not need to tell
  // themselves they are going to their own event, and a stray RSVP row for
  // the host would be a second, competing source of truth for something
  // isHost already answers.
  if (event.host_id === userId) {
    return { ok: false, message: "You're hosting this event." };
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

  const admin = createSupabaseAdminClient();
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

  /* The audience has to point at something real, and the server is the only
     place that can insist. A form that skips the picker must not be able to
     publish an invited Event with nobody invited. */
  const chosenVisibility = parsed.data.visibility ?? "community";
  const targetIds = [...new Set(parsed.data.audienceTargetIds ?? [])];
  const audienceCheck = validateAudienceRequirements({
    visibility: chosenVisibility,
    targetCount: targetIds.length,
    hasLocation: Boolean(parsed.data.location)
  });
  if (!audienceCheck.ok) return { ok: false, message: audienceCheck.message };

  const rateLimit = await consumeRateLimit({ action: "events.create", userId });
  if (!rateLimit.allowed) return { ok: false, message: rateLimitMessage(rateLimit.resetAt) };

  const admin = createSupabaseAdminClient();
  const allowedTargetIds =
    chosenVisibility === "invite"
      ? [...(await batchEligibleMuddyIds(admin, userId, targetIds))]
      : chosenVisibility === "community"
        ? await eligibleCommunityTargetIds(admin, userId, targetIds)
        : [];
  const authorizedAudience = validateAudienceRequirements({
    visibility: chosenVisibility,
    targetCount: allowedTargetIds.length,
    hasLocation: Boolean(parsed.data.location)
  });
  if (!authorizedAudience.ok) return { ok: false, message: authorizedAudience.message };

  const { data: event, error } = await admin
    .from("events")
    .insert({
      host_id: userId,
      name: parsed.data.name.trim(),
      description: parsed.data.description?.trim() || null,
      venue_label: parsed.data.venueLabel?.trim() || null,
      starts_at: parsed.data.startsAt,
      ends_at: parsed.data.endsAt,
      // The creator's actual choice. `community` remains the fallback purely
      // so an older client that sends no audience behaves exactly as before.
      visibility: parsed.data.visibility ?? "community",
      // ALWAYS A DRAFT. Events used to be born "scheduled", i.e. published the
      // instant they were created -- which made the published-cover rule
      // unenforceable, because there was no moment between "the event exists"
      // (needed to attach a cover to it) and "the event is public".
      //
      // `draft: false` previously opted back into that and bypassed
      // publishEventAction entirely, so an event could reach discovery with no
      // cover and no server check. There is now no path from creation to
      // `scheduled`: publishEventAction is the only transition, and it
      // re-reads the asset's owner, context, processing and moderation state
      // before allowing it.
      //
      // Existing scheduled events are untouched: this changes what NEW rows
      // start as, never what old ones are.
      status: "draft"
    })
    .select("id")
    .single();
  if (error || !event) return { ok: false, message: "Couldn't create the event." };

  /* Targets are written only for the audiences that use them, and only after
     the Event row exists to hang them off. An invited Event stores people; a
     community Event stores the Circle. Nothing else needs a row. */
  if (allowedTargetIds.length > 0 && (chosenVisibility === "invite" || chosenVisibility === "community")) {
    const targetType = chosenVisibility === "invite" ? "user" : "community";
    await admin.from("event_audience_targets").insert(
      allowedTargetIds.map((targetId) => ({
        event_id: event.id,
        target_type: targetType,
        target_id: targetId
      }))
    );
  }

  if (parsed.data.location) {
    // Published programme geography -- where the Event happens. Never a
    // person's whereabouts, and never subject to user-location retention.
    await admin.from("event_locations").insert({
      event_id: event.id,
      latitude: parsed.data.location.latitude,
      longitude: parsed.data.location.longitude,
      locality: parsed.data.location.locality ?? null,
      region: parsed.data.location.region ?? null
    });
  }

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

  /* Arrival cannot be a side door around Event access. This also fixes the
   * inverse bug in the old invite shortcut: it rejected a legitimate invitee
   * solely because they were not the host. */
  const access = await getEventForViewer(eventId, userId);
  if (!access.ok) return { ok: false, message: "Event not found." };
  const event = access.event;
  const admin = createSupabaseAdminClient();

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

/**
 * ONE Event, by id, for a viewer who arrived with a direct link.
 *
 * WHY THIS EXISTS. The Events page resolved `?event=<id>` by searching the
 * list it already had -- and that list comes from listEvents, which is
 * DISCOVERY-filtered. An unlisted "anyone with the link" Event is never in it
 * by definition, so a shared link silently opened nothing at all: no sheet, no
 * error, no explanation. The same held for a past Event and for an invite-only
 * Event the viewer had genuinely been invited to but had not loaded.
 *
 * Discovery and direct access are DIFFERENT QUESTIONS, and the codebase already
 * had the right authority for the second one -- getEventForViewer, which checks
 * blocks first, then canViewEvent, and returns a typed refusal. This function
 * is the projection layer over it, so the client can render the same EventView
 * it renders for a browsed Event.
 *
 * It deliberately does NOT widen what anybody may see: every refusal still
 * comes from getEventForViewer, and a blocked or invisible Event returns null
 * exactly as before.
 */
export async function getEventViewForViewer(userId: string, eventId: string): Promise<EventView | null> {
  if (!hasServiceRoleEnv()) return null;

  const { getEventForViewer } = await import("@/lib/events/access");
  const access = await getEventForViewer(eventId, userId);
  if (!access.ok) return null;

  const admin = createSupabaseAdminClient();
  const event = access.event;

  /* Everything the card and the detail sheet need, in one round trip each --
   * the same facts listEvents projects, scoped to this single Event. */
  const [{ data: cover }, { data: host }, hostPlans, { data: myRsvp }, { data: checkIn }, { data: location }, { data: rsvps }, { data: invite }] =
    await Promise.all([
      admin.from("events").select("cover_media_id, cover_focal_x, cover_focal_y").eq("id", eventId).maybeSingle(),
      admin.from("profiles").select("user_id, full_name").eq("user_id", event.host_id).maybeSingle(),
      loadEffectivePlansForUsers(admin, [event.host_id]),
      admin.from("event_rsvps").select("status").eq("event_id", eventId).eq("user_id", userId).maybeSingle(),
      admin
        .from("check_ins")
        .select("id, event_glow_enabled")
        .eq("user_id", userId)
        .eq("context_type", "event")
        .eq("context_id", eventId)
        .eq("status", "checked_in")
        .maybeSingle(),
      admin.from("event_locations").select("locality, region").eq("event_id", eventId).maybeSingle(),
      admin.from("event_rsvps").select("status").eq("event_id", eventId),
      admin
        .from("event_audience_targets")
        .select("event_id")
        .eq("event_id", eventId)
        .eq("target_type", "user")
        .eq("target_id", userId)
        .maybeSingle()
    ]);

  let coverUrl: string | null = null;
  if (cover?.cover_media_id) {
    const { signMediaForAsset } = await import("@/lib/content/service");
    coverUrl = await signMediaForAsset(admin, cover.cover_media_id, "feed");
  }

  const locality = location?.locality?.trim() ?? "";
  const region = location?.region?.trim() ?? "";
  const localityLabel =
    locality && region && region !== locality ? `${locality}, ${region}` : locality || region;

  let goingCount = 0;
  let interestedCount = 0;
  for (const row of rsvps ?? []) {
    if (row.status === "going") goingCount += 1;
    else if (row.status === "interested") interestedCount += 1;
  }

  const rsvpStatus = myRsvp?.status;
  return {
    id: event.id,
    name: event.name,
    description: event.description,
    venueLabel: event.venue_label,
    startsAt: event.starts_at,
    endsAt: event.ends_at,
    status: event.status,
    hostName: access.isHost ? "You" : host?.full_name?.trim() || "A Muddy",
    hostPlan: hostPlans.get(event.host_id) ?? "free",
    isHost: access.isHost,
    myCheckInId: checkIn?.id ?? null,
    myGlowEnabled: checkIn?.event_glow_enabled ?? false,
    myRsvp: rsvpStatus && isEventRsvpStatus(rsvpStatus) ? rsvpStatus : null,
    coverUrl,
    focalX: cover?.cover_focal_x ?? 0.5,
    focalY: cover?.cover_focal_y ?? 0.5,
    locality: localityLabel || null,
    visibility: event.visibility,
    goingCount,
    interestedCount,
    isInvited: Boolean(invite)
  };
}

/** Everything the creation flow needs to resume an existing draft. */
export type EventDraft = {
  id: string;
  name: string;
  description: string;
  /** Local-date and time parts, because that is what the form fields hold. */
  date: string;
  startTime: string;
  endTime: string;
  venueLabel: string;
  visibility: string;
  targetIds: string[];
  hasLocation: boolean;
  coverUrl: string | null;
  focalX: number;
  focalY: number;
};

/**
 * One draft, loaded for its host to carry on editing.
 *
 * WHY THIS EXISTS. "Continue" on a draft used to open the Event DETAIL sheet,
 * which is a different job entirely -- and for a draft with no cover it renders
 * almost nothing, so the person saw a dimmed screen with an empty panel and no
 * way to finish. Resuming needs the draft's actual VALUES, not a viewer's
 * projection of it.
 *
 * HOST ONLY, and refused for anything already published: an Event that is live
 * is edited through its own surfaces, not by reopening the creation flow.
 * Returning null for every refusal keeps the client from having to reason about
 * why.
 */
export async function getEventDraftForHost(userId: string, eventId: string): Promise<EventDraft | null> {
  if (!hasServiceRoleEnv()) return null;

  const admin = createSupabaseAdminClient();
  const { data: event } = await admin
    .from("events")
    .select(
      "id, host_id, name, description, venue_label, starts_at, ends_at, visibility, status, cover_media_id, cover_focal_x, cover_focal_y"
    )
    .eq("id", eventId)
    .maybeSingle();
  if (!event) return null;
  if (event.host_id !== userId) return null;
  if (event.status !== "draft") return null;

  const [{ data: targets }, { data: location }] = await Promise.all([
    admin.from("event_audience_targets").select("target_id").eq("event_id", eventId),
    admin.from("event_locations").select("event_id").eq("event_id", eventId).maybeSingle()
  ]);

  let coverUrl: string | null = null;
  if (event.cover_media_id) {
    const { signMediaForAsset } = await import("@/lib/content/service");
    coverUrl = await signMediaForAsset(admin, event.cover_media_id, "feed");
  }

  /* Split into the local parts the form binds to. The stored value is an
   * instant; the form asks for a date and two times, so the conversion happens
   * once here rather than in three places in the component. */
  const starts = new Date(event.starts_at);
  const ends = new Date(event.ends_at);
  const pad = (value: number) => String(value).padStart(2, "0");
  const dateOf = (value: Date) =>
    `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`;
  const timeOf = (value: Date) => `${pad(value.getHours())}:${pad(value.getMinutes())}`;

  return {
    id: event.id,
    name: event.name ?? "",
    description: event.description ?? "",
    date: Number.isFinite(starts.getTime()) ? dateOf(starts) : "",
    startTime: Number.isFinite(starts.getTime()) ? timeOf(starts) : "",
    endTime: Number.isFinite(ends.getTime()) ? timeOf(ends) : "",
    venueLabel: event.venue_label ?? "",
    visibility: event.visibility,
    targetIds: (targets ?? []).map((row) => row.target_id),
    hasLocation: Boolean(location),
    coverUrl,
    focalX: event.cover_focal_x ?? 0.5,
    focalY: event.cover_focal_y ?? 0.5
  };
}

/**
 * Saves edits back onto an existing DRAFT.
 *
 * WHY THIS EXISTS. Resuming a draft and publishing it used to call createEvent
 * again, which inserts a NEW row -- so the person got a second Event and the
 * original stayed in Drafts forever. A resumed draft has an identity already;
 * finishing it is an update, not a creation.
 *
 * Shares createEventSchema and validateAudienceRequirements with createEvent,
 * so a draft cannot be saved into a state a new Event would be refused for --
 * an invited Event with nobody invited, or a Nearby Event with no location.
 *
 * DRAFTS ONLY. A published Event is edited through its own surfaces; letting
 * the creation flow rewrite a live Event would be a different feature with
 * different rules (attendees have already answered based on what it said).
 */
export async function updateEventDraft(
  userId: string,
  eventId: string,
  input: unknown
): Promise<EventResult> {
  if (!hasServiceRoleEnv()) {
    return { ok: false, message: "This action needs the server database configuration." };
  }

  const parsed = createEventSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Check the event details and try again." };

  const startsMs = Date.parse(parsed.data.startsAt);
  const endsMs = Date.parse(parsed.data.endsAt);
  if (endsMs <= startsMs) return { ok: false, message: "The event must end after it starts." };

  const chosenVisibility = parsed.data.visibility ?? "community";
  const targetIds = [...new Set(parsed.data.audienceTargetIds ?? [])];

  const admin = createSupabaseAdminClient();
  const { data: existing } = await admin
    .from("events")
    .select("id, host_id, status")
    .eq("id", eventId)
    .maybeSingle();
  if (!existing) return { ok: false, message: "Event not found." };
  if (existing.host_id !== userId) return { ok: false, message: "Only the host can edit this event." };
  if (existing.status !== "draft") {
    return { ok: false, message: "This event is already published." };
  }

  /* A Nearby draft may already hold a location from an earlier session, so the
   * requirement is satisfied by EITHER a fresh one in this payload or one
   * already stored. Demanding it again would make a resumed Nearby draft
   * impossible to publish without re-granting geolocation. */
  const { data: storedLocation } = await admin
    .from("event_locations")
    .select("event_id")
    .eq("event_id", eventId)
    .maybeSingle();

  const allowedTargetIds =
    chosenVisibility === "invite"
      ? [...(await batchEligibleMuddyIds(admin, userId, targetIds))]
      : chosenVisibility === "community"
        ? await eligibleCommunityTargetIds(admin, userId, targetIds)
        : [];
  const audienceCheck = validateAudienceRequirements({
    visibility: chosenVisibility,
    targetCount: allowedTargetIds.length,
    hasLocation: Boolean(parsed.data.location) || Boolean(storedLocation)
  });
  if (!audienceCheck.ok) return { ok: false, message: audienceCheck.message };

  const { error } = await admin
    .from("events")
    .update({
      name: parsed.data.name.trim(),
      description: parsed.data.description?.trim() || null,
      venue_label: parsed.data.venueLabel?.trim() || null,
      starts_at: parsed.data.startsAt,
      ends_at: parsed.data.endsAt,
      visibility: chosenVisibility,
      updated_at: new Date().toISOString()
    })
    .eq("id", eventId)
    .eq("host_id", userId);
  if (error) return { ok: false, message: "Couldn't save your event. Try again." };

  /* Targets are REPLACED, not merged: the audience picker shows the complete
   * chosen set, so anything absent from it was deliberately removed. Merging
   * would silently keep somebody the host had just taken off the list. */
  if (chosenVisibility === "invite" || chosenVisibility === "community") {
    await admin.from("event_audience_targets").delete().eq("event_id", eventId);
    const rows = allowedTargetIds.map((targetId) => ({
      event_id: eventId,
      // Literal union, not string: the column is constrained to these two.
      target_type: (chosenVisibility === "invite" ? "user" : "community") as "user" | "community",
      target_id: targetId
    }));
    if (rows.length > 0) await admin.from("event_audience_targets").insert(rows);
  } else {
    // Switching away from a targeted audience clears the targets with it.
    await admin.from("event_audience_targets").delete().eq("event_id", eventId);
  }

  if (parsed.data.location) {
    await admin.from("event_locations").upsert(
      {
        event_id: eventId,
        latitude: parsed.data.location.latitude,
        longitude: parsed.data.location.longitude,
        locality: parsed.data.location.locality ?? null,
        updated_at: new Date().toISOString()
      },
      { onConflict: "event_id" }
    );
  }

  return { ok: true, message: "Draft saved.", eventId };
}
