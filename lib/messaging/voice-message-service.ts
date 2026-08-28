import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { resolveUserEntitlements } from "@/lib/billing/service";
import { isSupportedVoiceContentType } from "@/lib/media/audio-inspection";
import { MAX_UPLOAD_BYTES } from "@/lib/media/validation";
import { messageAttachmentCanBeSigned } from "@/lib/messaging/attachment-retention";
import { canCreateDirectConversation, resolveConversationAccess } from "@/lib/messaging/service";
import type { PreparedVoiceAsset } from "@/lib/messaging/voice-playback";
import { validateVoiceWaveform } from "@/lib/messaging/voice-waveform";
import type { createSupabaseAdminClient } from "@/lib/supabase/admin";

type Admin = ReturnType<typeof createSupabaseAdminClient>;

const VIDEO_TYPES = new Set(["video/mp4", "video/webm", "video/quicktime"]);
const DOCUMENT_TYPES = new Set([
  "application/pdf",
  "text/plain",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation"
]);

export type SendableMessageMedia =
  | { kind: "image" }
  | { kind: "voice_note"; durationMs: number; durationSeconds: number; waveform: number[] | null }
  | { kind: "video"; contentType: string; fileName: string; sizeBytes: number }
  | { kind: "file"; contentType: string; fileName: string; sizeBytes: number };

/** Revalidates critical READY-asset state immediately before a message insert. */
export async function resolveSendableMessageMedia(
  admin: Admin,
  userId: string,
  conversationId: string,
  mediaId: string
): Promise<SendableMessageMedia | null> {
  // `original_file_name` is an unapplied V4 completion column, so this one
  // projection intentionally uses an untyped client until the final schema
  // reconciliation/regeneration pass. All authorization remains explicit here.
  const untyped = admin as unknown as SupabaseClient;
  const { data: asset } = await untyped
    .from("media_assets")
    .select("owner_id, context_type, intended_conversation_id, intended_media_kind, content_type, size_bytes, original_file_name, processing_status, moderation_status, duration_ms, waveform_data, updated_at, deleted_at")
    .eq("id", mediaId)
    .maybeSingle();
  if (!asset || asset.owner_id !== userId || asset.context_type !== "chat") return null;
  if (asset.intended_conversation_id !== conversationId || asset.processing_status !== "ready") return null;
  if (asset.moderation_status !== "active" || asset.deleted_at) return null;

  const [{ data: queued }, { data: attached }] = await Promise.all([
    admin.from("media_deletion_queue").select("id").eq("media_asset_id", mediaId).is("processed_at", null).limit(1).maybeSingle(),
    admin.from("messages").select("id").eq("media_id", mediaId).limit(1).maybeSingle()
  ]);
  if (queued || attached) return null;

  let resolved: SendableMessageMedia;
  const contentType = String(asset.content_type ?? "");
  const sizeBytes = Number(asset.size_bytes ?? 0);
  const safeFileName = String(asset.original_file_name ?? "").trim();

  if (asset.intended_media_kind === "image" && contentType.startsWith("image/")) {
    resolved = { kind: "image" };
  } else if (asset.intended_media_kind === "video") {
    if (!VIDEO_TYPES.has(contentType) || sizeBytes <= 0 || sizeBytes > MAX_UPLOAD_BYTES.chat) return null;
    resolved = {
      kind: "video",
      contentType,
      fileName: safeFileName || "Video",
      sizeBytes
    };
  } else if (asset.intended_media_kind === "file") {
    if (!DOCUMENT_TYPES.has(contentType) || sizeBytes <= 0 || sizeBytes > MAX_UPLOAD_BYTES.chat) return null;
    resolved = {
      kind: "file",
      contentType,
      fileName: safeFileName || "Document",
      sizeBytes
    };
  } else {
    if (asset.intended_media_kind !== "voice_note" || !isSupportedVoiceContentType(contentType)) {
      return null;
    }
    const durationMs = Number(asset.duration_ms ?? 0);
    if (durationMs <= 0) return null;
    const waveform = validateVoiceWaveform(asset.waveform_data);
    if (!waveform.valid) return null;
    const entitlements = await resolveUserEntitlements(admin, userId);
    if (!entitlements.voice_notes || durationMs > entitlements.max_voice_note_seconds * 1_000) return null;
    resolved = {
      kind: "voice_note",
      durationMs,
      durationSeconds: Math.max(1, Math.ceil(durationMs / 1_000)),
      waveform: waveform.waveform
    };
  }

  // Compare-and-swap the existing lifecycle timestamp as an atomic send
  // claim. This closes the different-client-id race without a new table or
  // state: one contender updates the observed timestamp, all others fail.
  const previousUpdatedAtMs = Date.parse(String(asset.updated_at));
  const claimedAt = new Date(Math.max(Date.now(), Number.isFinite(previousUpdatedAtMs) ? previousUpdatedAtMs + 1 : 0)).toISOString();
  const { data: claimed, error: claimError } = await admin.from("media_assets")
    .update({ updated_at: claimedAt })
    .eq("id", mediaId)
    .eq("updated_at", String(asset.updated_at))
    .eq("processing_status", "ready")
    .eq("moderation_status", "active")
    .is("deleted_at", null)
    .select("id")
    .maybeSingle();
  return claimError || !claimed ? null : resolved;
}

