export type PendingFriendRequest = {
  id: string;
  sender_id: string;
  receiver_id: string;
  created_at: string;
};

export type FriendshipPair = {
  user_one_id: string;
  user_two_id: string;
};

/**
 * A friendship or block is authoritative over an old pending request. This
 * defensive read filter keeps stale rows from resurfacing while the database
 * migration repairs historical data.
 */
export function actionableFriendRequests(
  viewerId: string,
  requests: PendingFriendRequest[],
  friendships: FriendshipPair[],
  blockedUserIds: ReadonlySet<string>
): PendingFriendRequest[] {
  const friendIds = new Set(
    friendships.map((friendship) =>
      friendship.user_one_id === viewerId ? friendship.user_two_id : friendship.user_one_id
    )
  );

  return requests.filter((request) => {
    const otherId = request.sender_id === viewerId ? request.receiver_id : request.sender_id;
    return !friendIds.has(otherId) && !blockedUserIds.has(otherId);
  });
}
