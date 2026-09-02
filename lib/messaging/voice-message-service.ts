import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { resolveUserEntitlements } from "@/lib/billing/service";
import { isSupportedVoiceContentType } from "@/lib/media/audio-inspection";
import { MAX_UPLOAD_BYTES } from "@/lib/media/validation";
import { messageAttachmentCanBeSigned } from "@/lib/messaging/attachment-retention";
import {
  canCreateDirectConversation,
  resolveConversationAccess,
  type ConversationAccess
} from "@/lib/messaging/service";
import type { PreparedVoiceAsset } from "@/lib/messaging/voice-playback";
import { validateVoiceWaveform } from "@/lib/messaging/voice-waveform";
import type { createSupabaseAdminClient } from "@/lib/supabase/admin";

type Admin = ReturnType<typeof createSupabaseAdminClient>;

type VoiceMessageRowV4 = {
  id: string;
  sender_id: string | null;
  media_id: string | null;
  duration_seconds: number | null;
  waveform_data: unknown;
  status: string;
  deleted_at: string | null;
  created_at: string;
  expires_at: string | null;
  kept_at: string | null;
};

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

/**
 * Temporary type bridge until the unapplied Chats V4 migration is reconciled
 * with the other backend branch and database.types.ts is regenerated.
 *
 * Runtime rich-media kinds are deliberately returned through this legacy
 * projection so the canonical send path can write `video` / `file` after the
 * migration is applied, while today's generated Supabase MessageType still
 * describes only the production schema. Do not remove the runtime guards or
 * use this as a reason to skip final type regeneration.
 */
export type SendableMessageMedia =
  | { kind: "image" }
  | { kind: "voice_note"; durationMs: number; durationSeconds: number; waveform: number[] | null };

type PendingRichSendable =
  | { kind: "video"; contentType: string; fileName: string; sizeBytes: number }
  | { kind: "file"; contentType: string; fileName: string; sizeBytes: number };

function pendingRichMedia(value: PendingRichSendable): SendableMessageMedia {
  return value as unknown as SendableMessageMedia;
}

/** Revalidates critical READY-asset state immediately before a message insert. */
export async function resolveSendableMessageMedia(
  admin: Admin,
  userId: string,
  conversationId: string,
  mediaId: string
): Promise<SendableMessageMedia | null> {
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
    resolved = pendingRichMedia({ kind: "video", contentType, fileName: safeFileName || "Video", sizeBytes });
  } else if (asset.intended_media_kind === "file") {
    if (!DOCUMENT_TYPES.has(contentType) || sizeBytes <= 0 || sizeBytes > MAX_UPLOAD_BYTES.chat) return null;
    resolved = pendingRichMedia({ kind: "file", contentType, fileName: safeFileName || "Document", sizeBytes });
  } else {
    if (asset.intended_media_kind !== "voice_note" || !isSupportedVoiceContentType(contentType)) return null;
    const durationMs = Number(asset.duration_ms ?? 0);
    if (durationMs <= 0) return null;
    const waveform = validateVoiceWaveform(asset.waveform_data);
    if (!waveform.valid) return null;
    const entitlements = await resolveUserEntitlements(admin, userId);
    if (!entitlements.voice_notes || asset.duration_ms > entitlements.max_voice_note_seconds * 1_000) return null;
    resolved = {
      kind: "voice_note",
      durationMs,
      durationSeconds: Math.max(1, Math.ceil(durationMs / 1_000)),
      waveform: waveform.waveform
    };
  }

  const previousUpdatedAtMs = Date.parse(String(asset.updated_at));
  const claimedAt = new Date(Math.max(Date.now(), Number.isFinite(previousUpdatedAtMs) ? previousUpdatedAtMs + 1 : 0)).toISOString();
  const { data: claimed, error: claimError } = await admin.from("media_assets")
    .update({ updated_at: claimedAt })
    .eq("id", mediaId)
    .eq("updated_at", asset.updated_at)
    .eq("processing_status", "ready")
    .eq("moderation_status", "active")
    .is("deleted_at", null)
    .select("id")
    .maybeSingle();
  return claimError || !claimed ? null : resolved;
}

/**
 * Produces safe, URL-free voice projections from authorized parent messages.
 * Expired, unkept messages are filtered before any playback metadata reaches
 * the browser, so a delayed cleanup worker never re-opens an expired voice.
 */
export async function projectVoiceMessages(
  admin: Admin,
  viewerId: string,
  conversationId: string,
  messageIds: readonly string[],
  /** See `signAttachmentsForMessages`: same-request reuse only, never cached. */
  precomputedAccess?: ConversationAccess
): Promise<Map<string, PreparedVoiceAsset>> {
  const byMessageId = new Map<string, PreparedVoiceAsset>();
  const ids = [...new Set(messageIds.filter(Boolean))];
  if (ids.length === 0) return byMessageId;
  const access = precomputedAccess ?? (await resolveConversationAccess(admin, viewerId, conversationId));
  if (!access.canView || access.status !== "active") return byMessageId;
  if (access.conversationType === "direct") {
    const otherId = access.directKey?.split(":").find((id) => id !== viewerId);
    if (!otherId || !(await canCreateDirectConversation(admin, viewerId, otherId)).allowed) return byMessageId;
  }

  const db = admin as unknown as SupabaseClient;
  const { data: rows } = await db
    .from("messages")
    .select("id, sender_id, media_id, duration_seconds, waveform_data, status, deleted_at, created_at, expires_at, kept_at")
    .eq("conversation_id", conversationId)
    .in("id", ids)
    .eq("message_type", "voice_note")
    .gte("created_at", access.historyVisibleFrom ?? new Date(0).toISOString());
  const nowMs = Date.now();
  let messages = ((rows ?? []) as VoiceMessageRowV4[]).filter((row) =>
    Boolean(row.media_id) &&
    Boolean(row.duration_seconds) &&
    messageAttachmentCanBeSigned({ status: row.status as never, deletedAt: row.deleted_at }) &&
    (Boolean(row.kept_at) || !row.expires_at || Date.parse(row.expires_at) > nowMs)
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