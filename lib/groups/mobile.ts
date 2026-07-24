import "server-only";

import { z } from "zod";
import { guardAction } from "@/lib/admin/enforcement";
import { assertWithinLimit } from "@/lib/billing/service";
import type { GroupInvitation, GroupsPageData, GroupSummary } from "@/lib/groups/types";
import { consumeRateLimit, rateLimitMessage } from "@/lib/security/rate-limit";
import { areApprovedMuddies, isBlockedEitherDirection } from "@/lib/social/permissions";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getSupabaseServerEnv } from "@/lib/supabase/env";
import type { ConversationRole } from "@/lib/supabase/database.types";

/**
 * Mobile Groups v1: list (my groups + discoverable + invitations), create, and
 * join. Isolated from the web group-actions.ts (which owns invite/respond/leave/
 * detail) so the tested web feature is untouched; the read/create/join logic is
 * duplicated here rather than sharing group-actions' private helpers. Types come
 * from lib/groups/types (shared with web).
 */

type Admin = ReturnType<typeof createSupabaseAdminClient>;

export type GroupResult = { ok: boolean; message: string; groupId?: string };

export const createGroupSchema = z.object({
  name: z.string().trim().min(2).max(80),
  description: z.string().trim().max(500).optional(),
  discoverable: z.boolean().default(false)
});

const uuidSchema = z.string().uuid();

function serverReady(): boolean {
  const env = getSupabaseServerEnv();
  return Boolean(env.url && env.serviceRoleKey);
}

function emptyGroupsData(): GroupsPageData {
  return { groups: [], discoverableGroups: [], invitations: [] };
}

async function groupCapacityAvailable(admin: Admin, groupId: string, ownerId: string, requestedMembers = 1) {
  const { count } = await admin
    .from("conversation_members")
    .select("id", { count: "exact", head: true })
    .eq("conversation_id", groupId)
    .in("status", ["joined", "invited"]);
  return assertWithinLimit(admin, ownerId, "max_group_members", count ?? 0, requestedMembers);
}

async function ownedGroupCount(admin: Admin, userId: string) {
  const { data: memberships } = await admin
    .from("conversation_members")
    .select("conversation_id")
    .eq("user_id", userId)
    .eq("role", "owner")
    .eq("status", "joined");
  const ids = (memberships ?? []).map((row) => row.conversation_id);
  if (ids.length === 0) return 0;
  const { count } = await admin
    .from("conversations")
    .select("id", { count: "exact", head: true })
    .in("id", ids)
    .eq("conversation_type", "group")
    .neq("status", "deleted");
  return count ?? 0;
}

async function summariesFor(
  admin: Admin,
  ids: string[],
  roleById = new Map<string, ConversationRole | null>()
): Promise<GroupSummary[]> {
  if (ids.length === 0) return [];
  const uniqueIds = [...new Set(ids)];
  const [{ data: conversations }, { data: settings }, { data: members }, { data: messages }] = await Promise.all([
    admin
      .from("conversations")
      .select("id, last_message_at")
      .in("id", uniqueIds)
      .eq("conversation_type", "group")
      .eq("status", "active"),
    admin
      .from("group_settings")
      .select("conversation_id, name, description, join_mode")
      .in("conversation_id", uniqueIds),
    admin
      .from("conversation_members")
      .select("conversation_id")
      .in("conversation_id", uniqueIds)
      .eq("status", "joined"),
    admin
      .from("messages")
      .select("conversation_id, text_content, message_type, created_at")
      .in("conversation_id", uniqueIds)
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(250)
  ]);

  const conversationById = new Map((conversations ?? []).map((row) => [row.id, row]));
  const settingsById = new Map((settings ?? []).map((row) => [row.conversation_id, row]));
  const memberCountById = new Map<string, number>();
  for (const member of members ?? []) {
    memberCountById.set(member.conversation_id, (memberCountById.get(member.conversation_id) ?? 0) + 1);
  }
  const lastMessageById = new Map<string, { text_content: string | null; message_type: string }>();
  for (const message of messages ?? []) {
    if (!lastMessageById.has(message.conversation_id)) lastMessageById.set(message.conversation_id, message);
  }

  return uniqueIds
    .flatMap((id) => {
      const conversation = conversationById.get(id);
      const setting = settingsById.get(id);
      if (!conversation || !setting) return [];
      const lastMessage = lastMessageById.get(id);
      return [
        {
          id,
          name: setting.name,
          description: setting.description,
          memberCount: memberCountById.get(id) ?? 0,
          role: roleById.get(id) ?? null,
          joinMode: setting.join_mode,
          lastMessageAt: conversation.last_message_at,
          lastMessagePreview: lastMessage
            ? lastMessage.message_type === "voice_note"
              ? "Voice note"
              : lastMessage.text_content
            : null
        } satisfies GroupSummary
      ];
    })
    .sort((a, b) => (b.lastMessageAt ?? "").localeCompare(a.lastMessageAt ?? "") || a.name.localeCompare(b.name));
}

