import "server-only";
import type { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { buildSafeNearbyFriends, haversineMeters } from "@/lib/proximity/backend";
import { resolveFeatureDeniedIds } from "@/lib/social/permissions";
import { resolveFeatureAccess } from "@/lib/social/visibility";
import { canUpdateArrival, type Meetup } from "@/lib/meetups/rules";

type Admin = ReturnType<typeof createSupabaseAdminClient>;
// Meet Up needs a current hint, not the wider nearby-discovery freshness window.
export const MEETUP_FIX_MAX_AGE_MS = 2 * 60_000;

export async function addMeetupProximity(admin: Admin, viewerId: string, meetups: Meetup[], now = Date.now()): Promise<Meetup[]> {
  // A caller may reuse a previous projection. Old hints are never permissions.
  meetups = meetups.map((m) => ({ ...m, members: m.members.map((p) => {
    const clean = { ...p };
    delete clean.nearby;
    delete clean.observedAt;
    return clean;
  }) }));
  const active = meetups.filter((m) => canUpdateArrival(m, viewerId, now) && now <= Date.parse(m.startsAt) + 2 * 60 * 60_000
    && m.members.some((p) => p.userId === viewerId && p.proximityEnabled && p.arrival !== "left"));
  const peers = [...new Set(active.flatMap((m) => m.members.filter((p) => p.userId && p.userId !== viewerId
    && p.response === "accepted" && p.arrival !== "left" && p.proximityEnabled).map((p) => p.userId!)))];
  if (!peers.length) return meetups;
  try {
    const ids = [viewerId, ...peers];
    const [locations, profiles, zones, blocks, session] = await Promise.all([
      admin.from("user_locations").select("user_id,latitude,longitude,confidence,last_updated").in("user_id", ids),
      admin.from("profiles").select("user_id,full_name,username,avatar_url,visibility_status").in("user_id", ids),
      admin.from("privacy_zones").select("user_id,latitude,longitude,radius").in("user_id", ids).eq("is_active", true),
      admin.from("blocked_users").select("blocker_id,blocked_id").or(`blocker_id.eq.${viewerId},blocked_id.eq.${viewerId}`),
      admin.from("visibility_sessions").select("id,visibility_mode,ends_at").eq("user_id", viewerId).eq("feature_type", "glow").eq("status", "active").maybeSingle()
    ]);
    if (locations.error || profiles.error || zones.error || blocks.error || session.error) return meetups;
    const profileMap = new Map((profiles.data ?? []).map((p) => [p.user_id, p]));
    if (!profileMap.has(viewerId) || profileMap.get(viewerId)?.visibility_status === "ghost") return meetups;
    const blocked = new Set((blocks.data ?? []).flatMap((b) => [b.blocker_id, b.blocked_id]).filter((id) => id !== viewerId));
    const locationMap = new Map((locations.data ?? []).filter((l) => {
      const age = now - Date.parse(l.last_updated);
      return Number.isFinite(age) && age >= -15_000 && age <= MEETUP_FIX_MAX_AGE_MS
        && !(zones.data ?? []).some((z) => z.user_id === l.user_id && haversineMeters(l, z) <= z.radius);
    }).map((l) => [l.user_id, l]));
    const viewer = locationMap.get(viewerId);
    if (!viewer) return meetups;
    const denied = await resolveFeatureDeniedIds(admin, viewerId, peers, "glow", now, true);
    let allowed = peers.filter((id) => !denied.has(id));
    // Consent cannot override the viewer's own selected Glow audience either.
    if (session.data) {
      const [targets, close, circles] = await Promise.all([
        admin.from("visibility_targets").select("target_type,target_id,access_type").eq("session_id", session.data.id),
        admin.from("close_friend_relationships").select("friend_id").eq("owner_id", viewerId).in("friend_id", peers),
        admin.from("friend_circles").select("id").eq("user_id", viewerId).is("archived_at", null)
      ]);
      if (targets.error || close.error || circles.error) return meetups;
      const circleIds = (circles.data ?? []).map((c) => c.id);
      const members = circleIds.length ? await admin.from("circle_members").select("circle_id,friend_id").in("circle_id", circleIds).in("friend_id", peers) : { data: [], error: null };
      if (members.error) return meetups;
      const ownSession = session.data;
      allowed = allowed.filter((id) => resolveFeatureAccess({ areMutualMuddies: true, isBlockedEitherDirection: blocked.has(id),
        ownerGhostMode: false, ownerSuspended: false, viewerIsCloseFriend: (close.data ?? []).some((c) => c.friend_id === id),
        viewerCircleIds: new Set((members.data ?? []).filter((p) => p.friend_id === id).map((p) => p.circle_id)),
        viewerExplicitlyExcluded: (targets.data ?? []).some((t) => t.target_type === "user" && t.access_type === "exclude" && t.target_id === id),
        session: { visibilityMode: ownSession.visibility_mode, endsAtMs: ownSession.ends_at ? Date.parse(ownSession.ends_at) : null,
          includedCircleIds: new Set((targets.data ?? []).filter((t) => t.target_type === "circle" && t.access_type === "include").map((t) => t.target_id)) }, nowMs: now }).allowed);
    }
    const nearby = new Set(buildSafeNearbyFriends({ viewer, friendIds: allowed, blockedIds: blocked,
      premiumUserIds: new Set(), locationByUserId: locationMap, profileByUserId: profileMap, now })
      .filter((p) => p.proximity_level === "close" || p.proximity_level === "near").map((p) => p.friend_id));
    const activeIds = new Set(active.map((m) => m.id));
    return meetups.map((m) => !activeIds.has(m.id) ? m : { ...m, members: m.members.map((p) =>
      p.userId && p.response === "accepted" && p.arrival !== "left" && p.proximityEnabled && nearby.has(p.userId)
        ? { ...p, nearby: true, observedAt: new Date(now).toISOString() } : p) });
  } catch {
    // A failed privacy read never becomes permission to expose proximity.
    return meetups;
  }
}
