import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  MEDIA_SIGNED_URL_TTL_SECONDS,
  mediaSignedUrlExpiresAt
} from "@/lib/media/constants";
import { messageAttachmentCanBeSigned } from "@/lib/messaging/attachment-retention";
import type { RichMediaMessageView } from "@/lib/messaging/rich-media-v4-types";
import { canCreateDirectConversation, resolveConversationAccess } from "@/lib/messaging/service";
import type { createSupabaseAdminClient } from "@/lib/supabase/admin";

type Admin = ReturnType<typeof createSupabaseAdminClient>;

/**
 * Server-authoritative projection for a sent video/document.
 *
 * The caller supplies an already-authenticated viewer id. Every privacy and
 * retention check remains here so both Server Action and JSON transports mint
 * URLs from one rule set.
 */
export async function getRichMediaMessage(
  admin: Admin,
  viewerId: string,
  input: { conversationId: string; messageId: string }
): Promise<RichMediaMessageView | null> {
  const access = await resolveConversationAccess(admin, viewerId, input.conversationId);
  if (!access.canView || access.status !== "active") return null;

  const untyped = admin as unknown as SupabaseClient;
  const { data: message } = await untyped
    .from("messages")
    .select("id, conversation_id, sender_id, media_id, message_type, status, deleted_at, created_at, expires_at, kept_at")
    .eq("id", input.messageId)
    .eq("conversation_id", input.conversationId)
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
    asset.intended_conversation_id !== input.conversationId ||
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

  const fileName = String(asset.original_file_name ?? (expectedKind === "video" ? "Video" : "Document"));
  const { data: signed, error } = await admin.storage
    .from("media")
    .createSignedUrl(String(asset.storage_key), MEDIA_SIGNED_URL_TTL_SECONDS);
  if (error || !signed?.signedUrl) return null;

  let downloadUrl: string | undefined;
  if (expectedKind === "file") {
    const { data: downloadSigned, error: downloadError } = await admin.storage
      .from("media")
      .createSignedUrl(String(asset.storage_key), MEDIA_SIGNED_URL_TTL_SECONDS, { download: fileName });
    if (!downloadError && downloadSigned?.signedUrl) downloadUrl = downloadSigned.signedUrl;
  }

  return {
    messageId: String(message.id),
    mediaId: String(asset.id),
    kind: expectedKind,
    url: signed.signedUrl,
    downloadUrl,
    contentType: String(asset.content_type),
    fileName,
    sizeBytes: Number(asset.size_bytes ?? 0),
    expiresAt: mediaSignedUrlExpiresAt()
  };
}
