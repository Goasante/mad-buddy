"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { guardAction } from "@/lib/admin/enforcement";
import { assertWithinLimit, loadEffectivePlansForUsers } from "@/lib/billing/service";
import type {
  GroupDetailView,
  GroupInvitation,
  GroupInviteCandidate,
  GroupMemberView,
  GroupsPageData,
  GroupSummary
} from "@/lib/groups/types";
import { loadCommunicationPreferences } from "@/lib/messaging/service";
import { resolveRoleChange, type GroupRoleChange } from "@/lib/messaging/rules";
import { errorType, logBackendEvent } from "@/lib/observability/logger";
import { deliverNotification } from "@/lib/notifications/server";
import { consumeRateLimit, rateLimitMessage } from "@/lib/security/rate-limit";
import { signMediaForAsset } from "@/lib/content/service";
import { uploadValidationMessage, validateImageUpload } from "@/lib/media/validation";
import type { MediaContentType } from "@/lib/supabase/database.types";
import { areApprovedMuddies, isBlockedEitherDirection, isCloseFriend } from "@/lib/social/permissions";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getSupabaseServerEnv } from "@/lib/supabase/env";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { ConversationRole, GroupJoinMode, GroupVisibility, SubscriptionPlan } from "@/lib/supabase/database.types";

/**
 * Upload result. Deliberately NOT exported: a type export from a "use server"
 * file becomes a runtime ReferenceError under Turbopack, and tsc does not
 * catch it — only `next build` does.
 */
type GroupImageUploadState = {
  ok: boolean;
  message: string;
  mediaId?: string;
  previewUrl?: string | null;
};

type GroupActionState = {
  ok: boolean;
  message: string;
  groupId?: string;
};

