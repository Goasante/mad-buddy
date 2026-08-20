import "server-only";

import { isDiscoverableInFeed } from "@/lib/events/rules";
import { batchBlockedIds } from "@/lib/social/permissions";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

/**
 * Nearby Event discovery.
 *
 * EVENT GEOGRAPHY IS NOT MUDDY PROXIMITY. A published venue is information the
 * host chose to share about a programme; a Muddy's position is a private,
 * decaying signal about a person. They have different ranges, different
 * freshness rules and different consequences, so this deliberately does not
 * import anything from the proximity engine.
 *
 * Nothing here returns the viewer's coordinates, the venue's coordinates, or a
 * distance. Discovery answers "near you" and names a locality; a number in
 * kilometres tells somebody how far they are from a place they have not agreed
 * to be measured against.
 */

/**
 * How far "near you" reaches, in metres. CANONICAL AND HARD.
 *
 * 5km, and it is never silently widened. An earlier 25km ceiling was chosen on
 * the theory that people cross a city for a programme -- true, but it made
 * "Near you" meaningless: it returned everything in Greater Accra, so a phrase
 * that promises proximity described a list that had nothing to do with where
 * the viewer was standing.
 *
 * When there is little inside 5km the honest answer is FEWER EVENTS, or none.
 * A Public Event further away can still be found through ordinary Public
 * discovery -- Home, Discover, Trending -- it simply must not be labelled or
 * ranked as "Near you", because it is not.
 */
export const EVENT_LOCAL_DISCOVERY_MAX_METERS = 5_000;

/**
 * How old a viewer position may be and still answer "near you", in ms.
 *
 * DECLARED HERE, not imported from lib/proximity. Event geography and Muddy
 * proximity are deliberately separate systems -- audience-creation.test.ts
 * enforces that this module never reaches into the proximity engine, because
 * the day those two sets of rules share code is the day a change to friend
 * bands silently changes who can discover an Event.
 *
 * Fifteen minutes matches the product's existing sense of a stale fix. Beyond
 * it the honest answer is that we do not know where this person is.
 */
export const VIEWER_LOCATION_MAX_AGE_MS = 15 * 60 * 1000;

const EARTH_RADIUS_M = 6_371_000;

