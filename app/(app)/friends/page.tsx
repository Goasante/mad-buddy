import {
  FriendsPageContent,
  type InitialCircle,
  type UserSummary
} from "@/components/friends/friends-page";
import { loadFriendGlowColors } from "@/lib/glow/custom-colors-server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getCurrentUser } from "@/lib/supabase/auth";
import { actionableFriendRequests } from "@/lib/friends/relationship-state";
import {
  friendIdsFrom,
  summariseMutualsForMany,
  type MutualSummary
} from "@/lib/friends/mutual-muddies";
import { loadEffectivePlansForUsers } from "@/lib/billing/service";
import { hasVerifiedAccountStatus } from "@/lib/trust/verified-account";
import { getPhoneIdentity } from "@/lib/contacts/phone-identity";
import { loadReminderState } from "@/lib/contacts/reminder-store";
import {
  shouldContactDiscoveryReminderShow,
  type ContactReminderKind
} from "@/lib/contacts/reminder-eligibility";

export const dynamic = "force-dynamic";

export default async function FriendsPage() {
  const [{ users, circles, closeFriendIds, glowColorByFriendId }, reminder] = await Promise.all([
    loadFriendNetwork(),
    // Decided on the SERVER, so no prompt state reaches a client that could
    // be talked out of it, and no flash of a card that should not have shown.
    loadContactReminder()
  ]);

  return (
    <FriendsPageContent
      initialUsers={users}
      initialCircles={circles}
      initialCloseFriendIds={closeFriendIds}
      glowColorByFriendId={glowColorByFriendId}
      contactReminderKind={reminder}
    />
  );
}

/**
 * Whether to offer Contact Discovery here, and which prompt.
 *
 * Muddies is the strongest contextual surface for this: somebody looking at
 * their people is already thinking about who they know. The eligibility rules
 * live in one pure service; this only gathers what that service needs.
 */
async function loadContactReminder(): Promise<ContactReminderKind | null> {
  const user = await getCurrentUser();
  if (!user) return null;

  const admin = createSupabaseAdminClient();
  const [identity, state] = await Promise.all([
    getPhoneIdentity(admin, user.id),
    loadReminderState(admin, user.id)
  ]);

  const decision = shouldContactDiscoveryReminderShow({
    hasPhone: Boolean(identity),
    discoveryEnabled: identity?.discoveryEnabled ?? false,
    state,
    // The route is known: this only ever runs on /friends, which is not
    // excluded. Transient activity is a client concern and is re-checked
    // there before anything renders.
    pathname: "/friends",
    accountCreatedAt: user.created_at ?? null
  });

  return decision.show ? decision.kind : null;
}

