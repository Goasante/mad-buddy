import "server-only";

import { buildSafeNearbyFriends, type SafeNearbyFriend } from "@/lib/proximity/backend";
import { resolveFeatureDeniedIds } from "@/lib/social/permissions";
import type { ConfidenceLevel } from "@/lib/proximity";
import type { createSupabaseAdminClient } from "@/lib/supabase/admin";

/**
 * Read-only nearby computation shared by the nearby route and the Pulse
 * aggregator (spec §57 resolveProximityBand / canDisplayProximityCard). Pure
 * of side effects, no rate limiting, no notification writes, no proximity_event
 * inserts, so the Pulse can reuse the exact authorization + privacy pipeline
 * without triggering the route's write side effects.
 */

type Admin = ReturnType<typeof createSupabaseAdminClient>;

type LocationRow = {
  user_id: string;
  latitude: number;
  longitude: number;
  confidence: ConfidenceLevel;
  last_updated: string;
};

type ProfileRow = {
  user_id: string;
  full_name: string;
  username: string;
  avatar_url: string | null;
  visibility_status: "visible" | "ghost" | "app_open_only";
};

export async function loadNearbyForUser(admin: Admin, userId: string): Promise<SafeNearbyFriend[]> {
  const { data: viewerLocation } = await admin
    .from("user_locations")
    .select("user_id, latitude, longitude, confidence, last_updated")
    .eq("user_id", userId)
    .maybeSingle();
  if (!viewerLocation) return [];

  const { data: friendships } = await admin
    .from("friendships")
    .select("user_one_id, user_two_id")
    .or(`user_one_id.eq.${userId},user_two_id.eq.${userId}`);

  const friendIds = (friendships ?? []).map((friendship) =>
    friendship.user_one_id === userId ? friendship.user_two_id : friendship.user_one_id
  );
  if (friendIds.length === 0) return [];

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
        .or(`blocker_id.eq.${userId},blocked_id.eq.${userId}`),
      admin.from("subscriptions").select("user_id, plan, status").in("user_id", friendIds),
      admin
        .from("user_statuses")
        .select("user_id, availability_type, activity_type, custom_text, expires_at")
        .in("user_id", friendIds)
        .eq("visibility_type", "all_muddies")
        .gt("expires_at", new Date().toISOString())
    ]);

  const blockedIds = new Set(
    (blocksResult.data ?? []).flatMap((block) => [block.blocker_id, block.blocked_id])
  );
  const locationByUserId = new Map(
    ((locationsResult.data ?? []) as LocationRow[]).map((location) => [location.user_id, location])
  );
  const profileByUserId = new Map(
    ((profilesResult.data ?? []) as ProfileRow[]).map((profile) => [profile.user_id, profile])
  );
  const premiumUserIds = new Set(
    (subscriptionsResult.data ?? [])
      .filter((subscription) => subscription.status === "active" && subscription.plan !== "free")
      .map((subscription) => subscription.user_id)
  );
  const statusByUserId = new Map(
    (statusesResult.data ?? []).map((status) => [status.user_id, status])
  );

  let glowDeniedIds = new Set<string>();
  try {
    glowDeniedIds = await resolveFeatureDeniedIds(admin, userId, friendIds, "glow");
  } catch {
    glowDeniedIds = new Set();
  }
  const visibleFriendIds = friendIds.filter((friendId) => !glowDeniedIds.has(friendId));

  return buildSafeNearbyFriends({
    viewer: viewerLocation as LocationRow,
    friendIds: visibleFriendIds,
    blockedIds,
    premiumUserIds,
    locationByUserId,
    profileByUserId,
    statusByUserId
  });
}
