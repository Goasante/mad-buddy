/**
 * Mutual Muddies: who you and another person both know.
 *
 * Split from the query deliberately, so the set logic is testable without a
 * database and so every surface that shows a mutual count computes it the same
 * way. Four places previously hardcoded `mutualFriends: 0` and rendered it as
 * fact — "0 mutual Muddies" is a claim, not a placeholder.
 */

export type FriendshipEdge = {
  user_one_id: string;
  user_two_id: string;
};

/**
 * The other side of each friendship edge for `userId`.
 *
 * Friendships are stored as an unordered pair, so a person can appear in
 * either column; this normalises both directions to "who is my friend".
 */
export function friendIdsFrom(userId: string, edges: readonly FriendshipEdge[]): Set<string> {
  const ids = new Set<string>();
  for (const edge of edges) {
    if (edge.user_one_id === userId) ids.add(edge.user_two_id);
    else if (edge.user_two_id === userId) ids.add(edge.user_one_id);
  }
  // A self-edge would otherwise make the viewer their own friend, which
  // inflates every mutual count that intersects this set by one.
  ids.delete(userId);
  return ids;
}

/**
 * The people BOTH the viewer and `otherId` are friends with.
 *
 * Returned in the order they appear in the viewer's own friend set, so a
 * stable ordering falls out without a second sort — and the same faces show up
 * each render rather than shuffling.
 *
 * The viewer and the other person are never counted as their own mutual, which
 * would otherwise happen whenever the two are already friends.
 */
export function mutualMuddyIds(
  viewerFriendIds: ReadonlySet<string>,
  otherId: string,
  otherFriendIds: ReadonlySet<string>
): string[] {
  const mutual: string[] = [];
  for (const id of viewerFriendIds) {
    if (id === otherId) continue;
    if (otherFriendIds.has(id)) mutual.push(id);
  }
  return mutual;
}

/** How many mutual faces a request row shows before falling back to the count. */
export const MUTUAL_AVATAR_LIMIT = 3;

export type MutualSummary = {
  /** The true total, which may exceed the number of faces shown. */
  count: number;
  /** Ids for the avatar stack, capped at MUTUAL_AVATAR_LIMIT. */
  previewIds: string[];
};

/**
 * Count plus a capped preview, in one pass.
 *
 * The count is always the real total: showing "3 mutual Muddies" because three
 * faces fit would under-report someone with twenty.
 */
export function summariseMutuals(
  viewerFriendIds: ReadonlySet<string>,
  otherId: string,
  otherFriendIds: ReadonlySet<string>,
  limit: number = MUTUAL_AVATAR_LIMIT
): MutualSummary {
  const mutual = mutualMuddyIds(viewerFriendIds, otherId, otherFriendIds);
  return { count: mutual.length, previewIds: mutual.slice(0, limit) };
}

/**
 * Mutual summaries for many people at once, from one batch of edges.
 *
 * `edgesByPerson` holds every friendship edge touching the people being
 * summarised — one query, not one per row. This is what keeps a Requests list
 * from becoming an N+1.
 */
export function summariseMutualsForMany(
  viewerId: string,
  viewerFriendIds: ReadonlySet<string>,
  otherIds: readonly string[],
  edges: readonly FriendshipEdge[],
  limit: number = MUTUAL_AVATAR_LIMIT
): Map<string, MutualSummary> {
  // Bucket every edge by the person it belongs to, so each person's friend set
  // is read once rather than rebuilt by scanning all edges per row.
  const friendsByPerson = new Map<string, Set<string>>();
  for (const id of otherIds) friendsByPerson.set(id, new Set());

  for (const edge of edges) {
    const one = friendsByPerson.get(edge.user_one_id);
    if (one) one.add(edge.user_two_id);
    const two = friendsByPerson.get(edge.user_two_id);
    if (two) two.add(edge.user_one_id);
  }

  const summaries = new Map<string, MutualSummary>();
  for (const id of otherIds) {
    const theirFriends = friendsByPerson.get(id) ?? new Set<string>();
    // The viewer is excluded: "you" is never your own mutual friend, and a
    // pending request's sender is frequently already connected to you through
    // someone the viewer set contains.
    theirFriends.delete(viewerId);
    summaries.set(id, summariseMutuals(viewerFriendIds, id, theirFriends, limit));
  }
  return summaries;
}
