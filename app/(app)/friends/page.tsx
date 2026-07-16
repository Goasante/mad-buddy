import { FriendsPageContent, type UserSummary } from "@/components/friends/friends-page";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export default async function FriendsPage() {
  const initialUsers = await loadFriendNetwork();

  return <FriendsPageContent initialUsers={initialUsers} />;
}

async function loadFriendNetwork(): Promise<UserSummary[]> {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) {
    return [];
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
      .or(`user_one_id.eq.${user.id},user_two_id.eq.${user.id}`),
    admin.from("blocked_users").select("blocked_id").eq("blocker_id", user.id)
  ]);

  const requests = requestsResult.data ?? [];
  const friendships = friendshipsResult.data ?? [];
  const blocked = blockedResult.data ?? [];
  const profileIds = new Set<string>();

  requests.forEach((request) => {
    profileIds.add(request.sender_id === user.id ? request.receiver_id : request.sender_id);
  });
  friendships.forEach((friendship) => {
    profileIds.add(friendship.user_one_id === user.id ? friendship.user_two_id : friendship.user_one_id);
  });
  blocked.forEach((entry) => profileIds.add(entry.blocked_id));

  if (profileIds.size === 0) {
    return [];
  }

  const { data: profiles } = await admin
    .from("profiles")
    .select("user_id, full_name, username")
    .in("user_id", [...profileIds]);
  const profilesById = new Map((profiles ?? []).map((profile) => [profile.user_id, profile]));
  const missingProfileIds = [...profileIds].filter((profileId) => !profilesById.has(profileId));

  await Promise.all(
    missingProfileIds.map(async (profileId) => {
      const { data } = await admin.auth.admin.getUserById(profileId);
      const metadata = data.user?.user_metadata;
      const metadataUsername = typeof metadata?.username === "string" ? metadata.username : null;
      const metadataName = typeof metadata?.full_name === "string" ? metadata.full_name : null;

      profilesById.set(profileId, {
        user_id: profileId,
        full_name: metadataName?.trim() || "Mad Buddy user",
        username: metadataUsername || `muddy_${profileId.slice(0, 8)}`
      });
    })
  );
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
        mutualFriends: 0,
        status: isReceived ? "received" : "sent",
        note: isReceived ? "Wants to connect with you" : "Waiting for a response"
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
        mutualFriends: 0,
        status: "friend",
        note: "Approved Muddy"
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
        mutualFriends: 0,
        status: "blocked",
        note: "Blocked user"
      });
    }
  });

  return results;
}