export async function listGroupsPageData(userId: string): Promise<GroupsPageData> {
  if (!serverReady()) return emptyGroupsData();
  const admin = createSupabaseAdminClient();

  const { data: memberships } = await admin
    .from("conversation_members")
    .select("conversation_id, role, status")
    .eq("user_id", userId);
  const roleById = new Map((memberships ?? []).map((row) => [row.conversation_id, row.role]));
  const joinedIds = (memberships ?? []).filter((row) => row.status === "joined").map((row) => row.conversation_id);
  const invitedIds = (memberships ?? []).filter((row) => row.status === "invited").map((row) => row.conversation_id);

  const [groups, invitationSummaries, friendshipsResult, linkSettingsResult] = await Promise.all([
    summariesFor(admin, joinedIds, roleById),
    summariesFor(admin, invitedIds, roleById),
    admin
      .from("friendships")
      .select("user_one_id, user_two_id")
      .or(`user_one_id.eq.${userId},user_two_id.eq.${userId}`),
    admin.from("group_settings").select("conversation_id").eq("join_mode", "link")
  ]);

  const invitations: GroupInvitation[] = [];
  if (invitationSummaries.length > 0) {
    const { data: invitationConversations } = await admin
      .from("conversations")
      .select("id, created_by")
      .in(
        "id",
        invitationSummaries.map((group) => group.id)
      );
    const creatorIds = [
      ...new Set((invitationConversations ?? []).map((row) => row.created_by).filter(Boolean))
    ] as string[];
    const { data: creators } = creatorIds.length
      ? await admin.from("profiles").select("user_id, full_name").in("user_id", creatorIds)
      : { data: [] };
    const creatorNameById = new Map((creators ?? []).map((row) => [row.user_id, row.full_name]));
    const creatorByGroupId = new Map((invitationConversations ?? []).map((row) => [row.id, row.created_by]));
    for (const group of invitationSummaries) {
      const creatorId = creatorByGroupId.get(group.id);
      invitations.push({
        ...group,
        invitedByName: creatorId ? creatorNameById.get(creatorId)?.trim() || "A Muddy" : "A Muddy"
      });
    }
  }

  const friendIds = new Set(
    (friendshipsResult.data ?? []).map((row) => (row.user_one_id === userId ? row.user_two_id : row.user_one_id))
  );
  const knownMembership = new Map((memberships ?? []).map((row) => [row.conversation_id, row.status]));
  const linkIds = (linkSettingsResult.data ?? []).map((row) => row.conversation_id);
  let discoverableGroups: GroupSummary[] = [];
  if (linkIds.length > 0 && friendIds.size > 0) {
    const { data: discoverableConversations } = await admin
      .from("conversations")
      .select("id, created_by")
      .in("id", linkIds)
      .eq("conversation_type", "group")
      .eq("status", "active");
    const eligibleIds = (discoverableConversations ?? [])
      .filter((row) => row.created_by && friendIds.has(row.created_by))
      .filter((row) => !knownMembership.has(row.id) || knownMembership.get(row.id) === "left")
      .map((row) => row.id);
    discoverableGroups = await summariesFor(admin, eligibleIds);
  }

  return { groups, discoverableGroups, invitations };
}