async function loadFriendNetwork(): Promise<{
  users: UserSummary[];
  circles: InitialCircle[];
  closeFriendIds: string[];
  glowColorByFriendId: Record<string, string>;
}> {
  const user = await getCurrentUser();

  if (!user) {
    return { users: [], circles: [], closeFriendIds: [], glowColorByFriendId: {} };
  }

  const admin = createSupabaseAdminClient();
  const [requestsResult, friendshipsResult, blockedResult] = await Promise.all([
    admin
      .from("friend_requests")
      .select("id, sender_id, receiver_id, created_at")
      .eq("status", "pending")
      .or(`sender_id.eq.${user.id},receiver_id.eq.${user.id}`)
      .order("created_at", { ascending: false }),
    admin
      .from("friendships")
      .select("user_one_id, user_two_id")
      .or(`user_one_id.eq.${user.id},user_two_id.eq.${user.id}`)
      .is("ended_at", null),
    admin.from("blocked_users").select("blocked_id").eq("blocker_id", user.id)
  ]);

  const allPendingRequests = requestsResult.data ?? [];
  const friendships = friendshipsResult.data ?? [];
  const blocked = blockedResult.data ?? [];
  const blockedIds = new Set(blocked.map((entry) => entry.blocked_id));
  const requests = actionableFriendRequests(user.id, allPendingRequests, friendships, blockedIds);
  const profileIds = new Set<string>();

  requests.forEach((request) => {
    profileIds.add(request.sender_id === user.id ? request.receiver_id : request.sender_id);
  });
  friendships.forEach((friendship) => {
    profileIds.add(friendship.user_one_id === user.id ? friendship.user_two_id : friendship.user_one_id);
  });
  blocked.forEach((entry) => profileIds.add(entry.blocked_id));

  const [circles, closeFriendIds, glowColorByFriendId] = await Promise.all([
    loadCircles(admin, user.id),
    loadCloseFriendIds(admin, user.id),
    loadFriendGlowColors(admin, user.id)
  ]);

  if (profileIds.size === 0) {
    return { users: [], circles, closeFriendIds, glowColorByFriendId };
  }

  const { data: profiles } = await admin
    .from("profiles")
    .select("user_id, full_name, username, avatar_url, trusted_member_since")
    .in("user_id", [...profileIds]);
  const { data: verificationRows } = await admin
    .from("account_verifications")
    .select("user_id, status")
    .in("user_id", [...profileIds]);
  const plans = await loadEffectivePlansForUsers(admin, [...profileIds]);
  const profilesById = new Map((profiles ?? []).map((profile) => [profile.user_id, profile]));
  const verifiedByUserId = new Map<string, boolean>();
  for (const row of verificationRows ?? []) {
    const current = verifiedByUserId.get(row.user_id) ?? false;
    verifiedByUserId.set(row.user_id, current || row.status === "verified");
  }
  // Fallback for users whose profiles row hasn't synced yet. The auth admin
  // API has no bulk lookup, so this is inherently per-id, bounded to keep a
  // pathological backlog from fanning out into unbounded admin calls
  // (audit I-13). Ids beyond the cap are omitted until their profile syncs.
  const missingProfileIds = [...profileIds]
    .filter((profileId) => !profilesById.has(profileId))
    .slice(0, 20);

  await Promise.all(
    missingProfileIds.map(async (profileId) => {
      const { data } = await admin.auth.admin.getUserById(profileId);
      const metadata = data.user?.user_metadata;
      const metadataUsername = typeof metadata?.username === "string" ? metadata.username : null;
      const metadataName = typeof metadata?.full_name === "string" ? metadata.full_name : null;

      profilesById.set(profileId, {
        user_id: profileId,
        full_name: metadataName?.trim() || "Mad Buddy user",
        username: metadataUsername || `muddy_${profileId.slice(0, 8)}`,
        avatar_url: typeof metadata?.avatar_url === "string" ? metadata.avatar_url : null,
        // No profiles row yet, so no standing to report.
        trusted_member_since: null
      });
    })
  );
  /**
   * Mutual Muddies, in ONE batched read.
   *
   * Scoped to requests and existing friends only. Blocked users are left out
   * deliberately: showing who you both know is social-graph information, and
   * blocking someone is a request to stop being shown their world.
   */
  const viewerFriendIds = friendIdsFrom(user.id, friendships);
  const mutualSubjectIds = [...profileIds].filter((id) => !blockedIds.has(id));
  let mutualsById = new Map<string, MutualSummary>();

  if (mutualSubjectIds.length > 0) {
    // Every active friendship edge touching the people on this page. One query
    // for the whole list rather than one per row.
    const orFilter = `user_one_id.in.(${mutualSubjectIds.join(",")}),user_two_id.in.(${mutualSubjectIds.join(",")})`;
    const { data: mutualEdges } = await admin
      .from("friendships")
      .select("user_one_id, user_two_id")
      .or(orFilter)
      .is("ended_at", null);

    mutualsById = summariseMutualsForMany(
      user.id,
      viewerFriendIds,
      mutualSubjectIds,
      mutualEdges ?? []
    );
  }

  // Avatars for the faces shown beside a count. Drawn from profiles already
  // fetched where possible; anyone not in that map simply contributes to the
  // count without a face rather than triggering another read.
  const mutualPreviewIds = new Set<string>();
  for (const summary of mutualsById.values()) {
    for (const id of summary.previewIds) mutualPreviewIds.add(id);
  }
  const missingPreviewIds = [...mutualPreviewIds].filter((id) => !profilesById.has(id));
  const previewAvatarById = new Map<string, string | null>();
  if (missingPreviewIds.length > 0) {
    const { data: previewProfiles } = await admin
      .from("profiles")
      .select("user_id, avatar_url")
      .in("user_id", missingPreviewIds);
    for (const row of previewProfiles ?? []) previewAvatarById.set(row.user_id, row.avatar_url);
  }

  const mutualAvatarUrls = (id: string) =>
    (mutualsById.get(id)?.previewIds ?? [])
      .map((mutualId) => profilesById.get(mutualId)?.avatar_url ?? previewAvatarById.get(mutualId) ?? null)
      .filter((url): url is string => Boolean(url));

  const results: UserSummary[] = [];
  const renderedRequests = new Set<string>();

  requests.forEach((request) => {
    const isReceived = request.receiver_id === user.id;
    const profileId = isReceived ? request.sender_id : request.receiver_id;
    const profile = profilesById.get(profileId);
    const requestKey = `${isReceived ? "received" : "sent"}:${profileId}`;

    if (profile && !renderedRequests.has(requestKey)) {
      renderedRequests.add(requestKey);
      results.push({
        id: profileId,
        requestId: request.id,
        displayName: profile.full_name,
        username: profile.username,
        avatarUrl: profile.avatar_url,
        mutualFriends: mutualsById.get(profileId)?.count ?? 0,
        mutualAvatarUrls: mutualAvatarUrls(profileId),
        status: isReceived ? "received" : "sent",
        note: isReceived ? "Wants to connect with you" : "Waiting for a response",
        plan: plans.get(profileId) ?? "free",
        trustedSince: profile.trusted_member_since ?? null
      });
    }
  });

  friendships.forEach((friendship) => {
    const profileId = friendship.user_one_id === user.id ? friendship.user_two_id : friendship.user_one_id;
    const profile = profilesById.get(profileId);

    if (profile) {
      results.push({
        id: profileId,
        displayName: profile.full_name,
        username: profile.username,
        avatarUrl: profile.avatar_url,
        mutualFriends: mutualsById.get(profileId)?.count ?? 0,
        mutualAvatarUrls: mutualAvatarUrls(profileId),
        status: "friend",
        note: "Approved Muddy",
        plan: plans.get(profileId) ?? "free",
        trustedSince: profile.trusted_member_since ?? null
      });
    }
  });

  blocked.forEach((entry) => {
    const profile = profilesById.get(entry.blocked_id);

    if (profile) {
      results.push({
        id: profile.user_id,
        displayName: profile.full_name,
        username: profile.username,
        avatarUrl: profile.avatar_url,
        // Deliberately zero: blocking someone is a request to stop being shown
        // their world, and a mutual count is social-graph information.
        mutualFriends: 0,
        status: "blocked",
        note: "Blocked user",
        plan: plans.get(profile.user_id) ?? "free",
        trustedSince: profile.trusted_member_since ?? null,
        isVerifiedAccount: verifiedByUserId.get(profile.user_id) ?? false
      });
    }
  });

  return { users: results, circles, closeFriendIds, glowColorByFriendId };
}

async function loadCircles(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  userId: string
): Promise<InitialCircle[]> {
  const { data: circleRows } = await admin
    .from("friend_circles")
    .select("id, name, icon")
    .eq("user_id", userId)
    .is("archived_at", null)
    .order("created_at", { ascending: true });

  const circles = circleRows ?? [];
  if (circles.length === 0) return [];

  const { data: members } = await admin
    .from("circle_members")
    .select("circle_id, friend_id")
    .in(
      "circle_id",
      circles.map((circle) => circle.id)
    );

  const membersByCircle = new Map<string, string[]>();
  for (const member of members ?? []) {
    if (!membersByCircle.has(member.circle_id)) membersByCircle.set(member.circle_id, []);
    membersByCircle.get(member.circle_id)!.push(member.friend_id);
  }

  return circles.map((circle) => ({
    id: circle.id,
    name: circle.name,
    icon: circle.icon,
    memberIds: membersByCircle.get(circle.id) ?? []
  }));
}

async function loadCloseFriendIds(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  userId: string
): Promise<string[]> {
  const { data } = await admin
    .from("close_friend_relationships")
    .select("friend_id")
    .eq("owner_id", userId);
  return (data ?? []).map((row) => row.friend_id);
}
