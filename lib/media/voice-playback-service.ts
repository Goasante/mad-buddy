import "server-only";

import { canSendMessage } from "@/lib/messaging/service";
import { validateVoiceWaveform } from "@/lib/messaging/voice-waveform";
import type { AuthorizedVoicePlayback } from "@/lib/messaging/voice-playback";
import { MEDIA_SIGNED_URL_TTL_SECONDS, mediaSignedUrlExpiresAt } from "@/lib/media/constants";
import type { createSupabaseAdminClient } from "@/lib/supabase/admin";

type Admin = ReturnType<typeof createSupabaseAdminClient>;

/**
 * Authorizes an unsent, prepared voice asset through its parent conversation
 * before minting a short-lived private playback URL. Storage keys never leave
 * this service.
 */
export async function getPreparedVoicePlayback(
  admin: Admin,
  userId: string,
  input: { conversationId: string; mediaId: string }
): Promise<AuthorizedVoicePlayback | null> {
  const permission = await canSendMessage(admin, userId, input.conversationId);
  if (!permission.allowed) return null;

  const { data: asset } = await admin
    .from("media_assets")
    .select("id, owner_id, storage_key, content_type, duration_ms, waveform_data")
    .eq("id", input.mediaId)
    .eq("owner_id", userId)
    .eq("context_type", "chat")
    .eq("intended_conversation_id", input.conversationId)
    .eq("intended_media_kind", "voice_note")
    .eq("processing_status", "ready")
    .eq("moderation_status", "active")
    .is("deleted_at", null)
    .maybeSingle();
  if (!asset || !asset.duration_ms || !["audio/webm", "audio/mp4"].includes(asset.content_type)) return null;

  const { data: queued } = await admin
    .from("media_deletion_queue")
    .select("id")
    .eq("media_asset_id", asset.id)
    .is("processed_at", null)
    .limit(1)
    .maybeSingle();
  if (queued) return null;

  const { data, error } = await admin.storage
    .from("media")
    .createSignedUrl(asset.storage_key, MEDIA_SIGNED_URL_TTL_SECONDS);
  if (error || !data?.signedUrl) return null;

  const waveform = validateVoiceWaveform(asset.waveform_data);
  return {
    mediaId: asset.id,
    url: data.signedUrl,
    expiresAt: mediaSignedUrlExpiresAt(),
    contentType: asset.content_type as AuthorizedVoicePlayback["contentType"],
    durationMs: asset.duration_ms,
    waveform: waveform.valid ? waveform.waveform : null
  };
}
