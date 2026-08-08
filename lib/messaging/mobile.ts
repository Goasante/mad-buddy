import "server-only";

import { z } from "zod";
import { loadEffectivePlansForUsers } from "@/lib/billing/service";
import { senderVisibleState, validateMessageText, type UserFacingMessageState } from "@/lib/messaging/rules";
import type { AttachmentView } from "@/lib/messaging/attachments";
import {
  canSendMessage,
  getOrCreateDirectConversation,
  loadCommunicationPreferences,
  resolveConversationAccess
} from "@/lib/messaging/service";
import { guardAction } from "@/lib/admin/enforcement";
import { deliverNotification } from "@/lib/notifications/server";
import { consumeRateLimit, rateLimitMessage } from "@/lib/security/rate-limit";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getSupabaseServerEnv } from "@/lib/supabase/env";
import type { ConversationRole, QuickActionType, SubscriptionPlan } from "@/lib/supabase/database.types";

/**
 * Transport-agnostic messaging read/send logic. Takes an already-authenticated
 * `userId`; shared by the web Server Actions (thin wrappers in
 * app/(app)/messaging-actions.ts) and the mobile /api/messages/* routes. Only
 * the v1 subset (open, send, list conversations/messages, messageable friends,
 * mark read) lives here; edit/delete/react/mute stay web-only for now.
 */

type Admin = ReturnType<typeof createSupabaseAdminClient>;

export type MessagingResult = {
  ok: boolean;
  message: string;
  conversationId?: string;
  messageId?: string;
};

export type ChatMessageView = {
  id: string;
  /** Stable user id — internal only. Never rendered. */
  senderId: string | null;
  senderName: string;
  /**
   * Authorised identity fields, resolved once per page of messages.
   *
   * Deliberately narrow: name, avatar, username and membership tier are what a
   * co-member already sees anywhere else in the product. No email, no phone,
   * no location, no hidden profile fields — those are never selected.
   */
  senderAvatarUrl: string | null;
  senderUsername: string | null;
  senderPlan: SubscriptionPlan | null;
  /**
   * Trusted Member approval, or null.
   *
   * A THIRD signal, kept separate from senderPlan and senderRole: premium is
   * a plan, Owner/Admin is authority in this group, and this is standing
   * across the product. Merging any two would make one imply the others.
   */
  senderTrustedSince: string | null;
  /** Deleted, deactivated or otherwise unavailable — never says which. */
  senderUnavailable: boolean;
  /** Group role, for the subtle Owner/Admin indicator. Null in direct chats. */
  senderRole: ConversationRole | null;
  /**
   * Image attachment with short-lived signed URLs. Never a storage path, and
   * never a permanent public URL.
   */
  attachment: AttachmentView | null;
  isMine: boolean;
  messageType: string;
  text: string | null;
  quickActionType: string | null;
  createdAt: string;
  editedAt: string | null;
  deleted: boolean;
  state: UserFacingMessageState;
  myReaction: string | null;
};

export type ConversationView = {
  id: string;
  title: string;
  avatarUrl: string | null;
  otherUsername: string | null;
  kind: string;
  lastMessagePreview: string | null;
  lastMessageAt: string | null;
  unreadCount: number;
  muted: boolean;
  pinned: boolean;
  contextBadge: string | null;
  otherPlan: SubscriptionPlan | null;
  /**
   * The other person's Trusted Member approval, or null. Direct chats only —
   * a group has no single "other person", and its senders carry their own.
   */
  otherTrustedSince: string | null;
};

export type MessageableFriend = {
  friendId: string;
  displayName: string;
  username: string;
  avatarUrl: string | null;
  plan: SubscriptionPlan;
};

const uuidSchema = z.string().uuid();

