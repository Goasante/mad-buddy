"use server";

import { z } from "zod";
import {
  canDeleteForEveryone,
  canEditMessage,
  validateMessageText
} from "@/lib/messaging/rules";
import {
  loadCommunicationPreferences,
  normalizeCommunicationPreferences,
  resolveConversationAccess,
  type CommunicationPreferences
} from "@/lib/messaging/service";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getSupabaseServerEnv } from "@/lib/supabase/env";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { MessageReactionType } from "@/lib/supabase/database.types";
import {
  listConversations,
  listMessages,
  listMessageableFriends,
  markConversationRead,
  openDirectConversation,
  sendMessage,
  type ChatMessageView,
  type ConversationView,
  type MessageableFriend
} from "@/lib/messaging/mobile";

// The read/send views + logic (and these view types) live in
// lib/messaging/mobile.ts so the mobile /api/messages/* routes share them.
// A "use server" file can't re-export types (Turbopack treats every export as
// an action), so importers get the types straight from lib/messaging/mobile.

export type MessagingActionState = {
  ok: boolean;
  message: string;
  conversationId?: string;
  messageId?: string;
};

const uuidSchema = z.string().uuid();

function missingEnvState(): MessagingActionState | null {
  const env = getSupabaseServerEnv();
  if (!env.url || !env.serviceRoleKey) {
    return { ok: false, message: "This action needs the server database configuration." };
  }
  return null;
}

async function getAuthedUserId() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
    error
  } = await supabase.auth.getUser();
  return error || !user ? null : user.id;
}

// ---------------------------------------------------------------------------
// Open a conversation (spec §4), no manual "create chat" step.
// ---------------------------------------------------------------------------

export async function openDirectConversationAction(recipientId: string): Promise<MessagingActionState> {
  const userId = await getAuthedUserId();
  if (!userId) return { ok: false, message: "Log in first." };

  return openDirectConversation(userId, recipientId);
}

// ---------------------------------------------------------------------------
// Send (spec §7, §20)
// ---------------------------------------------------------------------------

export async function sendMessageAction(input: unknown): Promise<MessagingActionState> {
  const userId = await getAuthedUserId();
  if (!userId) return { ok: false, message: "Log in first." };

  return sendMessage(userId, input);
}

export async function getMessageableFriendsAction(): Promise<MessageableFriend[]> {
  const userId = await getAuthedUserId();
  if (!userId) return [];

  return listMessageableFriends(userId);
}

// ---------------------------------------------------------------------------
// Read / list (spec §19)
// ---------------------------------------------------------------------------

export async function getConversationsAction(): Promise<ConversationView[]> {
  const userId = await getAuthedUserId();
  if (!userId) return [];

  return listConversations(userId);
}

export async function getMessagesAction(conversationId: string): Promise<ChatMessageView[]> {
  const userId = await getAuthedUserId();
  if (!userId) return [];

  return listMessages(userId, conversationId);
}

export async function markConversationReadAction(conversationId: string): Promise<MessagingActionState> {
  const userId = await getAuthedUserId();
  if (!userId) return { ok: false, message: "Log in first." };

  return markConversationRead(userId, conversationId);
}

export async function muteConversationAction(
  conversationId: string,
  hours: number
): Promise<MessagingActionState> {
  const missing = missingEnvState();
  if (missing) return missing;
  if (!uuidSchema.safeParse(conversationId).success) return { ok: false, message: "Not found." };

  const userId = await getAuthedUserId();
  if (!userId) return { ok: false, message: "Log in first." };

  const admin = createSupabaseAdminClient();
  const mutedUntil = hours > 0 ? new Date(Date.now() + hours * 60 * 60 * 1000).toISOString() : null;
  await admin
    .from("conversation_members")
    .update({ muted_until: mutedUntil, updated_at: new Date().toISOString() })
    .eq("conversation_id", conversationId)
    .eq("user_id", userId);

  return { ok: true, message: mutedUntil ? "Conversation muted." : "Conversation unmuted." };
}

// ---------------------------------------------------------------------------
// Edit / delete / react (spec §13, §14, §15)
// ---------------------------------------------------------------------------

export async function editMessageAction(messageId: string, text: string): Promise<MessagingActionState> {
  const missing = missingEnvState();
  if (missing) return missing;
  if (!uuidSchema.safeParse(messageId).success) return { ok: false, message: "Message not found." };

  const textError = validateMessageText(text);
  if (textError) return { ok: false, message: textError };

  const userId = await getAuthedUserId();
  if (!userId) return { ok: false, message: "Log in first." };

  const admin = createSupabaseAdminClient();
  const { data: message } = await admin
    .from("messages")
    .select("id, sender_id, message_type, created_at, deleted_at")
    .eq("id", messageId)
    .maybeSingle();
  if (!message) return { ok: false, message: "Message not found." };

  if (
    !canEditMessage({
      isSender: message.sender_id === userId,
      createdAtMs: Date.parse(message.created_at),
      nowMs: Date.now(),
      messageType: message.message_type,
      deleted: Boolean(message.deleted_at)
    })
  ) {
    return { ok: false, message: "This message can't be edited anymore." };
  }

  const { error } = await admin
    .from("messages")
    .update({ text_content: text.trim(), edited_at: new Date().toISOString() })
    .eq("id", messageId)
    .eq("sender_id", userId);
  if (error) return { ok: false, message: "Couldn't edit that message." };
  return { ok: true, message: "Message edited." };
}

