"use server";

import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import { canSendMessage, resolveConversationAccess } from "@/lib/messaging/service";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getSupabaseServerEnv } from "@/lib/supabase/env";

const uuid = z.string().uuid();

async function userId() {
  const supabase = await createSupabaseServerClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  return error || !user ? null : user.id;
}

export async function forwardMessageAction(input: unknown) {
  const env = getSupabaseServerEnv();
  if (!env.url || !env.serviceRoleKey) return { ok: false as const, message: "Chats are not configured." };
  const parsed = z.object({ sourceMessageId: uuid, targetConversationIds: z.array(uuid).min(1).max(10) }).safeParse(input);
  if (!parsed.success) return { ok: false as const, message: "Choose a chat to forward to." };
  const me = await userId();
  if (!me) return { ok: false as const, message: "Log in first." };

  const admin = createSupabaseAdminClient();
  const { data: source } = await admin
    .from("messages")
    .select("id, conversation_id, message_type, text_content, media_id, duration_seconds, waveform_data, deleted_at")
    .eq("id", parsed.data.sourceMessageId)
    .maybeSingle();
  if (!source || source.deleted_at) return { ok: false as const, message: "That message is no longer available." };
  const sourceAccess = await resolveConversationAccess(admin, me, source.conversation_id);
  if (!sourceAccess.canView) return { ok: false as const, message: "That message is no longer available." };

  // Structured messages need to duplicate their child payload atomically. Text,
  // photos and voice notes can safely reuse their immutable media asset; those
  // are enabled now. Poll/event/contact/file/video forwarding is added with
  // each corresponding structured transport rather than silently dropping data.
  if (!["text", "image", "voice_note"].includes(source.message_type)) {
    return { ok: false as const, message: "This message type cannot be forwarded yet." };
  }

  const targets = [...new Set(parsed.data.targetConversationIds)];
  const db = admin as unknown as SupabaseClient;
  let sent = 0;
  for (const conversationId of targets) {
    const allowed = await canSendMessage(admin, me, conversationId);
    if (!allowed.allowed) continue;
    const now = new Date().toISOString();
    const { error } = await db.from("messages").insert({
      conversation_id: conversationId,
      sender_id: me,
      message_type: source.message_type,
      text_content: source.text_content,
      media_id: source.media_id,
      duration_seconds: source.duration_seconds,
      waveform_data: source.waveform_data,
      forwarded_from_message_id: source.id,
      client_message_id: crypto.randomUUID(),
      status: "sent",
      created_at: now
    });
    if (error) continue;
    sent += 1;
    await admin.from("conversations").update({ last_message_at: now, updated_at: now }).eq("id", conversationId);
  }

  if (sent === 0) return { ok: false as const, message: "The message could not be forwarded to those chats." };
  return { ok: true as const, message: sent === 1 ? "Forwarded." : `Forwarded to ${sent} chats.`, sent };
}
