import "server-only";

import { createChatUploadIntent, finalizeChatUpload } from "@/lib/media/chat-upload-service";
import type { createSupabaseAdminClient } from "@/lib/supabase/admin";

type Admin = ReturnType<typeof createSupabaseAdminClient>;

/** Copy into a new sender-owned, destination-bound asset. Never rebind the original. */
export async function prepareForwardedMedia(
  admin: Admin,
  userId: string,
  input: { mediaId: string; sourceConversationId: string; conversationId: string; mediaKind: "image" | "voice_note" }
): Promise<{ ok: true; mediaId: string } | { ok: false; message: string }> {
  const unavailable = { ok: false as const, message: "That attachment is no longer available to forward." };
  const { data: asset, error } = await admin.from("media_assets")
    .select("id, storage_key, content_type, size_bytes, duration_ms, waveform_data")
    .eq("id", input.mediaId)
    .eq("context_type", "chat")
    .eq("intended_conversation_id", input.sourceConversationId)
    .eq("intended_media_kind", input.mediaKind)
    .eq("processing_status", "ready")
    .eq("moderation_status", "active")
    .is("deleted_at", null)
    .maybeSingle();
  if (error || !asset) return unavailable;
  const { data: queued, error: queueError } = await admin.from("media_deletion_queue")
    .select("id").eq("media_asset_id", asset.id).is("processed_at", null).limit(1).maybeSingle();
  if (queueError || queued) return unavailable;

  const prepared = await createChatUploadIntent(admin, userId, {
    conversationId: input.conversationId,
    contentType: asset.content_type,
    sizeBytes: asset.size_bytes,
    mediaKind: input.mediaKind
  });
  if (!prepared.ok) return prepared;
  const { intent } = prepared;
  // The usual finalizer verifies bytes and voice duration and builds image
  // variants. Independent storage also keeps source deletion from breaking a forward.
  const { error: copyError } = await admin.storage.from("media").copy(asset.storage_key, intent.path);
  if (copyError) return { ok: false, message: "Could not copy the attachment. Try again." };
  const finalized = await finalizeChatUpload(admin, userId, {
    conversationId: input.conversationId,
    mediaId: intent.mediaId,
    expectedMediaKind: input.mediaKind,
    waveform: asset.waveform_data,
    clientDurationMs: asset.duration_ms ?? undefined
  });
  if (!finalized.ok) return finalized;
  // Failed/unattached copies follow the existing orphan-upload cleanup path.
  return { ok: true, mediaId: finalized.mediaId };
}