export const sendMessageSchema = z.object({
  conversationId: uuidSchema,
  text: z.string().optional(),
  quickActionType: z
    .enum(["on_my_way", "im_here", "running_late", "where_to_meet", "cant_make_it", "start_without_me"])
    .optional(),
  replyToMessageId: uuidSchema.optional(),
  /**
   * Canonical image attachment. Optional, so every existing caller is
   * unchanged; present, so every conversation type gains attachments at once
   * rather than each surface growing its own send path.
   */
  mediaId: uuidSchema.optional(),
  clientMessageId: z.string().min(1).max(64)
});

function serviceRoleEnvMessage(): string | null {
  const env = getSupabaseServerEnv();
  if (!env.url || !env.serviceRoleKey) {
    return "This action needs the server database configuration.";
  }
  return null;
}

function hasServiceRoleEnv(): boolean {
  const env = getSupabaseServerEnv();
  return Boolean(env.url && env.serviceRoleKey);
}

function eligibilityMessage(reason: string): string {
  switch (reason) {
    case "blocked":
    case "not_muddies":
      // Deliberately identical: never disclose that you were blocked.
      return "You can't message this person.";
    case "recipient_accepts_nobody":
    case "not_close_friend":
    case "not_in_circle":
      return "They're not accepting messages right now.";
    case "suspended":
      return "This account isn't available.";
    default:
      return "You can't message this person.";
  }
}

export async function openDirectConversation(userId: string, recipientId: string): Promise<MessagingResult> {
  const envMessage = serviceRoleEnvMessage();
  if (envMessage) return { ok: false, message: envMessage };
  if (!uuidSchema.safeParse(recipientId).success) return { ok: false, message: "Muddy not found." };

  const rateLimit = await consumeRateLimit({ action: "conversations.create", userId });
  if (!rateLimit.allowed) return { ok: false, message: rateLimitMessage(rateLimit.resetAt) };

  const admin = createSupabaseAdminClient();
  const result = await getOrCreateDirectConversation(admin, userId, recipientId);
  if (!result.conversationId) {
    return { ok: false, message: eligibilityMessage(result.error ?? "") };
  }
  return { ok: true, message: "Conversation ready.", conversationId: result.conversationId };
}

