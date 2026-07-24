"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { guardAction } from "@/lib/admin/enforcement";
import { assertWithinLimit } from "@/lib/billing/service";
import type {
  GroupDetailView,
  GroupInvitation,
  GroupInviteCandidate,
  GroupMemberView,
  GroupsPageData,
  GroupSummary
} from "@/lib/groups/types";
import { loadCommunicationPreferences } from "@/lib/messaging/service";
import { deliverNotification } from "@/lib/notifications/server";
import { consumeRateLimit, rateLimitMessage } from "@/lib/security/rate-limit";
import { areApprovedMuddies, isBlockedEitherDirection, isCloseFriend } from "@/lib/social/permissions";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getSupabaseServerEnv } from "@/lib/supabase/env";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { ConversationRole, GroupJoinMode } from "@/lib/supabase/database.types";

type GroupActionState = {
  ok: boolean;
  message: string;
  groupId?: string;
};

const uuidSchema = z.string().uuid();
const createGroupSchema = z.object({
  name: z.string().trim().min(2).max(80),
  description: z.string().trim().max(500).optional(),
  discoverable: z.boolean().default(false)
});
const invitationSchema = z.object({ groupId: uuidSchema, userId: uuidSchema });
const invitationResponseSchema = z.object({ groupId: uuidSchema, accept: z.boolean() });

function emptyGroupsData(): GroupsPageData {
  return { groups: [], discoverableGroups: [], invitations: [] };
}

async function getAuthedUserId() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
    error
  } = await supabase.auth.getUser();
  return error || !user ? null : user.id;
}

function serverReady() {
  const env = getSupabaseServerEnv();
  return Boolean(env.url && env.serviceRoleKey);
}

async function groupCapacityAvailable(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  groupId: string,
  ownerId: string,
  requestedMembers = 1
) {
  const { count } = await admin
    .from("conversation_members")
    .select("id", { count: "exact", head: true })
    .eq("conversation_id", groupId)
    .in("status", ["joined", "invited"]);
  return assertWithinLimit(admin, ownerId, "max_group_members", count ?? 0, requestedMembers);
}

async function ownedGroupCount(admin: ReturnType<typeof createSupabaseAdminClient>, userId: string) {
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
  admin: ReturnType<typeof createSupabaseAdminClient>,
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
      return [{
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
      } satisfies GroupSummary];
    })
    .sort((a, b) => (b.lastMessageAt ?? "").localeCompare(a.lastMessageAt ?? "") || a.name.localeCompare(b.name));
}

