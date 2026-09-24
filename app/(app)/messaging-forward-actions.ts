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
const inputSchema = z.object({
  sourceMessageIds: z.array(uuid).min(1).max(5),
  targetConversationIds: z.array(uuid).min(1).max(5),
  operationId: uuid,
  retry: z.boolean().optional()
});

export async function forwardMessageAction(input: unknown) {
  const env = getSupabaseServerEnv();
  if (!env.url || !env.serviceRoleKey) return { ok: false as const, message: "Chats are not configured.", sent: 0, total: 0 };
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) return { ok: false as const, message: "Choose up to five messages and five chats.", sent: 0, total: 0 };
  const me = await getAuthoritativeMessagingUserId();
  if (!me) return { ok: false as const, message: "Log in first.", sent: 0, total: 0 };

  const sourceIds = [...new Set(parsed.data.sourceMessageIds)];
  const targetIds = [...new Set(parsed.data.targetConversationIds)];
  const total = sourceIds.length * targetIds.length;
  const admin = createSupabaseAdminClient();
  const { data: rows, error } = await admin.from("messages")
    .select("id, conversation_id, message_type, text_content, media_id, deleted_at, status, expires_at, kept_at, media_mode, created_at")
    .in("id", sourceIds);
  if (error || rows?.length !== sourceIds.length) return { ok: false as const, message: "A selected message is no longer available.", sent: 0, total };

  const byId = new Map(rows.map((row) => [row.id, row]));
  const sources = sourceIds.map((id) => byId.get(id)!);
  const now = Date.now();
  if (sources.some((source) => source.deleted_at || !["sent", "delivered", "read"].includes(source.status)
    || (!source.kept_at && source.expires_at && Date.parse(source.expires_at) <= now)
    || source.media_mode === "view_once"
    || !["text", "image", "voice_note"].includes(source.message_type))) {
    return { ok: false as const, message: "A selected message cannot be forwarded.", sent: 0, total };
  }

  const sourceConversationIds = [...new Set(sources.map((source) => source.conversation_id))];
  const access = await Promise.all(sourceConversationIds.map((id) => resolveConversationAccess(admin, me, id)));
  const accessByConversation = new Map(sourceConversationIds.map((id, index) => [id, access[index]]));
  if (sources.some((source) => {
    const permission = accessByConversation.get(source.conversation_id);
    return !permission?.canView || Boolean(permission.historyVisibleFrom && source.created_at < permission.historyVisibleFrom);
  })) return { ok: false as const, message: "A selected message is no longer available.", sent: 0, total };

  if (sources.some((source) => source.media_id)) {
    const guard = await guardAction(admin, { userId: me, surface: "messaging", control: "media_uploads" });
    if (!guard.allowed) return { ok: false as const, message: guard.message, sent: 0, total };
  }

  // Different chats progress together; messages within each chat stay in order.
  const counts = await Promise.all(targetIds.map(async (conversationId, targetIndex) => {
    let sent = 0;
    for (const [sourceIndex, source] of sources.entries()) {
      const clientMessageId = `${parsed.data.operationId}:${targetIndex}:${sourceIndex}`;
      // On retry, check before copying media: a fresh copy has a different id.
      if (parsed.data.retry) {
        const { data: existing } = await admin.from("messages")
          .select("id, conversation_id, forwarded_from_message_id")
          .eq("sender_id", me).eq("client_message_id", clientMessageId).maybeSingle();
        if (existing) {
          if (existing.conversation_id === conversationId && existing.forwarded_from_message_id === source.id) sent++;
          continue;
        }
      }

      let mediaId: string | undefined;
      if (source.message_type === "image" || source.message_type === "voice_note") {
        if (!source.media_id) continue;
        const allowed = await canSendMessage(admin, me, conversationId);
        if (!allowed.allowed) continue;
        const prepared = await prepareForwardedMedia(admin, me, {
          mediaId: source.media_id,
          sourceConversationId: source.conversation_id,
          conversationId,
          mediaKind: source.message_type
        });
        if (!prepared.ok) continue;
        mediaId = prepared.mediaId;
      }
      const result = await sendMessage(me, {
        conversationId,
        text: source.message_type === "voice_note" ? undefined : source.text_content ?? undefined,
        mediaId,
        clientMessageId
      }, { forwardedFromMessageId: source.id, deferFollowUp: true });
      if (result.ok) sent++;
    }
    return sent;
  }));
  const sent = counts.reduce((sum, count) => sum + count, 0);
  return sent === total
    ? { ok: true as const, message: total === 1 ? "Message forwarded." : `${sent} messages forwarded.`, sent, total }
    : { ok: false as const, message: sent > 0 ? `${sent} of ${total} messages forwarded. Tap Retry to send the rest.` : "Could not forward those messages. Try again.", sent, total };
}