/**
 * Produces safe, URL-free voice projections from authorized parent messages.
 * This is batched for a conversation page and repeats live block/membership
 * checks before the renderer is allowed to offer playback.
 */
export async function projectVoiceMessages(
  admin: Admin,
  viewerId: string,
  conversationId: string,
  messageIds: readonly string[]
): Promise<Map<string, PreparedVoiceAsset>> {
  const byMessageId = new Map<string, PreparedVoiceAsset>();
  const ids = [...new Set(messageIds.filter(Boolean))];
  if (ids.length === 0) return byMessageId;
  const access = await resolveConversationAccess(admin, viewerId, conversationId);
  if (!access.canView || access.status !== "active") return byMessageId;
  if (access.conversationType === "direct") {
    const otherId = access.directKey?.split(":").find((id) => id !== viewerId);
    if (!otherId || !(await canCreateDirectConversation(admin, viewerId, otherId)).allowed) return byMessageId;
  }

  const { data: rows } = await admin
    .from("messages")
    .select("id, sender_id, media_id, message_type, duration_seconds, waveform_data, status, deleted_at, created_at")
    .eq("conversation_id", conversationId)
    .in("id", ids)
    .eq("message_type", "voice_note")
    .gte("created_at", access.historyVisibleFrom ?? new Date(0).toISOString());
  let messages = (rows ?? []).filter((row) =>
    Boolean(row.media_id) && Boolean(row.duration_seconds) &&
    messageAttachmentCanBeSigned({ status: row.status, deletedAt: row.deleted_at })
  );

  const otherSenderIds = [...new Set(messages.map((row) => row.sender_id).filter((id): id is string => Boolean(id) && id !== viewerId))];
  if (otherSenderIds.length > 0) {
    const { data: blocks } = await admin.from("blocked_users").select("blocker_id, blocked_id")
      .or(`blocker_id.eq.${viewerId},blocked_id.eq.${viewerId}`);
    const blocked = new Set((blocks ?? []).flatMap((row) => row.blocker_id === viewerId ? [row.blocked_id] : row.blocked_id === viewerId ? [row.blocker_id] : []));
    messages = messages.filter((row) => !row.sender_id || !blocked.has(row.sender_id));
  }

  const mediaIds = [...new Set(messages.map((row) => row.media_id).filter((id): id is string => Boolean(id)))];
  if (mediaIds.length === 0) return byMessageId;
  const [{ data: assets }, { data: queued }] = await Promise.all([
    admin.from("media_assets").select("id, content_type, duration_ms, waveform_data")
      .in("id", mediaIds).eq("context_type", "chat").eq("intended_conversation_id", conversationId)
      .eq("intended_media_kind", "voice_note").eq("processing_status", "ready")
      .eq("moderation_status", "active").is("deleted_at", null),
    admin.from("media_deletion_queue").select("media_asset_id").in("media_asset_id", mediaIds).is("processed_at", null)
  ]);
  const queuedIds = new Set((queued ?? []).map((row) => row.media_asset_id));
  const assetById = new Map((assets ?? []).filter((asset) =>
    !queuedIds.has(asset.id) && Boolean(asset.duration_ms) && isSupportedVoiceContentType(asset.content_type)
  ).map((asset) => [asset.id, asset]));
  for (const message of messages) {
    const asset = assetById.get(message.media_id!);
    if (!asset?.duration_ms) continue;
    const messageWaveform = validateVoiceWaveform(message.waveform_data);
    if (!messageWaveform.valid) continue;
    byMessageId.set(message.id, {
      mediaId: message.media_id!,
      durationMs: asset.duration_ms!,
      waveform: messageWaveform.waveform
    });
  }
  return byMessageId;
}
