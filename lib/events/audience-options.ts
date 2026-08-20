import "server-only";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";

/**
 * The things a creator can point an audience at.
 *
 * Deliberately NOT a global user search: a private Event must not become a way
 * to enumerate arbitrary accounts. Invitees come from approved Muddy
 * relationships, and communities from Circles the creator has actually joined.
 */

export type InviteeOption = { userId: string; name: string; avatarUrl: string | null };
export type CommunityOption = { conversationId: string; name: string; memberCount: number };

/**
 * Approved Muddies, minus anyone on either side of a block.
 *
 * Three queries for the whole list rather than one per person: friendships,
 * blocks, then the profiles that survived both.
 */
export async function listInviteeOptions(userId: string): Promise<InviteeOption[]> {
  const admin = createSupabaseAdminClient();

  const { data: friendships } = await admin
    .from("friendships")
    .select("user_one_id, user_two_id")
    .or(`user_one_id.eq.${userId},user_two_id.eq.${userId}`)
    .is("ended_at", null);
  const muddyIds = [
    ...new Set(
      (friendships ?? []).map((row) => (row.user_one_id === userId ? row.user_two_id : row.user_one_id))
    )
  ];
  if (muddyIds.length === 0) return [];

  const { data: blocks } = await admin
    .from("blocked_users")
    .select("blocker_id, blocked_id")
    .or(`blocker_id.eq.${userId},blocked_id.eq.${userId}`);
  const blocked = new Set(
    (blocks ?? []).map((row) => (row.blocker_id === userId ? row.blocked_id : row.blocker_id))
  );

  const eligible = muddyIds.filter((id) => !blocked.has(id));
  if (eligible.length === 0) return [];

  const { data: profiles } = await admin
    .from("profiles")
    .select("user_id, full_name, avatar_url")
    .in("user_id", eligible);

  return (profiles ?? [])
    .map((row) => ({
      userId: row.user_id,
      name: row.full_name?.trim() || "A Muddy",
      avatarUrl: row.avatar_url
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Circles the creator has actually joined.
 *
 * A Circle is a group conversation, so membership is conversation_members and
 * only `joined` counts -- an unaccepted invitation is not a community you can
 * publish to.
 */
export async function listCommunityOptions(userId: string): Promise<CommunityOption[]> {
  const admin = createSupabaseAdminClient();

  const { data: memberships } = await admin
    .from("conversation_members")
    .select("conversation_id")
    .eq("user_id", userId)
    .eq("status", "joined");
  const conversationIds = [...new Set((memberships ?? []).map((row) => row.conversation_id))];
  if (conversationIds.length === 0) return [];

  // Only group conversations are communities. A direct chat and a Plan chat are
  // also rows in this table, and neither is something to publish an Event to.
  const { data: conversations } = await admin
    .from("conversations")
    .select("id")
    .eq("conversation_type", "group")
    .in("id", conversationIds);
  const groupIds = (conversations ?? []).map((row) => row.id);
  if (groupIds.length === 0) return [];

  const [{ data: settings }, { data: members }] = await Promise.all([
    admin.from("group_settings").select("conversation_id, name").in("conversation_id", groupIds),
    admin.from("conversation_members").select("conversation_id").eq("status", "joined").in("conversation_id", groupIds)
  ]);

  const counts = new Map<string, number>();
  for (const row of members ?? []) {
    counts.set(row.conversation_id, (counts.get(row.conversation_id) ?? 0) + 1);
  }

  return (settings ?? [])
    .map((row) => ({
      conversationId: row.conversation_id,
      name: row.name?.trim() || "A Circle",
      memberCount: counts.get(row.conversation_id) ?? 0
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}
