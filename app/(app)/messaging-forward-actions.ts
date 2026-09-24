"use server";

import { z } from "zod";
import { guardAction } from "@/lib/admin/enforcement";
import { prepareForwardedMedia } from "@/lib/messaging/forward-media";
import { sendMessage } from "@/lib/messaging/mobile";

import { canSendMessage, resolveConversationAccess } from "@/lib/messaging/service";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getSupabaseServerEnv } from "@/lib/supabase/env";
import { getAuthoritativeMessagingUserId } from "@/lib/messaging/action-auth";

const uuid = z.string().uuid();



export async function forwardMessageAction(input: unknown) {
  const env = getSupabaseServerEnv();
  if (!env.url || !env.serviceRoleKey) return { ok: false as const, message: "Chats are not configured." };
  const parsed = z.object({ sourceMessageId: uuid, targetConversationIds: z.array(uuid).min(1).max(10) }).safeParse(input);
  if (!parsed.success) return { ok: false as const, message: "Choose a chat to forward to." };
  const me = await getAuthoritativeMessagingUserId();
  if (!me) return { ok: false as const, message: "Log in first." };

  const admin = createSupabaseAdminClient();
  const { data: source } = await admin
    .from("messages")
    .select("id, conversation_id, message_type, text_content, media_id, duration_seconds, waveform_data, deleted_at, status, expires_at, kept_at, media_mode")
    .eq("id", parsed.data.sourceMessageId)
    .maybeSingle();
  if (!source || source.deleted_at || !["sent", "delivered", "read"].includes(source.status)
    || (!source.kept_at && source.expires_at && Date.parse(source.expires_at) <= Date.now())
    || source.media_mode === "view_once") return { ok: false as const, message: "That message is no longer available." };
  const sourceAccess = await resolveConversationAccess(admin, me, source.conversation_id);
  if (!sourceAccess.canView) return { ok: false as const, message: "That message is no longer available." };

  if (!["text", "image", "voice_note"].includes(source.message_type)) {
    return { ok: false as const, message: "This message type cannot be forwarded yet." };
  }

  // The canonical sender checks messaging permission and rate limits. Only
  // attachments need this extra media-upload guard before copying the asset.
  if (source.media_id) {
    const guard = await guardAction(admin, { userId: me, surface: "messaging", control: "media_uploads" });
    if (!guard.allowed) return { ok: false as const, message: guard.message };
  }

  const targets = [...new Set(parsed.data.targetConversationIds)];
  let sent = 0;
  for (const conversationId of targets) {
    let mediaId: string | undefined;
    if (source.message_type === "image" || source.message_type === "voice_note") {
      const allowed = await canSendMessage(admin, me, conversationId);
      if (!allowed.allowed) continue;
      if (!source.media_id) continue;
      const prepared = await prepareForwardedMedia(admin, me, {
        mediaId: source.media_id,
        sourceConversationId: source.conversation_id,
        conversationId,
        mediaKind: source.message_type
      });
      if (!prepared.ok) continue;
      mediaId = prepared.mediaId;
    }
    // Use the normal send path for attachment validation, rate limits,
    // message metadata, conversation updates and recipient notifications.
    const result = await sendMessage(me, {
      conversationId,
      text: source.message_type === "voice_note" ? undefined : source.text_content ?? undefined,
      mediaId,
      clientMessageId: crypto.randomUUID()
    }, { forwardedFromMessageId: source.id });
    if (!result.ok) continue;
    sent += 1;
  }

  if (sent === 0) return { ok: false as const, message: "The message could not be forwarded to those chats." };
  return { ok: true as const, message: sent === 1 ? "Forwarded." : `Forwarded to ${sent} chats.`, sent };
}
