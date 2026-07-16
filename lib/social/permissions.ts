import "server-only";

import { resolveFeatureAccess, type ActiveVisibilitySession } from "@/lib/social/visibility";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import type { VisibilityFeatureType } from "@/lib/supabase/database.types";

/**
 * Shared server-side permission service (spec §53). Every "can A interact
 * with / see B" decision routes through here so the privacy rules live in one
 * audited place instead of being re-implemented per route. Uses the service
 * role admin client; callers must have already authenticated the requester.
 */

type Admin = ReturnType<typeof createSupabaseAdminClient>;

export async function areApprovedMuddies(admin: Admin, userA: string, userB: string): Promise<boolean> {
  const { data } = await admin
    .from("friendships")
    .select("user_one_id")
    .or(
      `and(user_one_id.eq.${userA},user_two_id.eq.${userB}),and(user_one_id.eq.${userB},user_two_id.eq.${userA})`
    )
    .limit(1);
  return Boolean(data?.length);
}

export async function isBlockedEitherDirection(admin: Admin, userA: string, userB: string): Promise<boolean> {
  const { data } = await admin
    .from("blocked_users")
    .select("blocker_id")
    .or(
      `and(blocker_id.eq.${userA},blocked_id.eq.${userB}),and(blocker_id.eq.${userB},blocked_id.eq.${userA})`
    )
    .limit(1);
  return Boolean(data?.length);
}

export async function isCloseFriend(admin: Admin, ownerId: string, viewerId: string): Promise<boolean> {
  const { data } = await admin
    .from("close_friend_relationships")
    .select("id")
    .eq("owner_id", ownerId)
    .eq("friend_id", viewerId)
    .limit(1);
  return Boolean(data?.length);
}

/** Circle ids owned by `ownerId` that `viewerId` is currently a member of. */
export async function viewerCircleIds(
  admin: Admin,
  ownerId: string,
  viewerId: string
): Promise<Set<string>> {
  const { data: circles } = await admin
    .from("friend_circles")
    .select("id")
    .eq("user_id", ownerId)
    .is("archived_at", null);
  const circleIds = (circles ?? []).map((circle) => circle.id);
  if (circleIds.length === 0) return new Set();

  const { data: memberships } = await admin
    .from("circle_members")
    .select("circle_id")
    .eq("friend_id", viewerId)
    .in("circle_id", circleIds);
  return new Set((memberships ?? []).map((membership) => membership.circle_id));
}

export type OwnerVisibilityContext = {
  ownerGhostMode: boolean;
  session: ActiveVisibilitySession | null;
  excludedUserIds: Set<string>;
};

/**
 * Loads an owner's active visibility session (+ its targets) and Ghost Mode
 * state for a feature. Returned once per owner and reused across all viewers,
 * so a feed of N friends does N profile reads, not N×(session+targets) reads.
 */
export async function loadOwnerVisibilityContext(
  admin: Admin,
  ownerId: string,
  featureType: VisibilityFeatureType,
  ownerGhostMode: boolean
): Promise<OwnerVisibilityContext> {
  const { data: session } = await admin
    .from("visibility_sessions")
    .select("id, visibility_mode, ends_at")
    .eq("user_id", ownerId)
    .eq("feature_type", featureType)
    .eq("status", "active")
    .maybeSingle();

  if (!session) {
    return { ownerGhostMode, session: null, excludedUserIds: new Set() };
  }

  const { data: targets } = await admin
    .from("visibility_targets")
    .select("target_type, target_id, access_type")
    .eq("session_id", session.id);

  const includedCircleIds = new Set<string>();
  const excludedUserIds = new Set<string>();
  for (const target of targets ?? []) {
    if (target.access_type === "include" && target.target_type === "circle") {
      includedCircleIds.add(target.target_id);
    } else if (target.access_type === "exclude" && target.target_type === "user") {
      excludedUserIds.add(target.target_id);
    }
  }

  return {
    ownerGhostMode,
    session: {
      visibilityMode: session.visibility_mode,
      includedCircleIds,
      endsAtMs: session.ends_at ? Date.parse(session.ends_at) : null
    },
    excludedUserIds
  };
}

/**
 * Batched feed resolver (spec §23, §32): given a viewer and a set of friend
 * owners, returns the friend ids whose feature the viewer is currently NOT
 * allowed to see because of an active restrictive visibility session. Friends
 * with no active session are never in the result (default = visible), so the
 * caller keeps its existing behavior for everyone who hasn't narrowed their
 * audience. Block/Ghost/mutual are handled by the caller's existing filter;
 * this layers circle/close-friend/hidden gating on top with four batched
 * queries instead of N per-friend lookups.
 */