/** Great-circle distance. Server-only: the number never leaves this module. */
function distanceMeters(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLon = toRad(bLon - aLon);
  const lat1 = toRad(aLat);
  const lat2 = toRad(bLat);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.sin(dLon / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * A degree box that comfortably contains the radius.
 *
 * Cheap prefilter so the database returns tens of candidate rows instead of
 * every Event with a location; the exact great-circle check then trims the
 * corners of the box. This is why the schema needs no PostGIS.
 */
export function boundingBox(lat: number, lon: number, radiusMeters: number) {
  const latDelta = (radiusMeters / EARTH_RADIUS_M) * (180 / Math.PI);
  // Longitude degrees shrink towards the poles; guard the cosine so a viewer
  // near a pole cannot produce an unbounded box.
  const lonDelta = latDelta / Math.max(0.01, Math.cos((lat * Math.PI) / 180));
  return {
    minLat: lat - latDelta,
    maxLat: lat + latDelta,
    minLon: lon - lonDelta,
    maxLon: lon + lonDelta
  };
}

export type NearbyEvent = {
  id: string;
  name: string;
  venueLabel: string | null;
  startsAt: string;
  endsAt: string;
  /** Coarse place name for display. Never a distance. */
  locality: string | null;
};

/**
 * Events near a viewer's area, ordered by when they start.
 *
 * Visibility precedes geography: an Event that happens to be close is not
 * therefore discoverable. Only `nearby` and `public` audiences reach this at
 * all, so a private wedding down the road stays private.
 */
export async function listNearbyEvents(
  userId: string,
  viewer: { latitude: number; longitude: number },
  radiusMeters: number = EVENT_LOCAL_DISCOVERY_MAX_METERS
): Promise<NearbyEvent[]> {
  const admin = createSupabaseAdminClient();
  const box = boundingBox(viewer.latitude, viewer.longitude, radiusMeters);

  const { data: locations } = await admin
    .from("event_locations")
    .select("event_id, latitude, longitude, locality")
    .gte("latitude", box.minLat)
    .lte("latitude", box.maxLat)
    .gte("longitude", box.minLon)
    .lte("longitude", box.maxLon)
    /* Hard cap on the prefilter.
     *
     * The box already keeps this to a city rather than a continent, but "a
     * city" is not a number -- a dense metro could one day put thousands of
     * venues inside it, and every one of those rows would be sorted and
     * distance-checked in the request. 500 is far more than the 50 Events the
     * feed can show, so the cap only ever trims a tail that could not have
     * been displayed anyway. */
    .limit(500);
  if (!locations?.length) return [];

  // Exact check trims the box corners; the distance is used and discarded.
  const withinRadius = locations.filter(
    (row) =>
      distanceMeters(viewer.latitude, viewer.longitude, row.latitude, row.longitude) <= radiusMeters
  );
  if (withinRadius.length === 0) return [];

  const nowIso = new Date().toISOString();
  const { data: events } = await admin
    .from("events")
    .select("id, host_id, name, venue_label, starts_at, ends_at, visibility, status")
    .in(
      "id",
      withinRadius.map((row) => row.event_id)
    )
    .in("status", ["scheduled", "active"])
    .gte("ends_at", nowIso)
    .order("starts_at", { ascending: true })
    .limit(50);
  if (!events?.length) return [];

  /* The same feed authority the rest of discovery uses, so proximity can never
     become a second way in. `nearby` and `public` pass; invite, link and a
     targeted community do not. */
  const discoverable = events.filter((event) =>
    isDiscoverableInFeed({ visibility: event.visibility, hostId: event.host_id }, userId)
  );
  if (discoverable.length === 0) return [];

  const blockedHosts = await batchBlockedIds(
    admin,
    userId,
    discoverable.map((event) => event.host_id)
  );
  const localityByEvent = new Map(withinRadius.map((row) => [row.event_id, row.locality]));

  return discoverable
    .filter((event) => !blockedHosts.has(event.host_id))
    .map((event) => ({
      id: event.id,
      name: event.name,
      venueLabel: event.venue_label,
      startsAt: event.starts_at,
      endsAt: event.ends_at,
      locality: localityByEvent.get(event.id) ?? null
    }));
}

/**
 * The Event ids genuinely within "Near you" of this viewer, right now.
 *
 * WHY AN ID SET. Discover already holds the projected Events; what it lacked
 * was any real notion of near. Its "Near you" filter selected Events that had
 * a published locality at all, so in one city it matched everything -- a label
 * promising proximity over a list that had nothing to do with where the viewer
 * was standing. Returning ids lets the client intersect without another
 * projection, and without any distance reaching it.
 *
 * NO FRESH LOCATION, NO LIST. `null` means "we cannot answer this", which the
 * UI must render as an honest prompt rather than as an empty result -- and
 * never as a generic list pretending to be local.
 *
 * The viewer's coordinates stay on the server: the return value is ids only,
 * ordered by distance but carrying none of it.
 */
export async function nearbyEventIdsForViewer(
  userId: string,
  eventIds: readonly string[]
): Promise<string[] | null> {
  if (eventIds.length === 0) return [];

  const admin = createSupabaseAdminClient();
  const { data: viewer } = await admin
    .from("user_locations")
    .select("latitude, longitude, last_updated")
    .eq("user_id", userId)
    .maybeSingle();
  if (!viewer) return null;

  /* A stale position is not a location. Fifteen minutes is the product's
   * existing "older" boundary; beyond it the honest answer is that we do not
   * know where this person is, not a list built from where they used to be. */
  const ageMs = Date.now() - Date.parse(viewer.last_updated);
  if (!Number.isFinite(ageMs) || ageMs > VIEWER_LOCATION_MAX_AGE_MS) return null;

  const box = boundingBox(viewer.latitude, viewer.longitude, EVENT_LOCAL_DISCOVERY_MAX_METERS);
  const { data: locations } = await admin
    .from("event_locations")
    .select("event_id, latitude, longitude")
    .in("event_id", [...eventIds])
    .gte("latitude", box.minLat)
    .lte("latitude", box.maxLat)
    .gte("longitude", box.minLon)
    .lte("longitude", box.maxLon);

  /* The box is a cheap prefilter -- it is a square, so its corners reach
   * further than the radius. The exact great-circle check is what enforces the
   * 5km promise, and it is never widened when the result is thin: fewer Events
   * is the correct answer, not a quiet expansion outward. */
  return (locations ?? [])
    .map((row) => ({
      eventId: row.event_id,
      meters: distanceMeters(viewer.latitude, viewer.longitude, row.latitude, row.longitude)
    }))
    .filter((row) => row.meters <= EVENT_LOCAL_DISCOVERY_MAX_METERS)
    .sort((a, b) => a.meters - b.meters)
    .map((row) => row.eventId);
}