export async function deleteMessageAction(
  messageId: string,
  forEveryone: boolean
): Promise<MessagingActionState> {
  const missing = missingEnvState();
  if (missing) return missing;
  if (!uuidSchema.safeParse(messageId).success) return { ok: false, message: "Message not found." };

  const userId = await getAuthedUserId();
  if (!userId) return { ok: false, message: "Log in first." };

  const admin = createSupabaseAdminClient();

  if (!forEveryone) {
    // Delete for me: hide locally, leave the other participant's copy alone.
    await admin
      .from("message_hides")
      .upsert({ message_id: messageId, user_id: userId }, { onConflict: "message_id,user_id" });
    return { ok: true, message: "Message removed for you." };
  }

  const { data: message } = await admin
    .from("messages")
    .select("id, sender_id, created_at")
    .eq("id", messageId)
    .maybeSingle();
  if (!message) return { ok: false, message: "Message not found." };

  if (
    !canDeleteForEveryone({
      isSender: message.sender_id === userId,
      createdAtMs: Date.parse(message.created_at),
      nowMs: Date.now()
    })
  ) {
    return { ok: false, message: "This message can't be deleted for everyone anymore." };
  }

  const { error } = await admin
    .from("messages")
    .update({ status: "deleted", deleted_at: new Date().toISOString(), text_content: null })
    .eq("id", messageId)
    .eq("sender_id", userId);
  if (error) return { ok: false, message: "Couldn't delete that message." };
  return { ok: true, message: "Message deleted." };
}

export async function reactToMessageAction(
  messageId: string,
  reaction: string
): Promise<MessagingActionState> {
  const missing = missingEnvState();
  if (missing) return missing;
  if (!uuidSchema.safeParse(messageId).success) return { ok: false, message: "Message not found." };

  const parsed = z.enum(["heart", "laugh", "thumbs_up", "wave", "fire", "wow"]).safeParse(reaction);
  if (!parsed.success) return { ok: false, message: "Choose a valid reaction." };

  const userId = await getAuthedUserId();
  if (!userId) return { ok: false, message: "Log in first." };

  const admin = createSupabaseAdminClient();
  const { data: message } = await admin
    .from("messages")
    .select("conversation_id")
    .eq("id", messageId)
    .maybeSingle();
  if (!message) return { ok: false, message: "Message not found." };

  const access = await resolveConversationAccess(admin, userId, message.conversation_id);
  if (!access.canView) return { ok: false, message: "Message not found." };

  await admin
    .from("message_reactions")
    .upsert(
      { message_id: messageId, user_id: userId, reaction_type: parsed.data as MessageReactionType },
      { onConflict: "message_id,user_id" }
    );
  return { ok: true, message: "Reaction added." };
}

export async function removeMessageReactionAction(messageId: string): Promise<MessagingActionState> {
  const missing = missingEnvState();
  if (missing) return missing;
  const userId = await getAuthedUserId();
  if (!userId) return { ok: false, message: "Log in first." };

  const admin = createSupabaseAdminClient();
  await admin.from("message_reactions").delete().eq("message_id", messageId).eq("user_id", userId);
  return { ok: true, message: "Reaction removed." };
}

// ---------------------------------------------------------------------------
// Communication privacy preferences (spec §53-§56)
// ---------------------------------------------------------------------------

export async function getCommunicationPreferencesAction(): Promise<CommunicationPreferences> {
  const env = getSupabaseServerEnv();
  const userId = await getAuthedUserId();
  if (!env.url || !env.serviceRoleKey || !userId) return normalizeCommunicationPreferences(null);
  const admin = createSupabaseAdminClient();
  return loadCommunicationPreferences(admin, userId);
}

export async function updateCommunicationPreferencesAction(input: unknown): Promise<MessagingActionState> {
  const missing = missingEnvState();
  if (missing) return missing;

  const userId = await getAuthedUserId();
  if (!userId) return { ok: false, message: "Log in first." };

  const normalized = normalizeCommunicationPreferences(input);
  const admin = createSupabaseAdminClient();
  const { error } = await admin
    .from("user_preferences")
    .upsert(
      { user_id: userId, communication_preferences: normalized as never },
      { onConflict: "user_id" }
    );
  if (error) return { ok: false, message: "Couldn't save your settings." };
  return { ok: true, message: "Communication settings saved." };
}