const uuidSchema = z.string().uuid();
const createGroupSchema = z.object({
  name: z.string().trim().min(2).max(80),
  description: z.string().trim().max(500).optional(),
  /**
   * Who can FIND it, and separately whether they can join uninvited. Two
   * axes, not one: a public group may still be invite-only. Both default to
   * the closed answer, so an omitted field can never publish a group.
   */
  visibility: z.enum(["private", "public"]).default("private"),
  openToJoin: z.boolean().default(false),
  imageMediaId: z.string().uuid().optional()
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
        // Not surfaced here: these builders serve group DETAIL, where the
        // header renders its own image. The list projection signs URLs in one
        // batch; doing it per detail view would be a request nobody reads.
        imageUrl: null,
        memberCount: memberCountById.get(id) ?? 0,
        role: roleById.get(id) ?? null,
        joinMode: setting.join_mode,
        // Read defensively: the `visibility` column ships in a PENDING
        // migration, and selecting a column that does not exist yet fails
        // the WHOLE query — which silently emptied every group list.
        // Absent means private, matching the migration's own default.
        visibility: (setting as { visibility?: GroupVisibility }).visibility ?? "private",
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
      // Active friendships only: ended_at IS NULL is the canonical definition of "currently Muddies".
      .or(`user_one_id.eq.${userId},user_two_id.eq.${userId}`).is("ended_at", null),
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

  /**
   * Discoverable groups, from two independent sources:
   *
   *  1. PUBLIC groups — anyone signed in may see these exist. This is what
   *     makes discovery real: previously a user with no Muddies could never
   *     find a community at all.
   *  2. Link-joinable groups created by a Muddy — the original behaviour,
   *     kept so nothing a user could already discover disappears.
   *
   * Both are filtered through the same membership check, so a group the
   * viewer already belongs to never appears as something to join.
   */
  // Filters on a column from a PENDING migration, so it must fail soft: until
  // that migration is applied the filter errors, and discovery falls back to
  // the friend-link path rather than taking the whole page down with it.
  const { data: publicSettings } = await admin
    .from("group_settings")
    .select("conversation_id")
    .eq("visibility", "public")
    .limit(60)
    .then((result) => (result.error ? { data: [] } : result));

  const candidateIds = [
    ...new Set([...(publicSettings ?? []).map((row) => row.conversation_id), ...linkIds])
  ];

  let discoverableGroups: GroupSummary[] = [];
  if (candidateIds.length > 0) {
    const { data: discoverableConversations } = await admin
      .from("conversations")
      .select("id, created_by")
      .in("id", candidateIds)
      .eq("conversation_type", "group")
      .eq("status", "active");

    const publicIds = new Set((publicSettings ?? []).map((row) => row.conversation_id));
    const eligibleIds = (discoverableConversations ?? [])
      // A link-only group still requires the creator to be a Muddy; a public
      // group does not, which is the whole point of the visibility axis.
      .filter((row) => publicIds.has(row.id) || (row.created_by && friendIds.has(row.created_by)))
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
      // Two axes, set together at creation:
      //   visibility — who can SEE the group exists
      //   join_mode  — what happens when they try to join
      // "Discoverable" now means genuinely public, not merely
      // link-shareable to the creator's own Muddies.
      visibility: parsed.data.visibility,
      join_mode: parsed.data.openToJoin ? "link" : "invite",
      image_media_id: parsed.data.imageMediaId ?? null,
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
    admin
      .from("group_settings")
      .select("join_mode, history_visibility, visibility")
      .eq("conversation_id", groupId)
      .maybeSingle()
  ]);
  if (!conversation || conversation.status !== "active" || settings?.join_mode !== "link" || !conversation.created_by) {
    return { ok: false, message: "This group isn't open to join." };
  }

  /**
   * A PUBLIC group is joinable by anyone; a merely link-joinable one still
   * requires a connection to its creator.
   *
   * Requiring friendship for public groups made the Join button on every
   * public group fail — the group was listed precisely so strangers could
   * find it, then refused them on the grounds that they were strangers.
   *
   * Blocks still apply in both cases. Being publicly listed does not oblige
   * an owner to admit someone either of them has blocked.
   */
  const isPublic = (settings as { visibility?: string }).visibility === "public";
  const blocked = await isBlockedEitherDirection(admin, userId, conversation.created_by);
  if (blocked) return { ok: false, message: "This group isn't available." };
  if (!isPublic) {
    const approved = await areApprovedMuddies(admin, userId, conversation.created_by);
    if (!approved) return { ok: false, message: "This group isn't available." };
  }
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
  await publishGroupRoleEvent(admin, groupId, userId, "participant_left");
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

  const { data: memberRows } = await admin.from("conversation_members").select("user_id, role, status")
    .eq("conversation_id", groupId).eq("status", "joined").order("joined_at", { ascending: true });
  const memberIds = (memberRows ?? []).map((row) => row.user_id);
  // Stage 3B member projection: ONE profile query plus one batched plan
  // lookup for the whole list, never per member. Only fields a co-member is
  // already entitled to see — no email, phone, location or hidden fields.
  const { data: profiles } = memberIds.length
    ? await admin.from("profiles").select("user_id, full_name, username, avatar_url").in("user_id", memberIds)
    : { data: [] };
  const memberPlans = memberIds.length
    ? await loadEffectivePlansForUsers(admin, memberIds)
    : new Map<string, SubscriptionPlan>();
  const profileById = new Map((profiles ?? []).map((profile) => [profile.user_id, profile]));
  const members: GroupMemberView[] = (memberRows ?? []).map((row) => {
    const profile = profileById.get(row.user_id);
    return {
      userId: row.user_id,
      displayName: profile?.full_name?.trim() || "A Muddy",
      username: profile?.username || "muddy",
      avatarUrl: profile?.avatar_url ?? null,
      role: row.role,
      plan: memberPlans.get(row.user_id) ?? null,
      status: row.status
    };
  });

  const canManageMembers = myMembership.role === "owner" || myMembership.role === "admin";
  let inviteCandidates: GroupInviteCandidate[] = [];
  if (canManageMembers) {
    const [{ data: friendships }, { data: blocks }] = await Promise.all([
      // Active friendships only: ended_at IS NULL is the canonical definition of "currently Muddies".
      admin.from("friendships").select("user_one_id, user_two_id").or(`user_one_id.eq.${userId},user_two_id.eq.${userId}`).is("ended_at", null),
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
    // Not surfaced here: these builders serve group DETAIL, where the
    // header renders its own image. The list projection signs URLs in one
    // batch; doing it per detail view would be a request nobody reads.
    imageUrl: null,
    memberCount: members.length,
    role: myMembership.role,
    joinMode: settings.join_mode as GroupJoinMode,
    visibility: (settings as { visibility?: GroupVisibility }).visibility ?? "private",
    lastMessageAt: conversation.last_message_at,
    lastMessagePreview: lastMessage?.message_type === "voice_note" ? "Voice note" : lastMessage?.text_content ?? null,
    postingMode: settings.posting_mode,
    canManageMembers,
    viewerId: userId,
    members,
    inviteCandidates
  };
}

// ---------------------------------------------------------------------------
// Role management (Stage 3B)
// ---------------------------------------------------------------------------

const roleChangeSchema = z.object({
  groupId: z.string().uuid(),
  userId: z.string().uuid()
});

/**
 * One neutral failure message for every denied role change.
 *
 * Deliberately does not say WHICH invariant was hit. "You cannot demote the
 * owner" and "you are not an admin" together map out a group's authority
 * structure for someone probing it; the specific reason goes to the log, not
 * to the caller.
 */
const ROLE_CHANGE_DENIED = "You can't make that change to this group.";

/**
 * Load both sides of a role change in one round trip.
 *
 * The pair is what the decision depends on, so fetching them separately would
 * open a window where the actor is read as owner and the target as something
 * they no longer are.
 */
async function loadRolePair(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  groupId: string,
  actorId: string,
  targetId: string
) {
  const { data } = await admin
    .from("conversation_members")
    .select("user_id, role, status")
    .eq("conversation_id", groupId)
    .in("user_id", [actorId, targetId]);
  const actor = (data ?? []).find((row) => row.user_id === actorId) ?? null;
  const target = (data ?? []).find((row) => row.user_id === targetId) ?? null;
  return { actor, target };
}

/** Record a factual role change on the existing append-only event store. */
async function recordRoleEvent(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  eventType: "admin.promoted" | "admin.demoted" | "ownership.transferred" | "member.removed",
  groupId: string,
  actorId: string,
  targetId: string
) {
  // Compensating, like every other event here: the role change has already
  // committed, so a failed audit write must never undo it.
  const { error } = await admin.from("domain_events").insert({
    event_type: eventType,
    resource_type: "group",
    resource_id: groupId,
    actor_id: actorId,
    // Ids only, never names and never a reason: who did what to whom, where.
    payload: { targetUserId: targetId } as never,
    occurred_at: new Date().toISOString()
  });
  if (error) {
    logBackendEvent("warn", { route: "groups/role", errorType: errorType(error) });
  }
}

/**
 * Apply a role change once the pure rules have authorised it.
 *
 * The role/status guards in the WHERE clause are what make this safe under
 * concurrency: if the target left, was removed, or had their role changed
 * between the decision and the write, zero rows update and the caller is told
 * nothing changed rather than a departed member being resurrected with a new
 * role.
 */
async function applyRoleChange(change: GroupRoleChange, input: unknown): Promise<GroupActionState> {
  const parsed = roleChangeSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: ROLE_CHANGE_DENIED };
  const actorId = await getAuthedUserId();
  if (!actorId) return { ok: false, message: "Log in first." };

  const admin = createSupabaseAdminClient();
  const { groupId, userId: targetId } = parsed.data;
  const { actor, target } = await loadRolePair(admin, groupId, actorId, targetId);

  const decision = resolveRoleChange(change, {
    actorRole: actor?.role ?? null,
    actorStatus: actor?.status ?? null,
    targetRole: target?.role ?? null,
    targetStatus: target?.status ?? null,
    selfTargeted: actorId === targetId
  });

  if (!decision.allowed) {
    logBackendEvent("info", { route: "groups/role", statusCode: 403 });
    return { ok: false, message: ROLE_CHANGE_DENIED };
  }
  // Idempotent: the target already holds the requested role, so there is
  // nothing to write and nothing to record.
  if (decision.reason === "already_in_role") {
    return { ok: true, message: "No change needed." };
  }

  const now = new Date().toISOString();
  const patch =
    change === "remove_member"
      ? { status: "removed" as const, left_at: now, updated_at: now }
      : { role: change === "promote_to_admin" ? ("admin" as const) : ("member" as const), updated_at: now };

  const { data: updated, error } = await admin
    .from("conversation_members")
    .update(patch)
    .eq("conversation_id", groupId)
    .eq("user_id", targetId)
    // Re-assert what the decision was made against, so a concurrent change
    // loses rather than being silently overwritten.
    .eq("status", "joined")
    .eq("role", target?.role ?? "member")
    .select("user_id");

  if (error || !updated?.length) return { ok: false, message: ROLE_CHANGE_DENIED };

  await recordRoleEvent(
    admin,
    change === "promote_to_admin"
      ? "admin.promoted"
      : change === "demote_to_member"
        ? "admin.demoted"
        : "member.removed",
    groupId,
    actorId,
    targetId
  );

  // The in-thread projection of the same fact. Emitted only AFTER the write is
  // confirmed above, so a failed role change can never leave a system message
  // claiming it happened. Names the person it happened TO, never who did it.
  const SYSTEM_EVENT_FOR_CHANGE = {
    promote_to_admin: "member_promoted",
    demote_to_member: "member_demoted",
    remove_member: "participant_removed"
  } as const;
  await publishGroupRoleEvent(
    admin,
    groupId,
    targetId,
    SYSTEM_EVENT_FOR_CHANGE[change as keyof typeof SYSTEM_EVENT_FOR_CHANGE]
  );

  revalidatePath(`/groups/${groupId}`);
  return { ok: true, message: "Group updated." };
}

/**
 * Post the in-thread system message for a confirmed group role change.
 *
 * Reuses the canonical `publishSystemMessage` — this is a projection of a fact
 * already recorded in `domain_events`, not a second event stream.
 *
 * The dedupe key is derived from the event itself (group, person, kind), so a
 * retried action posts nothing new. It deliberately does NOT include a
 * timestamp: two identical facts seconds apart are the same fact.
 */
async function publishGroupRoleEvent(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  groupId: string,
  targetId: string,
  event: "member_promoted" | "member_demoted" | "participant_removed" | "ownership_transferred" | "participant_left"
) {
  const { data: profile } = await admin
    .from("profiles")
    .select("full_name")
    .eq("user_id", targetId)
    .maybeSingle();
  const { publishSystemMessage } = await import("@/lib/messaging/service");
  // Display name only — never a username, an id, or anything the group cannot
  // already see in the member list.
  await publishSystemMessage(
    admin,
    groupId,
    event,
    profile?.full_name?.trim() || "A Muddy",
    `${event}:${targetId}`
  );
}

export async function promoteGroupAdminAction(input: unknown): Promise<GroupActionState> {
  return applyRoleChange("promote_to_admin", input);
}

export async function demoteGroupAdminAction(input: unknown): Promise<GroupActionState> {
  return applyRoleChange("demote_to_member", input);
}

export async function removeGroupMemberAction(input: unknown): Promise<GroupActionState> {
  return applyRoleChange("remove_member", input);
}

/**
 * Hand ownership to another joined member.
 *
 * Runs through the `transfer_group_ownership` RPC rather than two updates from
 * here: the outgoing and incoming owner rows must change together, and a
 * partial failure would leave the group ownerless or with two owners. The RPC
 * takes the row lock, so concurrent transfers serialise and the second finds
 * the caller is no longer owner.
 *
 * Executed under the CALLER's RLS client, so `auth.uid()` inside the function
 * is the real actor and cannot be spoofed through a parameter.
 */
export async function transferGroupOwnershipAction(input: unknown): Promise<GroupActionState> {
  const parsed = roleChangeSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: ROLE_CHANGE_DENIED };
  const actorId = await getAuthedUserId();
  if (!actorId) return { ok: false, message: "Log in first." };

  const admin = createSupabaseAdminClient();
  const { groupId, userId: targetId } = parsed.data;
  const { actor, target } = await loadRolePair(admin, groupId, actorId, targetId);

  // Checked here so an unauthorised attempt is refused before it reaches the
  // database. The RPC re-checks regardless — this is the fast path, not the
  // guarantee.
  const decision = resolveRoleChange("transfer_ownership", {
    actorRole: actor?.role ?? null,
    actorStatus: actor?.status ?? null,
    targetRole: target?.role ?? null,
    targetStatus: target?.status ?? null,
    selfTargeted: actorId === targetId
  });
  if (!decision.allowed) {
    logBackendEvent("info", { route: "groups/role", statusCode: 403 });
    return { ok: false, message: ROLE_CHANGE_DENIED };
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("transfer_group_ownership", {
    p_conversation_id: groupId,
    p_new_owner_id: targetId
  });
  if (error) return { ok: false, message: ROLE_CHANGE_DENIED };

  await recordRoleEvent(admin, "ownership.transferred", groupId, actorId, targetId);
  await publishGroupRoleEvent(admin, groupId, targetId, "ownership_transferred");
  revalidatePath(`/groups/${groupId}`);
  return { ok: true, message: "Ownership transferred." };
}

const visibilitySchema = z.object({
  groupId: uuidSchema,
  visibility: z.enum(["private", "public"])
});

/**
 * Change who can SEE a group exists.
 *
 * OWNER ONLY, deliberately. Admins manage people and content; making a group
 * publicly listable is a decision about every member's exposure, and the one
 * person accountable for the group should be the one who makes it.
 *
 * Separate from join_mode, which is left untouched: a public group may still
 * be invite-only, and collapsing the two would silently make every
 * discoverable group openly joinable.
 */
export async function setGroupVisibilityAction(input: unknown): Promise<GroupActionState> {
  if (!serverReady()) return { ok: false, message: "Groups need the server database configuration." };
  const parsed = visibilitySchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "That change isn't available." };
  const userId = await getAuthedUserId();
  if (!userId) return { ok: false, message: "Log in first." };

  const admin = createSupabaseAdminClient();
  const { data: membership } = await admin
    .from("conversation_members")
    .select("role, status")
    .eq("conversation_id", parsed.data.groupId)
    .eq("user_id", userId)
    .maybeSingle();

  // Neutral on failure: never confirm whether a group exists to someone who
  // is not its owner.
  if (membership?.status !== "joined" || membership.role !== "owner") {
    return { ok: false, message: "That change isn't available." };
  }

  const { error } = await admin
    .from("group_settings")
    .update({ visibility: parsed.data.visibility, updated_at: new Date().toISOString() })
    .eq("conversation_id", parsed.data.groupId);
  if (error) return { ok: false, message: "Couldn't update that group." };

  revalidatePath(`/groups/${parsed.data.groupId}`);
  revalidatePath("/groups");
  revalidatePath("/discover");
  return {
    ok: true,
    message: parsed.data.visibility === "public" ? "Group is now public." : "Group is now private."
  };
}


