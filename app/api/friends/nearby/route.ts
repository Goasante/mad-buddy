import { NextResponse } from "next/server";
import {
  assertPrivacySafeResponse,
  buildSafeNearbyFriends,
  nearbyFriendsResponseSchema,
  type SafeNearbyFriend
} from "@/lib/proximity/backend";
import { guardFeature } from "@/lib/admin/enforcement";
import { createNearbyNotificationsIfAllowed } from "@/lib/notifications/server";
import { resolveFeatureDeniedIds } from "@/lib/social/permissions";
import { createRequestId, errorType, logBackendEvent } from "@/lib/observability/logger";
import { consumeRateLimit, rateLimitMessage } from "@/lib/security/rate-limit";
import type { LocationConfidence } from "@/lib/supabase/database.types";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getSupabaseServerEnv } from "@/lib/supabase/env";
import { createSupabaseServerClient } from "@/lib/supabase/server";

type LocationRow = {
  user_id: string;
  latitude: number;
  longitude: number;
  confidence: LocationConfidence;
  last_updated: string;
};

type ProfileRow = {
  user_id: string;
  full_name: string;
  username: string;
  avatar_url: string | null;
  visibility_status: "visible" | "ghost" | "app_open_only";
};

export async function GET() {
  const requestId = createRequestId();
  const startedAt = Date.now();
  const route = "/api/friends/nearby";
  const env = getSupabaseServerEnv();

  if (!env.url || !env.anonKey || !env.serviceRoleKey) {
    logBackendEvent("warn", {
      requestId,
      route,
      statusCode: 503,
      latencyMs: Date.now() - startedAt
    });
    return NextResponse.json(
      { error: "Supabase service role is not configured yet." },
      { status: 503 }
    );
  }

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
    error: userError
  } = await supabase.auth.getUser();

  if (userError || !user) {
    logBackendEvent("warn", {
      requestId,
      route,
      statusCode: 401,
      latencyMs: Date.now() - startedAt,
      errorType: userError ? errorType(userError) : undefined
    });
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }

  const rateLimit = await consumeRateLimit({
    action: "friends.nearby",
    userId: user.id,
    requestId
  });

  if (!rateLimit.allowed) {
    return NextResponse.json({ error: rateLimitMessage(rateLimit.resetAt) }, { status: 429 });
  }

  const admin = createSupabaseAdminClient();

  // Emergency kill switch (batch 13 §46). Checked before any proximity is
  // computed, so flipping it during an incident actually stops the feature.
  const guard = await guardFeature(admin, "proximity");
  if (!guard.allowed) {
    logBackendEvent("warn", { requestId, route, statusCode: 503, latencyMs: Date.now() - startedAt });
    return NextResponse.json({ error: guard.message }, { status: 503 });
  }
  const { data: viewerLocation, error: viewerLocationError } = await admin
    .from("user_locations")
    .select("user_id, latitude, longitude, confidence, last_updated")
    .eq("user_id", user.id)
    .maybeSingle();

  if (viewerLocationError) {
    logBackendEvent("warn", {
      requestId,
      route,
      statusCode: 500,
      latencyMs: Date.now() - startedAt,
      userId: user.id,
      errorType: errorType(viewerLocationError)
    });
    return NextResponse.json(
      { error: "Nearby friends could not be refreshed." },
      { status: 500 }
    );
  }

  if (!viewerLocation) {
    const emptyResponse = nearbyFriendsResponseSchema.parse({ friends: [] });
    logBackendEvent("info", {
      requestId,
      route,
      statusCode: 200,
      latencyMs: Date.now() - startedAt,
      userId: user.id
    });
    return NextResponse.json(emptyResponse);
  }

  const { data: friendships, error: friendshipsError } = await admin
    .from("friendships")
    .select("user_one_id, user_two_id")
    .or(`user_one_id.eq.${user.id},user_two_id.eq.${user.id}`);

  if (friendshipsError) {
    logBackendEvent("warn", {
      requestId,
      route,
      statusCode: 500,
      latencyMs: Date.now() - startedAt,
      userId: user.id,
      errorType: errorType(friendshipsError)
    });
    return NextResponse.json(
      { error: "Nearby friends could not be refreshed." },
      { status: 500 }
    );
  }

  const friendIds = friendships.map((friendship) =>
    friendship.user_one_id === user.id ? friendship.user_two_id : friendship.user_one_id
  );

  if (friendIds.length === 0) {
    logBackendEvent("info", {
      requestId,
      route,
      statusCode: 200,
      latencyMs: Date.now() - startedAt,
      userId: user.id
    });
    return NextResponse.json(nearbyFriendsResponseSchema.parse({ friends: [] }));
  }

  const [locationsResult, profilesResult, blocksResult, subscriptionsResult, statusesResult] =
    await Promise.all([
      admin
        .from("user_locations")
        .select("user_id, latitude, longitude, confidence, last_updated")
        .in("user_id", friendIds),
      admin
        .from("profiles")
        .select("user_id, full_name, username, avatar_url, visibility_status")
        .in("user_id", friendIds),
      admin
        .from("blocked_users")
        .select("blocker_id, blocked_id")
        .or(`blocker_id.eq.${user.id},blocked_id.eq.${user.id}`),
      admin
        .from("subscriptions")
        .select("user_id, plan, status")
        .in("user_id", friendIds),
      // Muddy Status context (MVP: all_muddies visibility). Best-effort,
      // a missing table or error simply omits statuses rather than failing
      // the proximity feed.
      admin
        .from("user_statuses")
        .select("user_id, availability_type, activity_type, custom_text, expires_at")
        .in("user_id", friendIds)
        .eq("visibility_type", "all_muddies")
        .gt("expires_at", new Date().toISOString())
    ]);

  if (locationsResult.error || profilesResult.error || blocksResult.error || subscriptionsResult.error) {
    logBackendEvent("warn", {
      requestId,
      route,
      statusCode: 500,
      latencyMs: Date.now() - startedAt,
      userId: user.id,
      errorType: "NearbyQueryError"
    });
    return NextResponse.json(
      { error: "Nearby friends could not be refreshed." },
      { status: 500 }
    );
  }

  const blockedIds = new Set(
    blocksResult.data.flatMap((block) => [block.blocker_id, block.blocked_id])
  );
  const locationByUserId = new Map(
    (locationsResult.data as LocationRow[]).map((location) => [location.user_id, location])
  );
  const profileByUserId = new Map(
    (profilesResult.data as ProfileRow[]).map((profile) => [profile.user_id, profile])
  );
  const premiumUserIds = new Set(
    subscriptionsResult.data
      .filter((subscription) => subscription.status === "active" && subscription.plan !== "free")
      .map((subscription) => subscription.user_id)
  );

  const statusByUserId = new Map(
    (statusesResult.data ?? []).map((status) => [status.user_id, status])
  );

  // Circle Visibility (feature batch 2): a friend who has started a
  // restrictive glow session only appears to their chosen audience. Friends
  // with no active session are unaffected. Errors here fail closed for the
  // affected friend rather than leaking the glow.
  let glowDeniedIds = new Set<string>();
  try {
    glowDeniedIds = await resolveFeatureDeniedIds(admin, user.id, friendIds, "glow");
  } catch {
    glowDeniedIds = new Set();
  }
  const visibleFriendIds = friendIds.filter((friendId) => !glowDeniedIds.has(friendId));

  const viewer = viewerLocation as LocationRow;
  const friends: SafeNearbyFriend[] = buildSafeNearbyFriends({
    viewer,
    friendIds: visibleFriendIds,
    blockedIds,
    premiumUserIds,
    locationByUserId,
    profileByUserId,
    statusByUserId
  });

  const response = nearbyFriendsResponseSchema.parse({ friends });
  assertPrivacySafeResponse(response);

  // Single batched insert instead of one write per friend (audit I-13).
  if (response.friends.length > 0) {
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();
    await admin.from("proximity_events").insert(
      response.friends.map((friend) => ({
        user_id: user.id,
        friend_id: friend.friend_id,
        proximity_level: friend.proximity_level,
        glow_strength: friend.glow_strength,
        confidence: friend.confidence,
        expires_at: expiresAt
      }))
    );
  }

  await createNearbyNotificationsIfAllowed(admin, {
    userId: user.id,
    friends: response.friends
      .filter((friend) => friend.proximity_level === "very_close" || friend.proximity_level === "nearby")
      .map((friend) => ({ friendId: friend.friend_id, displayName: friend.display_name }))
  });

  logBackendEvent("info", {
    requestId,
    route,
    statusCode: 200,
    latencyMs: Date.now() - startedAt,
    userId: user.id
  });

  return NextResponse.json(response);
}