export async function resolveFeatureDeniedIds(
  admin: Admin,
  viewerId: string,
  ownerIds: string[],
  featureType: VisibilityFeatureType,
  nowMs = Date.now()
): Promise<Set<string>> {
  const denied = new Set<string>();
  if (ownerIds.length === 0) return denied;

  const { data: sessions } = await admin
    .from("visibility_sessions")
    .select("id, user_id, visibility_mode, ends_at")
    .in("user_id", ownerIds)
    .eq("feature_type", featureType)
    .eq("status", "active");

  const activeSessions = sessions ?? [];
  if (activeSessions.length === 0) return denied;

  const sessionIds = activeSessions.map((session) => session.id);
  const ownersWithSession = activeSessions.map((session) => session.user_id);

  const [{ data: targets }, { data: closeFriends }, { data: ownedCircles }] = await Promise.all([
    admin
      .from("visibility_targets")
      .select("session_id, target_type, target_id, access_type")
      .in("session_id", sessionIds),
    admin
      .from("close_friend_relationships")
      .select("owner_id")
      .eq("friend_id", viewerId)
      .in("owner_id", ownersWithSession),
    admin
      .from("friend_circles")
      .select("id, user_id")
      .in("user_id", ownersWithSession)
      .is("archived_at", null)
  ]);

  const closeFriendOwners = new Set((closeFriends ?? []).map((row) => row.owner_id));

  // Which of each owner's circles does the viewer belong to?
  const circleOwnerById = new Map((ownedCircles ?? []).map((circle) => [circle.id, circle.user_id]));
  const viewerCirclesByOwner = new Map<string, Set<string>>();
  if (circleOwnerById.size > 0) {
    const { data: memberships } = await admin
      .from("circle_members")
      .select("circle_id")
      .eq("friend_id", viewerId)
      .in("circle_id", [...circleOwnerById.keys()]);
    for (const membership of memberships ?? []) {
      const owner = circleOwnerById.get(membership.circle_id);
      if (!owner) continue;
      if (!viewerCirclesByOwner.has(owner)) viewerCirclesByOwner.set(owner, new Set());
      viewerCirclesByOwner.get(owner)!.add(membership.circle_id);
    }
  }

  const includedCirclesBySession = new Map<string, Set<string>>();
  const excludedUsersBySession = new Map<string, Set<string>>();
  for (const target of targets ?? []) {
    if (target.access_type === "include" && target.target_type === "circle") {
      if (!includedCirclesBySession.has(target.session_id)) {
        includedCirclesBySession.set(target.session_id, new Set());
      }
      includedCirclesBySession.get(target.session_id)!.add(target.target_id);
    } else if (target.access_type === "exclude" && target.target_type === "user") {
      if (!excludedUsersBySession.has(target.session_id)) {
        excludedUsersBySession.set(target.session_id, new Set());
      }
      excludedUsersBySession.get(target.session_id)!.add(target.target_id);
    }
  }

  for (const session of activeSessions) {
    const ownerId = session.user_id;
    const result = resolveFeatureAccess({
      areMutualMuddies: true, // caller already filtered to mutual Muddies
      isBlockedEitherDirection: false,
      ownerGhostMode: false, // caller already excluded ghosted owners
      ownerSuspended: false,
      viewerIsCloseFriend: closeFriendOwners.has(ownerId),
      viewerCircleIds: viewerCirclesByOwner.get(ownerId) ?? new Set(),
      viewerExplicitlyExcluded: excludedUsersBySession.get(session.id)?.has(viewerId) ?? false,
      session: {
        visibilityMode: session.visibility_mode,
        includedCircleIds: includedCirclesBySession.get(session.id) ?? new Set(),
        endsAtMs: session.ends_at ? Date.parse(session.ends_at) : null
      },
      nowMs
    });
    if (!result.allowed) denied.add(ownerId);
  }

  return denied;
}

/**
 * Full resolution for one owner→viewer→feature decision. Prefer the batched
 * helpers above when resolving a whole feed; this is the single-pair path.
 */
export async function canViewerAccessFeature(
  admin: Admin,
  ownerId: string,
  viewerId: string,
  featureType: VisibilityFeatureType,
  options: { ownerGhostMode?: boolean; nowMs?: number } = {}
): Promise<boolean> {
  const [blocked, mutual] = await Promise.all([
    isBlockedEitherDirection(admin, ownerId, viewerId),
    areApprovedMuddies(admin, ownerId, viewerId)
  ]);
  if (blocked || !mutual) return false;

  let ownerGhostMode = options.ownerGhostMode;
  if (ownerGhostMode === undefined) {
    const { data: profile } = await admin
      .from("profiles")
      .select("visibility_status")
      .eq("user_id", ownerId)
      .maybeSingle();
    ownerGhostMode = profile?.visibility_status === "ghost";
  }

  const [context, closeFriend, circleIds] = await Promise.all([
    loadOwnerVisibilityContext(admin, ownerId, featureType, ownerGhostMode),
    isCloseFriend(admin, ownerId, viewerId),
    viewerCircleIds(admin, ownerId, viewerId)
  ]);

  return resolveFeatureAccess({
    areMutualMuddies: true,
    isBlockedEitherDirection: false,
    ownerGhostMode: context.ownerGhostMode,
    ownerSuspended: false,
    viewerIsCloseFriend: closeFriend,
    viewerCircleIds: circleIds,
    viewerExplicitlyExcluded: context.excludedUserIds.has(viewerId),
    session: context.session,
    nowMs: options.nowMs ?? Date.now()
  }).allowed;
}
