"use server";

import { z } from "zod";
import { resolveConversationAccess } from "@/lib/messaging/service";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getSupabaseServerEnv } from "@/lib/supabase/env";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const uuidSchema = z.string().uuid();

async function getAuthedUserId() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
    error
  } = await supabase.auth.getUser();
  return error || !user ? null : user.id;
}

/**
 * Projects reply context for the messages already visible in one authorised
 * conversation. The core mobile view intentionally stayed narrow; Chats v3
 * needs the quoted message identity so swipe-to-reply survives a refresh.
 *
 * This does not widen access. Both the replying message and its target must be
 * in the exact conversation the caller can currently view.
 */
export async function getReplyContextsAction(conversationId: string) {
  const env = getSupabaseServerEnv();
  if (!env.url || !env.serviceRoleKey) return {};
  if (!uuidSchema.safeParse(conversationId).success) return {};

  const userId = await getAuthedUserId();
  if (!userId) return {};

  const admin = createSupabaseAdminClient();
  const access = await resolveConversationAccess(admin, userId, conversationId);
  if (!access.canView) return {};

  const { data: replyRows } = await admin
    .from("messages")
    .select("id, reply_to_message_id")
    .eq("conversation_id", conversationId)
    .not("reply_to_message_id", "is", null)
    .order("created_at", { ascending: true })
    .limit(300);

  const targetIds = [
    ...new Set(
      (replyRows ?? [])
        .map((row) => row.reply_to_message_id)
        .filter((id): id is string => Boolean(id))
    )
  ];
  if (targetIds.length === 0) return {};

  const { data: targets } = await admin
    .from("messages")
    .select("id, sender_id, message_type, text_content, deleted_at")
    .eq("conversation_id", conversationId)
    .in("id", targetIds);

  const senderIds = [
    ...new Set(
      (targets ?? []).map((row) => row.sender_id).filter((id): id is string => Boolean(id) && id !== userId)
    )
  ];
  const { data: profiles } = senderIds.length
    ? await admin.from("profiles").select("user_id, full_name, username").in("user_id", senderIds)
    : { data: [] };
  const names = new Map(
    (profiles ?? []).map((profile) => [
      profile.user_id,
      profile.full_name?.trim() || profile.username?.trim() || "A Muddy"
    ])
  );
  const targetById = new Map((targets ?? []).map((row) => [row.id, row]));

  const result: Record<
    string,
    { replyToMessageId: string; senderName: string; text: string }
  > = {};

  for (const row of replyRows ?? []) {
    if (!row.reply_to_message_id) continue;
    const target = targetById.get(row.reply_to_message_id);
    if (!target) continue;
    const senderName = target.sender_id === userId ? "You" : names.get(target.sender_id ?? "") ?? "A Muddy";
    const text = target.deleted_at
      ? "Message removed"
      : target.message_type === "voice_note"
        ? "Voice message"
        : target.message_type === "image"
          ? "Photo"
          : target.message_type === "quick_action"
            ? "Quick action"
            : target.text_content?.trim() || "Message";

    result[row.id] = {
      replyToMessageId: row.reply_to_message_id,
      senderName,
      text
    };
  }

  return result;
}