export async function createGroup(userId: string, input: unknown): Promise<GroupResult> {
  if (!serverReady()) return { ok: false, message: "Groups need the server database configuration." };
  const parsed = createGroupSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Use a group name between 2 and 80 characters." };
  const rateLimit = await consumeRateLimit({ action: "groups.create", userId });
  if (!rateLimit.allowed) return { ok: false, message: rateLimitMessage(rateLimit.resetAt) };

  const admin = createSupabaseAdminClient();
  const guard = await guardAction(admin, { userId, surface: "messaging", control: "messaging" });
  if (!guard.allowed) return { ok: false, message: guard.message };
  const count = await ownedGroupCount(admin, userId);
  const limit = await assertWithinLimit(admin, userId, "max_private_groups", count, 1);
  if (!limit.allowed) return { ok: false, message: `You can create up to ${limit.limit} groups on your current plan.` };

  const { data: conversation, error: conversationError } = await admin
    .from("conversations")
    .insert({ conversation_type: "group", created_by: userId, status: "active" })
    .select("id")
    .single();
  if (conversationError || !conversation) return { ok: false, message: "Couldn't create that group." };

  const now = new Date().toISOString();
  const [settingsResult, memberResult] = await Promise.all([
    admin.from("group_settings").insert({
      conversation_id: conversation.id,
      name: parsed.data.name,
      description: parsed.data.description || null,
      join_mode: parsed.data.discoverable ? "link" : "invite",
      history_visibility: "since_join",
      posting_mode: "all_members"
    }),
    admin.from("conversation_members").insert({
      conversation_id: conversation.id,
      user_id: userId,
      role: "owner",
      status: "joined",
      joined_at: now,
      history_visible_from: now
    })
  ]);
  if (settingsResult.error || memberResult.error) {
    await admin.from("conversations").delete().eq("id", conversation.id);
    return { ok: false, message: "Couldn't finish creating that group." };
  }

  {
    const { grantAchievement } = await import("@/lib/engagement/achievements");
    await grantAchievement(admin, userId, "group_founder");
  }
  return { ok: true, message: "Group created.", groupId: conversation.id };
}

export async function joinDiscoverableGroup(userId: string, groupId: string): Promise<GroupResult> {
  if (!uuidSchema.safeParse(groupId).success) return { ok: false, message: "Group not found." };
  const admin = createSupabaseAdminClient();
  const [{ data: conversation }, { data: settings }] = await Promise.all([
    admin
      .from("conversations")
      .select("id, created_by, status")
      .eq("id", groupId)
      .eq("conversation_type", "group")
      .maybeSingle(),
    admin.from("group_settings").select("join_mode, history_visibility").eq("conversation_id", groupId).maybeSingle()
  ]);
  if (!conversation || conversation.status !== "active" || settings?.join_mode !== "link" || !conversation.created_by) {
    return { ok: false, message: "This group isn't open to join." };
  }
  const [approved, blocked] = await Promise.all([
    areApprovedMuddies(admin, userId, conversation.created_by),
    isBlockedEitherDirection(admin, userId, conversation.created_by)
  ]);
  if (!approved || blocked) return { ok: false, message: "This group isn't available." };
  const capacity = await groupCapacityAvailable(admin, groupId, conversation.created_by);
  if (!capacity.allowed) return { ok: false, message: "This group is full." };
  const now = new Date().toISOString();
  const { error } = await admin.from("conversation_members").upsert(
    {
      conversation_id: groupId,
      user_id: userId,
      role: "member",
      status: "joined",
      joined_at: now,
      left_at: null,
      history_visible_from: settings.history_visibility === "full" ? new Date(0).toISOString() : now
    },
    { onConflict: "conversation_id,user_id" }
  );
  if (error) return { ok: false, message: "Couldn't join that group." };
  {
    const { grantAchievement } = await import("@/lib/engagement/achievements");
    await grantAchievement(admin, userId, "group_member");
  }
  return { ok: true, message: "Joined group.", groupId };
}
