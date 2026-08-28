"use server";

import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import {
  createChatV4RichUploadIntent,
  finalizeChatV4RichUpload
} from "@/lib/media/chat-v4-rich-upload-service";
import {
  MEDIA_SIGNED_URL_TTL_SECONDS,
  mediaSignedUrlExpiresAt
} from "@/lib/media/constants";
import { messageAttachmentCanBeSigned } from "@/lib/messaging/attachment-retention";
import type { RichMediaMessageView } from "@/lib/messaging/rich-media-v4-types";
import { canCreateDirectConversation, resolveConversationAccess } from "@/lib/messaging/service";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getSupabaseServerEnv } from "@/lib/supabase/env";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const uuid = z.string().uuid();
const richKind = z.enum(["video", "file"]);
const createIntentSchema = z.object({
  conversationId: uuid,
  contentType: z.string().trim().min(1).max(160),
  sizeBytes: z.number().int().positive().max(15 * 1024 * 1024),
  mediaKind: richKind,
  fileName: z.string().trim().min(1).max(255)
});
const finalizeSchema = z.object({
  conversationId: uuid,
  mediaId: uuid,
  expectedMediaKind: richKind
});
const playbackSchema = z.object({ conversationId: uuid, messageId: uuid });

function configured() {
  const env = getSupabaseServerEnv();
  return Boolean(env.url && env.serviceRoleKey);
}

async function getUserId() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
    error
  } = await supabase.auth.getUser();
  return error || !user ? null : user.id;
}

export async function createChatRichMediaUploadIntentAction(input: unknown) {
  if (!configured()) return { ok: false as const, message: "Chats are not configured." };
  const parsed = createIntentSchema.safeParse(input);
  if (!parsed.success) return { ok: false as const, message: "Check that attachment and try again." };
  const userId = await getUserId();
  if (!userId) return { ok: false as const, message: "Log in first." };
  return createChatV4RichUploadIntent(createSupabaseAdminClient(), userId, parsed.data);
}

export async function finalizeChatRichMediaUploadAction(input: unknown) {
  if (!configured()) return { ok: false as const, message: "Chats are not configured." };
  const parsed = finalizeSchema.safeParse(input);
  if (!parsed.success) return { ok: false as const, message: "That upload isn't available." };
  const userId = await getUserId();
  if (!userId) return { ok: false as const, message: "Log in first." };
  return finalizeChatV4RichUpload(createSupabaseAdminClient(), userId, parsed.data);
}

/**
 * Mints a short-lived URL only after re-checking the message, conversation,
 * relationship, block state, retention state and canonical media asset. The
 * browser never gets a storage path or a reusable public URL.
 */
export async function getRichMediaMessageAction(input: unknown): Promise<RichMediaMessageView | null> {
  if (!configured()) return null;
  const parsed = playbackSchema.safeParse(input);
  if (!parsed.success) return null;
  const viewerId = await getUserId();
  if (!viewerId) return null;

  const admin = createSupabaseAdminClient();
  const access = await resolveConversationAccess(admin, viewerId, parsed.data.conversationId);
  if (!access.canView || access.status !== "active") return null;

  const untyped = admin as unknown as SupabaseClient;
  const { data: message } = await untyped
    .from("messages")
    .select("id, conversation_id, sender_id, media_id, message_type, status, deleted_at, created_at, expires_at, kept_at")
    .eq("id", parsed.data.messageId)
    .eq("conversation_id", parsed.data.conversationId)
    .maybeSingle();
  if (!message || !message.media_id || (message.message_type !== "video" && message.message_type !== "file")) return null;
  if (!messageAttachmentCanBeSigned({ status: String(message.status), deletedAt: message.deleted_at as string | null })) return null;
  if (access.historyVisibleFrom && Date.parse(String(message.created_at)) < Date.parse(access.historyVisibleFrom)) return null;
  if (!message.kept_at && message.expires_at && Date.parse(String(message.expires_at)) <= Date.now()) return null;

  if (access.conversationType === "direct") {
    const otherId = access.directKey?.split(":").find((id) => id !== viewerId);
    if (!otherId) return null;
    const eligibility = await canCreateDirectConversation(admin, viewerId, otherId);
    if (!eligibility.allowed) return null;
  } else if (message.sender_id && message.sender_id !== viewerId) {
    const { data: block } = await admin
      .from("blocked_users")
      .select("blocker_id")
      .or(
        `and(blocker_id.eq.${viewerId},blocked_id.eq.${message.sender_id}),and(blocker_id.eq.${message.sender_id},blocked_id.eq.${viewerId})`
      )
      .limit(1)
      .maybeSingle();
    if (block) return null;
  }

  const { data: asset } = await untyped
    .from("media_assets")
    .select("id, owner_id, storage_key, content_type, size_bytes, context_type, intended_conversation_id, intended_media_kind, original_file_name, processing_status, moderation_status, deleted_at")
    .eq("id", message.media_id)
    .maybeSingle();
  if (!asset) return null;
  const expectedKind = message.message_type as "video" | "file";
  if (
    asset.context_type !== "chat" ||
    asset.intended_conversation_id !== parsed.data.conversationId ||
    asset.intended_media_kind !== expectedKind ||
    asset.processing_status !== "ready" ||
    asset.moderation_status !== "active" ||
    asset.deleted_at
  ) return null;
  if (message.sender_id && asset.owner_id !== message.sender_id) return null;

  const { data: queued } = await untyped
    .from("media_deletion_queue")
    .select("id")
    .eq("media_asset_id", asset.id)
    .is("processed_at", null)
    .limit(1)
    .maybeSingle();
  if (queued) return null;

  const { data: signed, error } = await admin.storage
    .from("media")
    .createSignedUrl(String(asset.storage_key), MEDIA_SIGNED_URL_TTL_SECONDS);
  if (error || !signed?.signedUrl) return null;

  return {
    messageId: String(message.id),
    mediaId: String(asset.id),
    kind: expectedKind,
    url: signed.signedUrl,
    contentType: String(asset.content_type),
    fileName: String(asset.original_file_name ?? (expectedKind === "video" ? "Video" : "Document")),
    sizeBytes: Number(asset.size_bytes ?? 0),
    expiresAt: mediaSignedUrlExpiresAt()
  };
}
