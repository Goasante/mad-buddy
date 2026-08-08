import "server-only";

import { signMediaForAsset } from "@/lib/content/service";
import { ATTACHMENT_CONTENT_TYPES } from "@/lib/messaging/attachments";
import { canSendMessage } from "@/lib/messaging/service";
import { CHAT_UPLOAD_INTENT_TTL_MS } from "@/lib/media/constants";
import { processImageUpload, toStorageArrayBuffer, variantStorageKey } from "@/lib/media/processing";
import {
  MAX_UPLOAD_BYTES,
  kindForMimeType,
  sniffImageKind,
  storageKeyFor,
  uploadValidationMessage,
  validateImageUpload
} from "@/lib/media/validation";
import type { createSupabaseAdminClient } from "@/lib/supabase/admin";
import type { MediaContentType } from "@/lib/supabase/database.types";

type Admin = ReturnType<typeof createSupabaseAdminClient>;

export type ChatUploadIntent = {
  mediaId: string;
  path: string;
  token: string;
  signedUrl: string;
  expiresAt: string;
};

export type ChatUploadResult =
  | { ok: true; intent: ChatUploadIntent }
  | { ok: false; message: string };

export type ChatFinalizeResult =
  | { ok: true; mediaId: string; previewUrl: string | null }
  | { ok: false; message: string };

