import { NextResponse } from "next/server";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { resolveApiUser } from "@/lib/api/auth";
import { preflightResponse, withCors } from "@/lib/api/cors";
import { guardFeature } from "@/lib/admin/enforcement";
import { CONFERENCE_FLAG, isFeatureEnabled } from "@/lib/features/feature-flags";
import { consumeRateLimit, rateLimitMessage } from "@/lib/security/rate-limit";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

const requestSchema = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  accuracy: z.number().min(0).max(10000)
});

const AREA_REFRESH_METERS = 2_000;
const EARTH_RADIUS_M = 6_371_000;

function coarseCoordinate(value: number) {
  return Math.round(value * 100) / 100;
}

function toRad(value: number) {
  return (value * Math.PI) / 180;
}

function distanceMeters(aLat: number, aLon: number, bLat: number, bLon: number) {
  const dLat = toRad(bLat - aLat);
  const dLon = toRad(bLon - aLon);
  const lat1 = toRad(aLat);
  const lat2 = toRad(bLat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.sin(dLon / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function OPTIONS(request: Request) {
  return preflightResponse(request);
}

/**
 * Conference location is deliberately separate from public.user_locations.
 * Refreshing "Around You" must never refresh Glow or change a user's nearby
 * presence. Only a coarse current signal is retained, one row per account.
 */
export async function POST(request: Request) {
  const auth = await resolveApiUser(request);
  if (!auth) {
    return withCors(NextResponse.json({ error: "Authentication required." }, { status: 401 }), request);
  }

  const parsed = requestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return withCors(NextResponse.json({ error: "Invalid Conference location." }, { status: 400 }), request);
  }

  const limit = await consumeRateLimit({ action: "conference.location", userId: auth.user.id });
  if (!limit.allowed) {
    return withCors(NextResponse.json({ error: rateLimitMessage(limit.resetAt) }, { status: 429 }), request);
  }

  const admin = createSupabaseAdminClient();
  if (!(await isFeatureEnabled(admin, CONFERENCE_FLAG))) {
    return withCors(NextResponse.json({ error: "Conference is unavailable." }, { status: 404 }), request);
  }

  const guard = await guardFeature(admin, "location_collection");
  if (!guard.allowed) {
    return withCors(NextResponse.json({ error: guard.message }, { status: 503 }), request);
  }

  // The curated database types intentionally lag unapplied migrations. Cast
  // only this new-table boundary; existing Mad Buddy tables remain typed.
  const conference = admin as unknown as SupabaseClient;
  const { data: previous } = await conference
    .from("conference_locations")
    .select("latitude, longitude")
    .eq("user_id", auth.user.id)
    .maybeSingle();

  const nextLatitude = coarseCoordinate(parsed.data.latitude);
  const nextLongitude = coarseCoordinate(parsed.data.longitude);
  // Seeding Conference's dedicated location for the first time is not an
  // "area change". If the feed already loaded from a fresh Glow signal, forcing
  // a reload here can race with an optimistic report/hide/vote and resurrect
  // stale UI. The caller's refreshOnFirst path already handles a truly missing
  // initial Conference location.
  const areaChanged = previous
    ? distanceMeters(
        Number(previous.latitude),
        Number(previous.longitude),
        nextLatitude,
        nextLongitude
      ) >= AREA_REFRESH_METERS
    : false;
  const anchorLatitude = previous && !areaChanged ? Number(previous.latitude) : nextLatitude;
  const anchorLongitude = previous && !areaChanged ? Number(previous.longitude) : nextLongitude;

  // Small GPS drift refreshes the timestamp without moving the feed anchor.
  // Once movement reaches 2km, advance the anchor and let the client reload
  // the Around You feed once.
  const { error } = await conference.from("conference_locations").upsert(
    {
      user_id: auth.user.id,
      latitude: anchorLatitude,
      longitude: anchorLongitude,
      accuracy: parsed.data.accuracy,
      last_updated: new Date().toISOString()
    },
    { onConflict: "user_id" }
  );

  if (error) {
    return withCors(NextResponse.json({ error: "Could not refresh Conference Around You." }, { status: 500 }), request);
  }

  return withCors(
    NextResponse.json({ received: true, areaChanged, expiresInSeconds: 15 * 60 }),
    request
  );
}
