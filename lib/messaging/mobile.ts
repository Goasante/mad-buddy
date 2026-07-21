import "server-only";

import { z } from "zod";
import { senderVisibleState, validateMessageText, type UserFacingMessageState } from "@/lib/messaging/rules";
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
import type { QuickActionType } from "@/lib/supabase/database.types";

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
  senderId: string | null;
  senderName: string;
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
  contextBadge: string | null;
};

export type MessageableFriend = {
  friendId: string;
  displayName: string;
  username: string;
  avatarUrl: string | null;
};

const uuidSchema = z.string().uuid();

export const sendMessageSchema = z.object({
  conversationId: uuidSchema,
  text: z.string().optional(),
  quickActionType: z
    .enum(["on_my_way", "im_here", "running_late", "where_to_meet", "cant_make_it", "start_without_me"])
    .optional(),
  replyToMessageId: uuidSchema.optional(),
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
  if (!isQuickAction) {
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

  const { data: message, error } = await admin
    .from("messages")
    .insert({
      conversation_id: parsed.data.conversationId,
      sender_id: userId,
      message_type: isQuickAction ? "quick_action" : "text",
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
  const { data: members } = await admin
    .from("conversation_members")
    .select("user_id, muted_until")
    .eq("conversation_id", conversationId)
    .eq("status", "joined")
    .neq("user_id", senderId);

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
        type: "message:new",
        title: preview.title,
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
      .or(`user_one_id.eq.${userId},user_two_id.eq.${userId}`),
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

  const { data: profiles } = await admin
    .from("profiles")
    .select("user_id, full_name, username, avatar_url")
    .in("user_id", friendIds);

  return (profiles ?? [])
    .map((profile) => ({
      friendId: profile.user_id,
      displayName: profile.full_name,
      username: profile.username,
      avatarUrl: profile.avatar_url
    }))
    .sort((a, b) => a.displayName.localeCompare(b.displayName));
}

async function readTimestampFor(admin: Admin, messageId: string): Promise<string> {
  const { data } = await admin.from("messages").select("created_at").eq("id", messageId).maybeSingle();
  return data?.created_at ?? new Date(0).toISOString();
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
  const nowIso = new Date().toISOString();
  const views: ConversationView[] = [];

  for (const conversation of conversations ?? []) {
    let title = "Conversation";
    let otherUsername: string | null = null;
    let avatarUrl: string | null = null;
    if (conversation.conversation_type === "direct" && conversation.direct_key) {
      const otherId = conversation.direct_key.split(":").find((id) => id !== userId);
      if (otherId) {
        const { data: profile } = await admin
          .from("profiles")
          .select("full_name, username, avatar_url")
          .eq("user_id", otherId)
          .maybeSingle();
        title = profile?.full_name?.trim() || "A Muddy";
        otherUsername = profile?.username ?? null;
        avatarUrl = profile?.avatar_url ?? null;
      }
    } else {
      const { data: settings } = await admin
        .from("group_settings")
        .select("name")
        .eq("conversation_id", conversation.id)
        .maybeSingle();
      title = settings?.name ?? (conversation.conversation_type === "plan" ? "Plan chat" : "Group");
    }

    const { data: lastMessage } = await admin
      .from("messages")
      .select("text_content, message_type, created_at")
      .eq("conversation_id", conversation.id)
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const membership = membershipById.get(conversation.id);
    const { count: unread } = await admin
      .from("messages")
      .select("id", { count: "exact", head: true })
      .eq("conversation_id", conversation.id)
      .neq("sender_id", userId)
      .is("deleted_at", null)
      .gt(
        "created_at",
        membership?.last_read_message_id
          ? await readTimestampFor(admin, membership.last_read_message_id)
          : new Date(0).toISOString()
      );

    views.push({
      id: conversation.id,
      title,
      avatarUrl,
      otherUsername,
      kind: conversation.conversation_type,
      lastMessagePreview:
        lastMessage?.message_type === "voice_note" ? "Voice note" : lastMessage?.text_content ?? null,
      lastMessageAt: conversation.last_message_at,
      unreadCount: unread ?? 0,
      muted: Boolean(membership?.muted_until && membership.muted_until > nowIso),
      contextBadge:
        conversation.context_type === "plan"
          ? "Plan"
          : conversation.context_type === "event" || conversation.context_type === "event_circle"
            ? "Event"
            : conversation.context_type === "safe_arrival"
              ? "Safe Arrival"
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

  const { data: messages } = await admin
    .from("messages")
    .select("id, sender_id, message_type, text_content, quick_action_type, status, created_at, edited_at, deleted_at")
    .eq("conversation_id", conversationId)
    .gte("created_at", access.historyVisibleFrom ?? new Date(0).toISOString())
    .order("created_at", { ascending: true })
    .limit(200);

  const rows = messages ?? [];
  if (rows.length === 0) return [];

  const [{ data: hides }, { data: reactions }] = await Promise.all([
    admin.from("message_hides").select("message_id").eq("user_id", userId),
    admin.from("message_reactions").select("message_id, reaction_type").eq("user_id", userId)
  ]);
  const hiddenIds = new Set((hides ?? []).map((row) => row.message_id));
  const myReactions = new Map((reactions ?? []).map((row) => [row.message_id, row.reaction_type]));

  const senderIds = [...new Set(rows.map((row) => row.sender_id).filter((id): id is string => Boolean(id)))];
  const nameById = new Map<string, string>();
  if (senderIds.length > 0) {
    const { data: profiles } = await admin.from("profiles").select("user_id, full_name").in("user_id", senderIds);
    for (const profile of profiles ?? []) {
      nameById.set(profile.user_id, profile.full_name?.trim() || "A Muddy");
    }
  }

  const myPrefs = await loadCommunicationPreferences(admin, userId);

  return rows
    .filter((row) => !hiddenIds.has(row.id))
    .map((row) => ({
      id: row.id,
      senderId: row.sender_id,
      senderName: row.sender_id === userId ? "You" : nameById.get(row.sender_id ?? "") ?? "Mad Buddy",
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
