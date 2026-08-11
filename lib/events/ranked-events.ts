import "server-only";

import { rankEvents, HOME_RANKED_EVENTS_LIMIT, MAX_RANKED_EVENTS } from "@/lib/events/ranking";
import { resolveEventMedia, type EventMedia } from "@/lib/events/event-media";
import { batchBlockedIds } from "@/lib/social/permissions";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getSupabaseServerEnv } from "@/lib/supabase/env";
import type { EventRsvpStatus } from "@/lib/supabase/database.types";

/**
 * Ranked Events projection (Ranked Events Discovery).
 *
 * DISCOVERY, NOT A SECOND EVENTS DOMAIN. This produces a read-only ranked
 * view over the SAME events table, with the same visibility and block rules
 * listEvents already enforces. It creates no new event concept, owns no
 * mutations, and every row it returns opens the canonical event detail.
 *
 * RSVP COUNTS AND RLS. Aggregate going/interested counts are deliberately NOT
 * readable through RLS -- the Stage C policy grants a user their own RSVP row
 * and nothing more, specifically so that wanting your own status can't hand
 * you the attendee list. This loader runs on the service-role admin client,
 * which RLS does not constrain, and returns only NUMBERS. No identities, no
 * rows, no "who". That is why counts are available here without widening a
 * single policy.
 */

export type RankedEvent = {
  id: string;
  rank: number;
  name: string;
  venueLabel: string | null;
  startsAt: string;
  endsAt: string;
  status: string;
  media: EventMedia;
  goingCount: number;
  interestedCount: number;
  /** The viewer's own RSVP. null covers "never RSVP'd" and "is the host". */
  myRsvp: EventRsvpStatus | null;
  isHost: boolean;
};

function hasServiceRoleEnv(): boolean {
  const env = getSupabaseServerEnv();
  return Boolean(env.url && env.serviceRoleKey);
}

/**
 * Top-N upcoming events for a viewer, best-ranked first.
 *
 * `limit` is what separates the Home module from the full list: Home asks for
 * 5 and receives 5, the ranked page asks for up to 100. The cap is applied to
 * the RANKING, not to the query -- ranking a page of 5 rows would rank the 5
 * soonest events rather than the 5 best ones, which is a different and wrong
 * answer. The candidate window is bounded (MAX_RANKED_EVENTS) so this can
 * never become an unbounded scan.
 */
export async function getRankedUpcomingEvents(
  userId: string,
  { limit = HOME_RANKED_EVENTS_LIMIT }: { limit?: number } = {}
): Promise<RankedEvent[]> {
  if (!hasServiceRoleEnv()) return [];

  const boundedLimit = Math.max(0, Math.min(limit, MAX_RANKED_EVENTS));
  if (boundedLimit === 0) return [];

  const admin = createSupabaseAdminClient();
  const nowMs = Date.now();
  const nowIso = new Date(nowMs).toISOString();

  // Same eligibility gate listEvents uses: live statuses, not yet finished.
  const { data: events } = await admin
    .from("events")
    .select("id, host_id, name, venue_label, starts_at, ends_at, visibility, status")
    .in("status", ["scheduled", "active"])
    .gte("ends_at", nowIso)
    .order("starts_at", { ascending: true })
    .limit(MAX_RANKED_EVENTS);
  if (!events?.length) return [];

  // Invite-only events belong to their host alone; ranking must not become a
  // side channel that lists them to everyone.
  const visibilityFiltered = events.filter(
    (event) => event.visibility !== "invite" || event.host_id === userId
  );
  if (visibilityFiltered.length === 0) return [];

  // Blocks, batched -- one query for every host rather than one per event,
  // the same shape (and the same helper) listEvents uses.
  const hostIds = [...new Set(visibilityFiltered.map((event) => event.host_id))];
  const blockedHostIds = await batchBlockedIds(admin, userId, hostIds);
  const visible = visibilityFiltered.filter((event) => !blockedHostIds.has(event.host_id));
  if (visible.length === 0) return [];

  const eventIds = visible.map((event) => event.id);

  // Two queries for the whole page, never one per event: every RSVP row for
  // these events (counts), and the viewer's own rows (their state).
  const [{ data: rsvpRows }, { data: myRsvps }] = await Promise.all([
    admin.from("event_rsvps").select("event_id, status").in("event_id", eventIds),
    admin.from("event_rsvps").select("event_id, status").eq("user_id", userId).in("event_id", eventIds)
  ]);

  const goingByEvent = new Map<string, number>();
  const interestedByEvent = new Map<string, number>();
  for (const row of rsvpRows ?? []) {
    // not_going is stored but is not a popularity signal -- counting it would
    // rank an event higher for the people who declined it.
    if (row.status === "going") {
      goingByEvent.set(row.event_id, (goingByEvent.get(row.event_id) ?? 0) + 1);
    } else if (row.status === "interested") {
      interestedByEvent.set(row.event_id, (interestedByEvent.get(row.event_id) ?? 0) + 1);
    }
  }
  const myRsvpByEvent = new Map((myRsvps ?? []).map((row) => [row.event_id, row.status]));

  const rankable = visible.map((event) => ({
    id: event.id,
    startsAtMs: Date.parse(event.starts_at),
    endsAtMs: Date.parse(event.ends_at),
    status: event.status,
    goingCount: goingByEvent.get(event.id) ?? 0,
    interestedCount: interestedByEvent.get(event.id) ?? 0,
    name: event.name,
    venueLabel: event.venue_label,
    startsAt: event.starts_at,
    endsAt: event.ends_at,
    isHost: event.host_id === userId
  }));

  return rankEvents(rankable, nowMs, boundedLimit).map((event) => ({
    id: event.id,
    rank: event.rank,
    name: event.name,
    venueLabel: event.venueLabel,
    startsAt: event.startsAt,
    endsAt: event.endsAt,
    status: event.status,
    // No image column exists yet, so this always resolves to the deterministic
    // designed fallback. See lib/events/event-media.ts.
    media: resolveEventMedia(event.id),
    goingCount: event.goingCount,
    interestedCount: event.interestedCount,
    myRsvp: (myRsvpByEvent.get(event.id) as EventRsvpStatus | undefined) ?? null,
    isHost: event.isHost
  }));
}