export async function loadGroupsPageDataAction(): Promise<GroupsPageData> {
  if (!serverReady()) return emptyGroupsData();
  const userId = await getAuthedUserId();
  if (!userId) return emptyGroupsData();
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
      .in("id", invitationSummaries.map((group) => group.id));
    const creatorIds = [...new Set((invitationConversations ?? []).map((row) => row.created_by).filter(Boolean))] as string[];
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
    (friendshipsResult.data ?? []).map((row) => row.user_one_id === userId ? row.user_two_id : row.user_one_id)
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

export async function createGroupAction(input: unknown): Promise<GroupActionState> {
  if (!serverReady()) return { ok: false, message: "Groups need the server database configuration." };
  const parsed = createGroupSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Use a group name between 2 and 80 characters." };
  const userId = await getAuthedUserId();
  if (!userId) return { ok: false, message: "Log in before creating a group." };
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
  revalidatePath("/groups");
  return { ok: true, message: "Group created.", groupId: conversation.id };
}

export async function joinDiscoverableGroupAction(groupId: string): Promise<GroupActionState> {
  if (!uuidSchema.safeParse(groupId).success) return { ok: false, message: "Group not found." };
  const userId = await getAuthedUserId();
  if (!userId) return { ok: false, message: "Log in before joining a group." };
  const admin = createSupabaseAdminClient();
  const [{ data: conversation }, { data: settings }] = await Promise.all([
    admin.from("conversations").select("id, created_by, status").eq("id", groupId).eq("conversation_type", "group").maybeSingle(),
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
  const { error } = await admin.from("conversation_members").upsert({
    conversation_id: groupId,
    user_id: userId,
    role: "member",
    status: "joined",
    joined_at: now,
    left_at: null,
    history_visible_from: settings.history_visibility === "full" ? new Date(0).toISOString() : now
  }, { onConflict: "conversation_id,user_id" });
  if (error) return { ok: false, message: "Couldn't join that group." };
  {
    const { grantAchievement } = await import("@/lib/engagement/achievements");
    await grantAchievement(admin, userId, "group_member");
  }
  revalidatePath("/groups");
  return { ok: true, message: "Joined group.", groupId };
}

export async function respondToGroupInvitationAction(input: unknown): Promise<GroupActionState> {
  const parsed = invitationResponseSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Group invitation not found." };
  const userId = await getAuthedUserId();
  if (!userId) return { ok: false, message: "Log in before responding." };
  const rateLimit = await consumeRateLimit({ action: "invites.resolve", userId });
  if (!rateLimit.allowed) return { ok: false, message: rateLimitMessage(rateLimit.resetAt) };
  const admin = createSupabaseAdminClient();
  const { data: membership } = await admin
    .from("conversation_members")
    .select("status")
    .eq("conversation_id", parsed.data.groupId)
    .eq("user_id", userId)
    .maybeSingle();
  if (membership?.status !== "invited") return { ok: false, message: "This invitation is no longer available." };

  if (!parsed.data.accept) {
    await admin.from("conversation_members").update({ status: "left", left_at: new Date().toISOString() })
      .eq("conversation_id", parsed.data.groupId).eq("user_id", userId);
    revalidatePath("/groups");
    return { ok: true, message: "Invitation declined." };
  }

  const [{ data: conversation }, { data: settings }] = await Promise.all([
    admin.from("conversations").select("created_by, status").eq("id", parsed.data.groupId).maybeSingle(),
    admin.from("group_settings").select("history_visibility").eq("conversation_id", parsed.data.groupId).maybeSingle()
  ]);
  if (!conversation?.created_by || conversation.status !== "active") return { ok: false, message: "This group is no longer available." };
  // Invited members already occupy a reserved group seat.
  const capacity = await groupCapacityAvailable(admin, parsed.data.groupId, conversation.created_by, 0);
  if (!capacity.allowed) return { ok: false, message: "This group is full." };
  const now = new Date().toISOString();
  const { error } = await admin.from("conversation_members").update({
    status: "joined",
    joined_at: now,
    left_at: null,
    history_visible_from: settings?.history_visibility === "full" ? new Date(0).toISOString() : now
  }).eq("conversation_id", parsed.data.groupId).eq("user_id", userId);
  if (error) return { ok: false, message: "Couldn't accept that invitation." };
  {
    const { grantAchievement } = await import("@/lib/engagement/achievements");
    await grantAchievement(admin, userId, "group_member");
  }
  revalidatePath("/groups");
  return { ok: true, message: "Group joined.", groupId: parsed.data.groupId };
}

export async function inviteGroupMemberAction(input: unknown): Promise<GroupActionState> {
  const parsed = invitationSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Choose an approved Muddy." };
  const userId = await getAuthedUserId();
  if (!userId) return { ok: false, message: "Log in before inviting someone." };
  const rateLimit = await consumeRateLimit({ action: "invites.create", userId });
  if (!rateLimit.allowed) return { ok: false, message: rateLimitMessage(rateLimit.resetAt) };
  const admin = createSupabaseAdminClient();
  const [{ data: myMembership }, { data: conversation }, { data: settings }] = await Promise.all([
    admin.from("conversation_members").select("role, status").eq("conversation_id", parsed.data.groupId).eq("user_id", userId).maybeSingle(),
    admin.from("conversations").select("created_by, status").eq("id", parsed.data.groupId).eq("conversation_type", "group").maybeSingle(),
    admin.from("group_settings").select("name").eq("conversation_id", parsed.data.groupId).maybeSingle()
  ]);
  if (myMembership?.status !== "joined" || !["owner", "admin"].includes(myMembership.role)) {
    return { ok: false, message: "Only group owners and admins can invite people." };
  }
  if (!conversation?.created_by || conversation.status !== "active") return { ok: false, message: "This group isn't available." };
  const [approved, blocked, recipientPrefs] = await Promise.all([
    areApprovedMuddies(admin, userId, parsed.data.userId),
    isBlockedEitherDirection(admin, userId, parsed.data.userId),
    loadCommunicationPreferences(admin, parsed.data.userId)
  ]);
  if (!approved || blocked || recipientPrefs.groupAddPermission === "nobody") {
    return { ok: false, message: "This Muddy can't be invited right now." };
  }
  if (recipientPrefs.groupAddPermission === "close_friends") {
    const close = await isCloseFriend(admin, parsed.data.userId, userId);
    if (!close) return { ok: false, message: "This Muddy only accepts group invites from Close Friends." };
  }
  const { data: existing } = await admin.from("conversation_members").select("status")
    .eq("conversation_id", parsed.data.groupId).eq("user_id", parsed.data.userId).maybeSingle();
  if (existing?.status === "joined") return { ok: true, message: "This Muddy is already in the group." };
  if (existing?.status === "invited") return { ok: true, message: "Invitation already sent." };
  if (existing?.status === "banned") return { ok: false, message: "This Muddy can't be invited." };
  const capacity = await groupCapacityAvailable(admin, parsed.data.groupId, conversation.created_by);
  if (!capacity.allowed) return { ok: false, message: "This group is full." };
  const now = new Date().toISOString();
  const { error } = await admin.from("conversation_members").upsert({
    conversation_id: parsed.data.groupId,
    user_id: parsed.data.userId,
    role: "member",
    status: "invited",
    joined_at: now,
    left_at: null,
    history_visible_from: now
  }, { onConflict: "conversation_id,user_id" });
  if (error) return { ok: false, message: "Couldn't send that group invitation." };
  const { data: inviter } = await admin.from("profiles").select("full_name").eq("user_id", userId).maybeSingle();
  await deliverNotification(admin, {
    userId: parsed.data.userId,
    senderId: userId,
    priority: "high",
    type: `group:${parsed.data.groupId}`,
    title: "Group invitation",
    message: `${inviter?.full_name?.trim() || "A Muddy"} invited you to ${settings?.name || "a group"}.`
  });
  revalidatePath(`/groups/${parsed.data.groupId}`);
  return { ok: true, message: "Group invitation sent." };
}

export async function leaveGroupAction(groupId: string): Promise<GroupActionState> {
  if (!uuidSchema.safeParse(groupId).success) return { ok: false, message: "Group not found." };
  const userId = await getAuthedUserId();
  if (!userId) return { ok: false, message: "Log in first." };
  const admin = createSupabaseAdminClient();
  const { data: membership } = await admin.from("conversation_members").select("role, status")
    .eq("conversation_id", groupId).eq("user_id", userId).maybeSingle();
  if (membership?.status !== "joined") return { ok: false, message: "You're not in this group." };
  if (membership.role === "owner") return { ok: false, message: "Transfer ownership before leaving this group." };
  const { error } = await admin.from("conversation_members").update({ status: "left", left_at: new Date().toISOString() })
    .eq("conversation_id", groupId).eq("user_id", userId);
  if (error) return { ok: false, message: "Couldn't leave that group." };
  revalidatePath("/groups");
  return { ok: true, message: "You left the group." };
}

export async function loadGroupDetailAction(groupId: string): Promise<GroupDetailView | null> {
  if (!serverReady() || !uuidSchema.safeParse(groupId).success) return null;
  const userId = await getAuthedUserId();
  if (!userId) return null;
  const admin = createSupabaseAdminClient();
  const [{ data: conversation }, { data: settings }, { data: myMembership }] = await Promise.all([
    admin.from("conversations").select("id, created_by, status, last_message_at").eq("id", groupId).eq("conversation_type", "group").maybeSingle(),
    admin.from("group_settings").select("name, description, join_mode, posting_mode").eq("conversation_id", groupId).maybeSingle(),
    admin.from("conversation_members").select("role, status").eq("conversation_id", groupId).eq("user_id", userId).maybeSingle()
  ]);
  if (!conversation || conversation.status !== "active" || !settings || myMembership?.status !== "joined") return null;

  const { data: memberRows } = await admin.from("conversation_members").select("user_id, role")
    .eq("conversation_id", groupId).eq("status", "joined").order("joined_at", { ascending: true });
  const memberIds = (memberRows ?? []).map((row) => row.user_id);
  const { data: profiles } = memberIds.length
    ? await admin.from("profiles").select("user_id, full_name, username, avatar_url").in("user_id", memberIds)
    : { data: [] };
  const profileById = new Map((profiles ?? []).map((profile) => [profile.user_id, profile]));
  const members: GroupMemberView[] = (memberRows ?? []).map((row) => {
    const profile = profileById.get(row.user_id);
    return {
      userId: row.user_id,
      displayName: profile?.full_name?.trim() || "A Muddy",
      username: profile?.username || "muddy",
      avatarUrl: profile?.avatar_url ?? null,
      role: row.role
    };
  });

  const canManageMembers = myMembership.role === "owner" || myMembership.role === "admin";
  let inviteCandidates: GroupInviteCandidate[] = [];
  if (canManageMembers) {
    const [{ data: friendships }, { data: blocks }] = await Promise.all([
      admin.from("friendships").select("user_one_id, user_two_id").or(`user_one_id.eq.${userId},user_two_id.eq.${userId}`),
      admin.from("blocked_users").select("blocker_id, blocked_id").or(`blocker_id.eq.${userId},blocked_id.eq.${userId}`)
    ]);
    const blockedIds = new Set((blocks ?? []).flatMap((row) => [row.blocker_id, row.blocked_id]).filter((id) => id !== userId));
    const existingIds = new Set(memberIds);
    const candidateIds = (friendships ?? [])
      .map((row) => row.user_one_id === userId ? row.user_two_id : row.user_one_id)
      .filter((id) => !blockedIds.has(id) && !existingIds.has(id));
    if (candidateIds.length > 0) {
      const { data: candidates } = await admin.from("profiles").select("user_id, full_name, username, avatar_url").in("user_id", candidateIds);
      inviteCandidates = (candidates ?? []).map((profile) => ({
        userId: profile.user_id,
        displayName: profile.full_name?.trim() || "A Muddy",
        username: profile.username,
        avatarUrl: profile.avatar_url
      })).sort((a, b) => a.displayName.localeCompare(b.displayName));
    }
  }

  const { data: lastMessage } = await admin.from("messages").select("text_content, message_type")
    .eq("conversation_id", groupId).is("deleted_at", null).order("created_at", { ascending: false }).limit(1).maybeSingle();
  return {
    id: groupId,
    name: settings.name,
    description: settings.description,
    memberCount: members.length,
    role: myMembership.role,
    joinMode: settings.join_mode as GroupJoinMode,
    lastMessageAt: conversation.last_message_at,
    lastMessagePreview: lastMessage?.message_type === "voice_note" ? "Voice note" : lastMessage?.text_content ?? null,
    postingMode: settings.posting_mode,
    canManageMembers,
    members,
    inviteCandidates
  };
}
