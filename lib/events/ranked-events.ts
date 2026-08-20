import "server-only";

import {
  rankEvents,
  HOME_RANKED_EVENTS_LIMIT,
  MAX_RANKED_EVENTS,
  MOMENTUM_WINDOW_MS
} from "@/lib/events/ranking";
import { isBroadlyRankable } from "@/lib/events/rules";
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
  /** Where the subject sits, so every crop keeps it in frame. */
  focalPoint: { x: number; y: number };
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
    .select(
      "id, host_id, name, venue_label, starts_at, ends_at, visibility, status, cover_media_id, cover_focal_x, cover_focal_y"
    )
    .in("status", ["scheduled", "active"])
    .gte("ends_at", nowIso)
    .order("starts_at", { ascending: true })
    .limit(MAX_RANKED_EVENTS);
  if (!events?.length) return [];

  // Invite-only events belong to their host alone; ranking must not become a
  // side channel that lists them to everyone.
  /* VISIBILITY PRECEDES SCORE, and broad ranking is stricter than browsing.
     "Trending on Mad Buddy" is a claim about the whole product: a private
     wedding with five thousand Going must never make it, and neither should a
     community Event whose audience is one Circle -- discoverable to its
     members is not the same as trending for everyone. The host's own Events
     are not exempt; ranking is not a personal shelf. */
  const visibilityFiltered = events.filter((event) => isBroadlyRankable(event));
  if (visibilityFiltered.length === 0) return [];

  // Blocks, batched -- one query for every host rather than one per event,
  // the same shape (and the same helper) listEvents uses.
  const hostIds = [...new Set(visibilityFiltered.map((event) => event.host_id))];
  const blockedHostIds = await batchBlockedIds(admin, userId, hostIds);
  const visible = visibilityFiltered.filter((event) => !blockedHostIds.has(event.host_id));
  if (visible.length === 0) return [];

  const eventIds = visible.map((event) => event.id);

  // Two queries for the whole page, never one per event: every RSVP row for
  // these events (counts + momentum), and the viewer's own rows (their state).
  //
  // `updated_at` comes back on the same rows rather than in a second
  // "recent RSVPs" query -- momentum is derived in memory from the rows the
  // counts already needed, so adding it cost no extra round trip.
  const [{ data: rsvpRows }, { data: myRsvps }] = await Promise.all([
    admin.from("event_rsvps").select("event_id, status, updated_at").in("event_id", eventIds),
    admin.from("event_rsvps").select("event_id, status").eq("user_id", userId).in("event_id", eventIds)
  ]);

  const goingByEvent = new Map<string, number>();
  const interestedByEvent = new Map<string, number>();
  const recentGoingByEvent = new Map<string, number>();
  const recentInterestedByEvent = new Map<string, number>();
  const momentumFloorMs = nowMs - MOMENTUM_WINDOW_MS;

  for (const row of rsvpRows ?? []) {
    // ONE ROW PER USER PER EVENT is guaranteed by the (event_id, user_id)
    // unique constraint, and status changes update that row rather than
    // inserting another. So a user toggling Interested -> Going -> Interested
    // contributes exactly one count, whichever status it currently holds --
    // toggle spam cannot inflate a score (§31), and Interested -> Going is
    // never counted twice.
    //
    // not_going is stored but deliberately not counted: it is a decision NOT
    // to attend, and ranking an event higher for the people who declined it
    // would be backwards.
    const isRecent = Date.parse(row.updated_at) >= momentumFloorMs;
    if (row.status === "going") {
      goingByEvent.set(row.event_id, (goingByEvent.get(row.event_id) ?? 0) + 1);
      if (isRecent) recentGoingByEvent.set(row.event_id, (recentGoingByEvent.get(row.event_id) ?? 0) + 1);
    } else if (row.status === "interested") {
      interestedByEvent.set(row.event_id, (interestedByEvent.get(row.event_id) ?? 0) + 1);
      if (isRecent) {
        recentInterestedByEvent.set(row.event_id, (recentInterestedByEvent.get(row.event_id) ?? 0) + 1);
      }
    }
  }
  const myRsvpByEvent = new Map((myRsvps ?? []).map((row) => [row.event_id, row.status]));

  // Cover artwork for the whole page (Stage F). Signed in parallel rather
  // than one await per event, and only for events that actually have one --
  // legacy events skip this entirely and fall through to the deterministic
  // generated fallback below.
  //
  // signMediaForAsset is the canonical resolver: it already refuses deleted,
  // removed and restricted assets, so a moderated cover degrades to the
  // fallback instead of 404-ing on a public ranked card.
  const coverIds = [...new Set(visible.map((event) => event.cover_media_id).filter(Boolean))] as string[];
  const coverUrlById = new Map<string, string>();
  if (coverIds.length > 0) {
    const { signMediaForAsset } = await import("@/lib/content/service");
    const signed = await Promise.all(
      coverIds.map(async (id) => [id, await signMediaForAsset(admin, id, "feed")] as const)
    );
    for (const [id, url] of signed) if (url) coverUrlById.set(id, url);
  }

  const rankable = visible.map((event) => ({
    id: event.id,
    startsAtMs: Date.parse(event.starts_at),
    endsAtMs: Date.parse(event.ends_at),
    status: event.status,
    goingCount: goingByEvent.get(event.id) ?? 0,
    interestedCount: interestedByEvent.get(event.id) ?? 0,
    recentGoingCount: recentGoingByEvent.get(event.id) ?? 0,
    recentInterestedCount: recentInterestedByEvent.get(event.id) ?? 0,
    name: event.name,
    venueLabel: event.venue_label,
    startsAt: event.starts_at,
    endsAt: event.ends_at,
    isHost: event.host_id === userId,
    coverUrl: event.cover_media_id ? coverUrlById.get(event.cover_media_id) ?? null : null,
    focalX: event.cover_focal_x,
    focalY: event.cover_focal_y
  }));

  return rankEvents(rankable, nowMs, boundedLimit).map((event) => ({
    id: event.id,
    rank: event.rank,
    name: event.name,
    venueLabel: event.venueLabel,
    startsAt: event.startsAt,
    endsAt: event.endsAt,
    status: event.status,
    // The canonical cover when the event has one, the deterministic generated
    // fallback when it does not (legacy events, and drafts). One resolver, so
    // the accordion, the Top 100 and the detail surface cannot disagree about
    // what an event looks like.
    media: resolveEventMedia(event.id, event.coverUrl),
    focalPoint: { x: event.focalX, y: event.focalY },
    goingCount: event.goingCount,
    interestedCount: event.interestedCount,
    myRsvp: (myRsvpByEvent.get(event.id) as EventRsvpStatus | undefined) ?? null,
    isHost: event.isHost
  }));
}