/**
 * Upload a group image.
 *
 * Follows the messaging attachment pipeline exactly — magic-byte validation,
 * a pending asset row, EXIF stripping and variant generation before any bytes
 * reach storage, then a single finalise. Copying that shape rather than
 * writing a new one keeps group images inside the same moderation, retention
 * and deletion machinery every other upload already lives in.
 *
 * Returns a media id. The caller attaches it when creating or updating the
 * group, so an abandoned upload leaves an orphan asset the retention sweep
 * collects rather than a half-created group.
 *
 * EXIF matters more here than almost anywhere: a group photo is often taken
 * at the place the group meets, and GPS tags in it would leak a location the
 * product otherwise never exposes. `processImageUpload` strips it before the
 * file is stored, not after.
 */
export async function uploadGroupImageAction(formData: FormData): Promise<GroupImageUploadState> {
  if (!serverReady()) {
    return { ok: false, message: "This action needs the server database configuration." };
  }

  const userId = await getAuthedUserId();
  if (!userId) return { ok: false, message: "Log in before uploading." };

  const rateLimit = await consumeRateLimit({ action: "media.upload", userId });
  if (!rateLimit.allowed) return { ok: false, message: rateLimitMessage(rateLimit.resetAt) };

  const admin = createSupabaseAdminClient();

  // Kill switch and account restrictions, before any bytes are read.
  const guard = await guardAction(admin, { userId, surface: "messaging", control: "media_uploads" });
  if (!guard.allowed) return { ok: false, message: guard.message };

  const file = formData.get("media");
  if (!(file instanceof File)) return { ok: false, message: "Choose a photo first." };

  // Magic bytes, never the filename or the claimed MIME type alone.
  const headerBytes = new Uint8Array(await file.slice(0, 32).arrayBuffer());
  const validation = validateImageUpload({
    claimedMimeType: file.type,
    headerBytes,
    sizeBytes: file.size,
    context: "group"
  });
  if (!validation.valid) {
    return { ok: false, message: uploadValidationMessage(validation.reason) };
  }

  const { data: asset, error: assetError } = await admin
    .from("media_assets")
    .insert({
      owner_id: userId,
      // Placeholder; replaced with the real key once the id exists.
      storage_key: `pending/${userId}/${Date.now()}`,
      content_type: validation.mimeType as MediaContentType,
      size_bytes: file.size,
      context_type: "group",
      processing_status: "pending"
    })
    .select("id")
    .single();
  if (assetError || !asset) return { ok: false, message: "Couldn't prepare the upload." };

  const { storageKeyFor } = await import("@/lib/media/validation");
  const key = storageKeyFor({ ownerId: userId, context: "group", mediaId: asset.id, kind: validation.kind });
  const removeFailedUpload = async (paths: string[] = []) => {
    if (paths.length > 0) await admin.storage.from("media").remove(paths);
    await admin.from("media_assets").delete().eq("id", asset.id).eq("owner_id", userId);
  };

  let processed;
  try {
    const { processImageUpload } = await import("@/lib/media/processing");
    processed = await processImageUpload(Buffer.from(await file.arrayBuffer()), validation.kind);
  } catch {
    await removeFailedUpload();
    return { ok: false, message: "That image couldn't be processed. Try a different photo." };
  }

  const { toStorageArrayBuffer, variantStorageKey } = await import("@/lib/media/processing");
  const { error: uploadError } = await admin.storage
    .from("media")
    .upload(key, toStorageArrayBuffer(processed.original.buffer), {
      contentType: validation.mimeType,
      upsert: false
    });
  if (uploadError) {
    await removeFailedUpload();
    return { ok: false, message: "Couldn't upload that photo. Try again." };
  }

  // Variants are best-effort: signing falls back to the (already stripped)
  // original when one is missing.
  const variantRows = [
    { variant: "thumb" as const, key: variantStorageKey(key, "thumb"), image: processed.variants.thumb },
    { variant: "feed" as const, key: variantStorageKey(key, "feed"), image: processed.variants.feed }
  ];
  await Promise.all(
    variantRows.map(async ({ variant, key: variantKey, image }) => {
      const { error } = await admin.storage.from("media").upload(variantKey, toStorageArrayBuffer(image.buffer), {
        contentType: validation.mimeType,
        upsert: false
      });
      if (error) return;
      await admin.from("media_variants").insert({
        media_asset_id: asset.id,
        variant_type: variant,
        storage_key: variantKey,
        width: image.width,
        height: image.height,
        size_bytes: image.buffer.byteLength
      });
    })
  );

  const { error: readyError } = await admin
    .from("media_assets")
    .update({
      storage_key: key,
      processing_status: "ready",
      width: processed.original.width,
      height: processed.original.height,
      size_bytes: processed.original.buffer.byteLength,
      updated_at: new Date().toISOString()
    })
    .eq("id", asset.id)
    .eq("owner_id", userId);
  if (readyError) {
    await removeFailedUpload([key, ...variantRows.map((row) => row.key)]);
    return { ok: false, message: "Couldn't finish processing that photo. Try again." };
  }

  const previewUrl = await signMediaForAsset(admin, asset.id, "thumb");
  return { ok: true, message: "Image ready.", mediaId: asset.id, previewUrl };
}
