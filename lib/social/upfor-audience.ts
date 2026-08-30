import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, HangoutAudienceType } from "@/lib/supabase/database.types";

type Admin = SupabaseClient<Database>;

/**
 * Who an UpFor is addressed to, derived entirely server-side.
 *
 * Moved out of the server action so the announcement WORKER can reach it: a
 * scheduled UpFor is announced when it starts, by a job, not by the request
 * that created it. Both callers therefore resolve the audience the same way.
 *
 * The caller never supplies a recipient list. Membership is re-derived from
 * friendships, close friends, owned circles and blocks every time, so a stale
 * or forged list cannot widen an audience -- and a Muddy who blocked the owner
 * between creation and start is excluded at send time rather than at create
 * time, which is the more correct moment.
 */
export async function resolveHangoutAudience(
  admin: Admin,
  ownerId: string,
  input: { audienceType: HangoutAudienceType; circleIds?: string[]; muddyIds?: string[] }
): Promise<string[]> {
  const { data: friendships } = await admin
    .from("friendships")
    .select("user_one_id, user_two_id")
    .or(`user_one_id.eq.${ownerId},user_two_id.eq.${ownerId}`)
    .is("ended_at", null);
  const friendIds = new Set(
    (friendships ?? []).map((row) => (row.user_one_id === ownerId ? row.user_two_id : row.user_one_id))
  );
  if (friendIds.size === 0) return [];

  const { data: blocks } = await admin
    .from("blocked_users")
    .select("blocker_id, blocked_id")
    .or(`blocker_id.eq.${ownerId},blocked_id.eq.${ownerId}`);
  const blocked = new Set((blocks ?? []).flatMap((row) => [row.blocker_id, row.blocked_id]));

  let candidates: string[] = [];
  switch (input.audienceType) {
    case "all_muddies":
      candidates = [...friendIds];
      break;
    case "close_friends": {
      const { data } = await admin.from("close_friend_relationships").select("friend_id").eq("owner_id", ownerId);
      candidates = (data ?? []).map((row) => row.friend_id);
      break;
    }
    case "selected_circles": {
      const circleIds = input.circleIds ?? [];
      if (circleIds.length === 0) break;
      // Only circles the host actually owns.
      const { data: owned } = await admin.from("friend_circles").select("id").eq("user_id", ownerId).in("id", circleIds);
      const ownedIds = (owned ?? []).map((row) => row.id);
      if (ownedIds.length === 0) break;
      const { data: members } = await admin.from("circle_members").select("friend_id").in("circle_id", ownedIds);
      candidates = (members ?? []).map((row) => row.friend_id);
      break;
    }
    case "selected_muddies":
      candidates = input.muddyIds ?? [];
      break;
  }

  return [...new Set(candidates)]
    .filter((id) => id !== ownerId && friendIds.has(id) && !blocked.has(id))
    .slice(0, 200);
}