export async function sendMessage(userId: string, input: unknown): Promise<MessagingResult> {
  const envMessage = serviceRoleEnvMessage();
  if (envMessage) return { ok: false, message: envMessage };

  const parsed = sendMessageSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Check your message and try again." };

  const isQuickAction = Boolean(parsed.data.quickActionType);
  const hasAttachment = Boolean(parsed.data.mediaId);
  // A photo with no caption is a complete message, so the text requirement is
  // relaxed when an attachment carries the content. A caption that IS present
  // is still validated.
  if (!isQuickAction && !hasAttachment) {
    const textError = validateMessageText(parsed.data.text ?? "");
    if (textError) return { ok: false, message: textError };
  } else if (!isQuickAction && (parsed.data.text ?? "").trim().length > 0) {
    const textError = validateMessageText(parsed.data.text ?? "");
    if (textError) return { ok: false, message: textError };
  }

  const rateLimit = await consumeRateLimit({ action: "messages.send", userId });
  if (!rateLimit.allowed) return { ok: false, message: rateLimitMessage(rateLimit.resetAt) };

  const admin = createSupabaseAdminClient();

  const guard = await guardAction(admin, { userId, surface: "messaging", control: "messaging" });
  if (!guard.allowed) return { ok: false, message: guard.message };

  const permission = await canSendMessage(admin, userId, parsed.data.conversationId);
  if (!permission.allowed) {
    return {
      ok: false,
      message:
        permission.reason === "posting_restricted"
          ? "Only admins can post here."
          : permission.reason === "conversation_closed"
            ? "This conversation is closed."
            : eligibilityMessage(permission.reason)
    };
  }

  // The asset must belong to the sender and be a ready chat image. Checked
  // AFTER conversation permission, so an unauthorised sender never learns
  // whether a media id exists.
  if (parsed.data.mediaId) {
    const { canAttachMedia } = await import("@/lib/messaging/attachments");
    const allowed = await canAttachMedia(
      admin,
      userId,
      parsed.data.conversationId,
      parsed.data.mediaId
    );
    if (!allowed) return { ok: false, message: "That photo isn't available to send." };
  }

  const { data: message, error } = await admin
    .from("messages")
    .insert({
      conversation_id: parsed.data.conversationId,
      sender_id: userId,
      message_type: isQuickAction ? "quick_action" : hasAttachment ? "image" : "text",
      media_id: parsed.data.mediaId ?? null,
      text_content: parsed.data.text?.trim() || null,
      quick_action_type: (parsed.data.quickActionType ?? null) as QuickActionType | null,
      reply_to_message_id: parsed.data.replyToMessageId ?? null,
      client_message_id: parsed.data.clientMessageId,
      status: "sent"
    })
    .select("id")
    .single();

  // A duplicate send collides on (sender_id, client_message_id), return the
  // existing message rather than erroring or double-posting.
  if (error || !message) {
    const { data: existing } = await admin
      .from("messages")
      .select("id")
      .eq("sender_id", userId)
      .eq("client_message_id", parsed.data.clientMessageId)
      .maybeSingle();
    if (existing) return { ok: true, message: "Sent.", messageId: existing.id };
    return { ok: false, message: "Couldn't send that message." };
  }

  await admin
    .from("conversations")
    .update({ last_message_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq("id", parsed.data.conversationId);

  await notifyOtherMembers(admin, parsed.data.conversationId, userId, parsed.data.text ?? "");
  return { ok: true, message: "Sent.", messageId: message.id };
}

/** Notifies members, honoring each recipient's preview privacy. */
async function notifyOtherMembers(admin: Admin, conversationId: string, senderId: string, text: string) {
  const nowIso = new Date().toISOString();
  const [{ data: members }, { data: conversation }] = await Promise.all([
    admin
      .from("conversation_members")
      .select("user_id, muted_until")
      .eq("conversation_id", conversationId)
      .eq("status", "joined")
      .neq("user_id", senderId),
    // The conversation type decides where the notification LANDS. A group
    // message routed as `message:` opened the direct-message inbox instead of
    // the group thread — the notification arrived, and the tap went to the
    // wrong screen.
    admin
      .from("conversations")
      .select("conversation_type")
      .eq("id", conversationId)
      .maybeSingle()
  ]);
  const isGroup = conversation?.conversation_type === "group";
  // Group name, so the notification reads "Ama · Weekend Crew" rather than
  // leaving the recipient to guess which group it came from.
  const { data: groupSettings } = isGroup
    ? await admin.from("group_settings").select("name").eq("conversation_id", conversationId).maybeSingle()
    : { data: null };

  const recipients = (members ?? []).filter((member) => !member.muted_until || member.muted_until < nowIso);
  if (recipients.length === 0) return;

  const { data: senderProfile } = await admin
    .from("profiles")
    .select("full_name")
    .eq("user_id", senderId)
    .maybeSingle();
  const senderName = senderProfile?.full_name?.trim() || "A Muddy";

  await Promise.all(
    recipients.map(async (member) => {
      const prefs = await loadCommunicationPreferences(admin, member.user_id);
      const { buildNotificationPreview } = await import("@/lib/messaging/rules");
      const preview = buildNotificationPreview({
        mode: prefs.notificationPreview,
        senderName,
        messageText: text
      });
      if (!preview) return;
      await deliverNotification(admin, {
        userId: member.user_id,
        senderId,
        priority: "high",
        // `group:<id>` resolves to /groups/<id> — the exact thread. The
        // resolver already supported this; nothing was emitting it.
        type: isGroup ? `group:${conversationId}` : `message:${conversationId}`,
        // The group name is context, never content: it is appended to the
        // TITLE, so a recipient whose preview preference hides message text
        // still sees who and where, and never what.
        title: isGroup && groupSettings?.name ? `${preview.title} · ${groupSettings.name}` : preview.title,
        message: preview.body
      });
    })
  );
}

export async function listMessageableFriends(userId: string): Promise<MessageableFriend[]> {
  if (!hasServiceRoleEnv()) return [];

  const admin = createSupabaseAdminClient();
  const [{ data: friendships }, { data: blocks }] = await Promise.all([
    admin
      .from("friendships")
      .select("user_one_id, user_two_id")
      // Active friendships only: ended_at IS NULL is the canonical definition of "currently Muddies".
      .or(`user_one_id.eq.${userId},user_two_id.eq.${userId}`).is("ended_at", null),
    admin
      .from("blocked_users")
      .select("blocker_id, blocked_id")
      .or(`blocker_id.eq.${userId},blocked_id.eq.${userId}`)
  ]);

  const blockedIds = new Set(
    (blocks ?? []).flatMap((row) => [row.blocker_id, row.blocked_id]).filter((id) => id !== userId)
  );
  const friendIds = (friendships ?? [])
    .map((row) => (row.user_one_id === userId ? row.user_two_id : row.user_one_id))
    .filter((id) => !blockedIds.has(id));
  if (friendIds.length === 0) return [];

  const [{ data: profiles }, plans] = await Promise.all([
    admin
      .from("profiles")
      .select("user_id, full_name, username, avatar_url")
      .in("user_id", friendIds),
    loadEffectivePlansForUsers(admin, friendIds)
  ]);

  return (profiles ?? [])
    .map((profile) => ({
      friendId: profile.user_id,
      displayName: profile.full_name,
      username: profile.username,
      avatarUrl: profile.avatar_url,
      plan: plans.get(profile.user_id) ?? "free"
    }))
    .sort((a, b) => a.displayName.localeCompare(b.displayName));
}

export async function listConversations(userId: string): Promise<ConversationView[]> {
  if (!hasServiceRoleEnv()) return [];

  const admin = createSupabaseAdminClient();
  const { data: memberships } = await admin
    .from("conversation_members")
    .select("conversation_id, muted_until, last_read_message_id")
    .eq("user_id", userId)
    .eq("status", "joined");

  const conversationIds = (memberships ?? []).map((row) => row.conversation_id);
  if (conversationIds.length === 0) return [];

  const { data: conversations } = await admin
    .from("conversations")
    .select("id, conversation_type, context_type, direct_key, last_message_at, status")
    .in("id", conversationIds)
    .neq("status", "deleted")
    .order("last_message_at", { ascending: false, nullsFirst: false });

  const membershipById = new Map((memberships ?? []).map((row) => [row.conversation_id, row]));

  // Batched, not per-conversation: one .in() for direct-chat other-user
  // profiles, one .in() for group/plan/event conversation names, one RPC for
  // every conversation's last message + unread count in a single round trip
  // (see conversation_previews in supabase/migrations). Previously this loop
  // issued up to 4 sequential queries PER conversation.
  const directConversations = (conversations ?? []).filter(
    (conversation) => conversation.conversation_type === "direct" && conversation.direct_key
  );
  const otherIdByConversation = new Map<string, string>();
  for (const conversation of directConversations) {
    const otherId = conversation.direct_key!.split(":").find((id) => id !== userId);
    if (otherId) otherIdByConversation.set(conversation.id, otherId);
  }
  const otherIds = [...new Set(otherIdByConversation.values())];
  const groupConversationIds = (conversations ?? [])
    .filter((conversation) => conversation.conversation_type !== "direct")
    .map((conversation) => conversation.id);

  const [{ data: pins }, { data: otherProfiles }, { data: groupSettings }, { data: previews }, plans] = await Promise.all([
    admin.from("conversation_pins").select("conversation_id").eq("user_id", userId).in("conversation_id", conversationIds),
    otherIds.length > 0
      ? admin.from("profiles").select("user_id, full_name, username, avatar_url, trusted_member_since").in("user_id", otherIds)
      : Promise.resolve({ data: [] }),
    groupConversationIds.length > 0
      ? admin.from("group_settings").select("conversation_id, name").in("conversation_id", groupConversationIds)
      : Promise.resolve({ data: [] }),
    admin.rpc("conversation_previews", { p_user_id: userId, p_conversation_ids: conversationIds }),
    loadEffectivePlansForUsers(admin, otherIds)
  ]);

  const pinnedIds = new Set((pins ?? []).map((row) => row.conversation_id));
  const profileByUserId = new Map((otherProfiles ?? []).map((profile) => [profile.user_id, profile]));
  const groupNameByConversation = new Map((groupSettings ?? []).map((row) => [row.conversation_id, row.name]));
  const previewByConversation = new Map((previews ?? []).map((row) => [row.conversation_id, row]));
  const nowIso = new Date().toISOString();
  const views: ConversationView[] = [];

  for (const conversation of conversations ?? []) {
    let title = "Conversation";
    let otherUsername: string | null = null;
    let avatarUrl: string | null = null;
    if (conversation.conversation_type === "direct" && conversation.direct_key) {
      const otherId = otherIdByConversation.get(conversation.id);
      const profile = otherId ? profileByUserId.get(otherId) : undefined;
      title = profile?.full_name?.trim() || "A Muddy";
      otherUsername = profile?.username ?? null;
      avatarUrl = profile?.avatar_url ?? null;
    } else {
      title =
        groupNameByConversation.get(conversation.id) ??
        (conversation.conversation_type === "plan" ? "Plan chat" : "Group");
    }

    const membership = membershipById.get(conversation.id);
    const preview = previewByConversation.get(conversation.id);

    views.push({
      id: conversation.id,
      title,
      avatarUrl,
      otherUsername,
      kind: conversation.conversation_type,
      lastMessagePreview:
        preview?.last_message_type === "voice_note" ? "Voice note" : preview?.last_text ?? null,
      lastMessageAt: conversation.last_message_at,
      unreadCount: preview?.unread_count ?? 0,
      muted: Boolean(membership?.muted_until && membership.muted_until > nowIso),
      pinned: pinnedIds.has(conversation.id),
      contextBadge:
        conversation.context_type === "plan"
          ? "Plan"
          : conversation.context_type === "event" || conversation.context_type === "event_circle"
            ? "Event"
            : conversation.context_type === "safe_arrival"
              ? "Safe Arrival"
              : null,
      otherPlan:
        conversation.conversation_type === "direct"
          ? plans.get(otherIdByConversation.get(conversation.id) ?? "") ?? "free"
          : null,
      otherTrustedSince:
        conversation.conversation_type === "direct"
          ? profileByUserId.get(otherIdByConversation.get(conversation.id) ?? "")?.trusted_member_since ?? null
          : null
    });
  }

  return views;
}

export async function listMessages(userId: string, conversationId: string): Promise<ChatMessageView[]> {
  if (!hasServiceRoleEnv()) return [];
  if (!uuidSchema.safeParse(conversationId).success) return [];

  const admin = createSupabaseAdminClient();
  const access = await resolveConversationAccess(admin, userId, conversationId);
  if (!access.canView) return []; // Never serve a guessed conversation id.

  // Descending + limit, then reverse: this window must be the most RECENT
  // 200 messages. Ascending + limit was returning the oldest 200 after the
  // visibility cutoff instead — once an active conversation passed 200
  // total messages, every message sent after that point silently stopped
  // appearing here, forever, because the same oldest slice kept winning.
  const { data: messages } = await admin
    .from("messages")
    .select("id, sender_id, message_type, text_content, quick_action_type, media_id, status, created_at, edited_at, deleted_at")
    .eq("conversation_id", conversationId)
    .gte("created_at", access.historyVisibleFrom ?? new Date(0).toISOString())
    .order("created_at", { ascending: false })
    .limit(200);

  const rows = (messages ?? []).reverse();
  if (rows.length === 0) return [];

  const [{ data: hides }, { data: reactions }] = await Promise.all([
    admin.from("message_hides").select("message_id").eq("user_id", userId),
    admin.from("message_reactions").select("message_id, reaction_type").eq("user_id", userId)
  ]);
  const hiddenIds = new Set((hides ?? []).map((row) => row.message_id));
  const myReactions = new Map((reactions ?? []).map((row) => [row.message_id, row.reaction_type]));

  /**
   * The authorised sender projection.
   *
   * ONE query for every distinct sender in the page, plus one batched plan
   * lookup — never per message, and never per render. A group thread of 200
   * messages from 8 people costs two queries, not 200.
   *
   * Only fields a co-member is already entitled to see are selected:
   * display name, avatar, username. Email, phone, location and every other
   * profile column are not read here at all, so they cannot leak into a
   * message list by accident.
   */
  const senderIds = [...new Set(rows.map((row) => row.sender_id).filter((id): id is string => Boolean(id)))];
  const senderById = new Map<
    string,
    { name: string; avatarUrl: string | null; username: string | null; trustedSince: string | null }
  >();
  let plansBySender = new Map<string, SubscriptionPlan>();
  // Group role per sender, for the subtle Owner/Admin indicator. Batched with
  // the profile read, so it costs one more query per PAGE, never per message.
  const roleBySender = new Map<string, ConversationRole>();
  if (senderIds.length > 0) {
    const [{ data: profiles }, plans, { data: roleRows }] = await Promise.all([
      admin
        .from("profiles")
        .select("user_id, full_name, avatar_url, username, trusted_member_since")
        .in("user_id", senderIds),
      loadEffectivePlansForUsers(admin, senderIds),
      admin
        .from("conversation_members")
        .select("user_id, role")
        .eq("conversation_id", conversationId)
        .in("user_id", senderIds)
    ]);
    for (const row of roleRows ?? []) roleBySender.set(row.user_id, row.role);
    for (const profile of profiles ?? []) {
      senderById.set(profile.user_id, {
        name: profile.full_name?.trim() || "A Muddy",
        avatarUrl: profile.avatar_url ?? null,
        username: profile.username ?? null,
        trustedSince: profile.trusted_member_since ?? null
      });
    }
    plansBySender = plans;
  }

  // Attachments, signed ONCE for the whole page and deduped by media id.
  // Signing per message (or worse, per render) would mint dozens of storage
  // URLs for one thread and change their identity on every pass, defeating
  // browser caching entirely.
  const { signAttachmentsForMessages } = await import("@/lib/messaging/attachments");
  const attachmentsById = await signAttachmentsForMessages(
    admin,
    userId,
    conversationId,
    rows.map((row) => row.id)
  );

  const myPrefs = await loadCommunicationPreferences(admin, userId);

  return rows
    .filter((row) => !hiddenIds.has(row.id))
    .map((row) => ({
      id: row.id,
      senderId: row.sender_id,
      senderName: row.sender_id === userId ? "You" : senderById.get(row.sender_id ?? "")?.name ?? "Mad Buddy",
      senderAvatarUrl: row.sender_id ? senderById.get(row.sender_id)?.avatarUrl ?? null : null,
      senderUsername: row.sender_id ? senderById.get(row.sender_id)?.username ?? null : null,
      senderPlan: row.sender_id ? plansBySender.get(row.sender_id) ?? null : null,
      senderTrustedSince: row.sender_id ? senderById.get(row.sender_id)?.trustedSince ?? null : null,
      /**
       * ONE fallback for every "we cannot show this person" case.
       *
       * A sender id with no profile row means deleted, deactivated,
       * moderated, or otherwise unavailable — and this deliberately does not
       * distinguish between them. Telling the viewer which one it was would
       * leak exactly what the privacy rules exist to withhold: whether they
       * were blocked, whether the account was actioned, whether membership
       * was revoked. Absence is the whole message.
       */
      senderUnavailable: Boolean(row.sender_id) && !senderById.has(row.sender_id!),
      /**
       * Owner/Admin only. "Member" is deliberately absent: labelling the
       * ordinary case on every message is noise, and the indicator only earns
       * its place when it says something the reader would not assume.
       */
      senderRole: row.sender_id ? roleBySender.get(row.sender_id) ?? null : null,
      // Null for a deleted message, so a tombstone never renders its photo.
      attachment: row.deleted_at ? null : attachmentsById.get(row.media_id ?? "") ?? null,
      isMine: row.sender_id === userId,
      messageType: row.message_type,
      text: row.deleted_at ? null : row.text_content,
      quickActionType: row.quick_action_type,
      createdAt: row.created_at,
      editedAt: row.edited_at,
      deleted: Boolean(row.deleted_at),
      state: senderVisibleState({
        status: row.status === "read" ? "read" : row.status === "delivered" ? "delivered" : "sent",
        senderReceiptsEnabled: myPrefs.readReceiptsEnabled,
        recipientReceiptsEnabled: true
      }),
      myReaction: myReactions.get(row.id) ?? null
    }));
}

export async function markConversationRead(userId: string, conversationId: string): Promise<MessagingResult> {
  const envMessage = serviceRoleEnvMessage();
  if (envMessage) return { ok: false, message: envMessage };
  if (!uuidSchema.safeParse(conversationId).success) return { ok: false, message: "Not found." };

  const admin = createSupabaseAdminClient();
  const access = await resolveConversationAccess(admin, userId, conversationId);
  if (!access.canView) return { ok: false, message: "Not found." };

  const { data: latest } = await admin
    .from("messages")
    .select("id")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!latest) return { ok: true, message: "Up to date." };

  await admin
    .from("conversation_members")
    .update({ last_read_message_id: latest.id, updated_at: new Date().toISOString() })
    .eq("conversation_id", conversationId)
    .eq("user_id", userId);

  const prefs = await loadCommunicationPreferences(admin, userId);
  if (prefs.readReceiptsEnabled) {
    await admin
      .from("messages")
      .update({ status: "read" })
      .eq("conversation_id", conversationId)
      .neq("sender_id", userId)
      .in("status", ["sent", "delivered"]);
  }

  return { ok: true, message: "Marked read." };
}

/**
 * Pins or unpins a conversation for a user. A pin is a private cosmetic
 * preference; the user must be a joined member of the conversation (checked
 * here under the service role) before any row is written.
 */
export async function setConversationPinned(
  userId: string,
  conversationId: string,
  pinned: boolean
): Promise<MessagingResult> {
  const envMessage = serviceRoleEnvMessage();
  if (envMessage) return { ok: false, message: envMessage };
  if (!uuidSchema.safeParse(conversationId).success) return { ok: false, message: "Not found." };

  const admin = createSupabaseAdminClient();
  const access = await resolveConversationAccess(admin, userId, conversationId);
  if (!access.canView) return { ok: false, message: "Not found." };

  if (pinned) {
    const { error } = await admin
      .from("conversation_pins")
      .upsert({ user_id: userId, conversation_id: conversationId }, { onConflict: "user_id,conversation_id" });
    if (error) return { ok: false, message: "Could not pin this chat. Try again." };
    return { ok: true, message: "Pinned." };
  }

  const { error } = await admin
    .from("conversation_pins")
    .delete()
    .eq("user_id", userId)
    .eq("conversation_id", conversationId);
  if (error) return { ok: false, message: "Could not unpin this chat. Try again." };
  return { ok: true, message: "Unpinned." };
}