/** Creates a server-owned, conversation-bound pending asset and upload target. */
export async function createChatUploadIntent(
  admin: Admin,
  userId: string,
  input: { conversationId: string; contentType: string; sizeBytes: number }
): Promise<ChatUploadResult> {
  const permission = await canSendMessage(admin, userId, input.conversationId);
  if (!permission.allowed) return { ok: false, message: "That conversation isn't available." };
  if (!(ATTACHMENT_CONTENT_TYPES as readonly string[]).includes(input.contentType)) {
    return { ok: false, message: "Upload a JPG, JPEG, PNG, or WebP image." };
  }
  if (!Number.isSafeInteger(input.sizeBytes) || input.sizeBytes <= 0) {
    return { ok: false, message: "Choose a photo first." };
  }
  if (input.sizeBytes > MAX_UPLOAD_BYTES.chat) {
    return { ok: false, message: "That image is too large." };
  }

  const kind = kindForMimeType(input.contentType);
  if (!kind || kind === "heic") return { ok: false, message: "That image type isn't supported here." };

  const mediaId = crypto.randomUUID();
  const path = storageKeyFor({ ownerId: userId, context: "chat", mediaId, kind });
  const expiresAt = new Date(Date.now() + CHAT_UPLOAD_INTENT_TTL_MS).toISOString();
  const { error: assetError } = await admin.from("media_assets").insert({
    id: mediaId,
    owner_id: userId,
    storage_key: path,
    content_type: input.contentType as MediaContentType,
    size_bytes: input.sizeBytes,
    context_type: "chat",
    intended_conversation_id: input.conversationId,
    upload_expires_at: expiresAt,
    processing_status: "pending"
  });
  if (assetError) return { ok: false, message: "Couldn't prepare the upload." };

  const { data, error } = await admin.storage.from("media").createSignedUploadUrl(path, { upsert: false });
  if (error || !data) {
    await admin.from("media_assets").delete().eq("id", mediaId).eq("owner_id", userId);
    return { ok: false, message: "Couldn't prepare the upload." };
  }

  return {
    ok: true,
    intent: { mediaId, path: data.path, token: data.token, signedUrl: data.signedUrl, expiresAt }
  };
}
/** Validates the stored bytes, strips metadata, creates variants, then marks ready. */
export async function finalizeChatUpload(
  admin: Admin,
  userId: string,
  input: { conversationId: string; mediaId: string }
): Promise<ChatFinalizeResult> {
  const permission = await canSendMessage(admin, userId, input.conversationId);
  if (!permission.allowed) return { ok: false, message: "That conversation isn't available." };

  const { data: asset } = await admin
    .from("media_assets")
    .select("id, owner_id, storage_key, content_type, processing_status, intended_conversation_id, upload_expires_at")
    .eq("id", input.mediaId)
    .eq("owner_id", userId)
    .eq("context_type", "chat")
    .maybeSingle();
  if (!asset || asset.intended_conversation_id !== input.conversationId) {
    return { ok: false, message: "That upload isn't available." };
  }
  if (asset.processing_status === "ready") {
    return { ok: true, mediaId: asset.id, previewUrl: await signMediaForAsset(admin, asset.id, "thumb") };
  }
  if (asset.processing_status !== "pending") {
    return { ok: false, message: "That upload cannot be finalized." };
  }
  if (asset.upload_expires_at && Date.parse(asset.upload_expires_at) < Date.now()) {
    return { ok: false, message: "That upload expired. Choose the photo again." };
  }

  const { data: claimed } = await admin
    .from("media_assets")
    .update({ processing_status: "processing", updated_at: new Date().toISOString() })
    .eq("id", asset.id)
    .eq("owner_id", userId)
    .eq("processing_status", "pending")
    .select("id")
    .maybeSingle();
  if (!claimed) return { ok: false, message: "That upload is already being processed." };

  const variantKeys = [variantStorageKey(asset.storage_key, "thumb"), variantStorageKey(asset.storage_key, "feed")];
  const removeFailedUpload = async () => {
    await admin.storage.from("media").remove([asset.storage_key, ...variantKeys]);
    await admin.from("media_assets").delete().eq("id", asset.id).eq("owner_id", userId);
  };

  const { data: raw, error: downloadError } = await admin.storage.from("media").download(asset.storage_key);
  if (downloadError || !raw) {
    await removeFailedUpload();
    return { ok: false, message: "The upload could not be read. Try again." };
  }

  const headerBytes = new Uint8Array(await raw.slice(0, 32).arrayBuffer());
  const validation = validateImageUpload({
    claimedMimeType: asset.content_type,
    headerBytes,
    sizeBytes: raw.size,
    context: "chat"
  });
  if (!validation.valid) {
    await removeFailedUpload();
    return { ok: false, message: uploadValidationMessage(validation.reason) };
  }

  let processed;
  try {
    processed = await processImageUpload(Buffer.from(await raw.arrayBuffer()), validation.kind);
  } catch {
    await removeFailedUpload();
    return { ok: false, message: "That image couldn't be processed. Try a different photo." };
  }

  const { error: originalError } = await admin.storage
    .from("media")
    .upload(asset.storage_key, toStorageArrayBuffer(processed.original.buffer), {
      contentType: validation.mimeType,
      upsert: true
    });
  if (originalError) {
    await removeFailedUpload();
    return { ok: false, message: "Couldn't finish that upload. Try again." };
  }

  const variants = [
    { type: "thumb" as const, key: variantKeys[0], image: processed.variants.thumb },
    { type: "feed" as const, key: variantKeys[1], image: processed.variants.feed }
  ];
  for (const variant of variants) {
    const { error } = await admin.storage.from("media").upload(
      variant.key,
      toStorageArrayBuffer(variant.image.buffer),
      { contentType: validation.mimeType, upsert: true }
    );
    if (error) continue;
    await admin.from("media_variants").upsert(
      {
        media_asset_id: asset.id,
        variant_type: variant.type,
        storage_key: variant.key,
        width: variant.image.width,
        height: variant.image.height,
        size_bytes: variant.image.buffer.byteLength
      },
      { onConflict: "media_asset_id,variant_type" }
    );
  }

  const { data: storedOriginal, error: verifyError } = await admin.storage.from("media").download(asset.storage_key);
  const storedKind = storedOriginal
    ? sniffImageKind(new Uint8Array(await storedOriginal.slice(0, 12).arrayBuffer()))
    : null;
  if (verifyError || storedKind !== validation.kind) {
    await removeFailedUpload();
    return { ok: false, message: "That photo was not stored correctly. Please try again." };
  }

  const { error: readyError } = await admin
    .from("media_assets")
    .update({
      content_type: validation.mimeType as MediaContentType,
      processing_status: "ready",
      width: processed.original.width,
      height: processed.original.height,
      size_bytes: processed.original.buffer.byteLength,
      upload_expires_at: null,
      updated_at: new Date().toISOString()
    })
    .eq("id", asset.id)
    .eq("owner_id", userId)
    .eq("processing_status", "processing");
  if (readyError) {
    await removeFailedUpload();
    return { ok: false, message: "Couldn't finish processing that photo. Try again." };
  }

  return { ok: true, mediaId: asset.id, previewUrl: await signMediaForAsset(admin, asset.id, "thumb") };
}
