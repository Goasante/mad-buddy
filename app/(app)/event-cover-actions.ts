"use server";

import { z } from "zod";

import { guardAction } from "@/lib/admin/enforcement";
import {
  canPublishEvent,
  checkCoverAsset,
  clampFocal,
  coverDimensionError,
  coverRejectionMessage
} from "@/lib/events/cover";
import { uploadValidationMessage, validateImageUpload } from "@/lib/media/validation";
import { consumeRateLimit, rateLimitMessage } from "@/lib/security/rate-limit";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import type { MediaContentType } from "@/lib/supabase/database.types";
import { getSupabaseServerEnv } from "@/lib/supabase/env";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * Event cover artwork (Stage F, Part A).
 *
 * Reuses the CANONICAL media pipeline -- the same one profile photos, Moments
 * and group images use: magic-byte validation, a pending media_assets row,
 * EXIF-stripped re-encode, storage upload, variants, then mark ready. There
 * is no second upload stack here, and no second definition of what a safe
 * image is.
 *
 * The `event` media context already existed (15 MB cap, listed in the
 * media_assets context_type check) before this stage; only the pointer from
 * events.cover_media_id was missing.
 */

type ActionState = { ok: boolean; message: string; mediaId?: string };

const uuidSchema = z.string().uuid();

const focalSchema = z.object({
  eventId: uuidSchema,
  focalX: z.number(),
  focalY: z.number()
});

async function getAuthedUserId(): Promise<string | null> {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
    error
  } = await supabase.auth.getUser();
  return error || !user ? null : user.id;
}

function serverReady(): boolean {
  const env = getSupabaseServerEnv();
  return Boolean(env.url && env.serviceRoleKey);
}

/**
 * Upload (or replace) an event's cover.
 *
 * REPLACEMENT IS NON-DESTRUCTIVE (§9). The new asset is uploaded, processed
 * and marked ready BEFORE events.cover_media_id moves. If any step fails the
 * event still points at its previous artwork, so a failed replacement can
 * never leave a published event with a broken ranked card. The old asset is
 * soft-deleted only after the pointer has successfully moved, and is left to
 * the canonical retention/orphan path rather than being hard-deleted here.
 */
export async function uploadEventCoverAction(formData: FormData): Promise<ActionState> {
  if (!serverReady()) {
    return { ok: false, message: "This action needs the server database configuration." };
  }

  const userId = await getAuthedUserId();
  if (!userId) return { ok: false, message: "Log in first." };

  const eventId = formData.get("eventId");
  if (typeof eventId !== "string" || !uuidSchema.safeParse(eventId).success) {
    return { ok: false, message: "Event not found." };
  }

  const rateLimit = await consumeRateLimit({ action: "media.upload", userId });
  if (!rateLimit.allowed) return { ok: false, message: rateLimitMessage(rateLimit.resetAt) };

  const admin = createSupabaseAdminClient();

  const guard = await guardAction(admin, { userId, surface: "messaging", control: "media_uploads" });
  if (!guard.allowed) return { ok: false, message: guard.message };

  // Only the host may set their own event's cover. Checked against the row,
  // never inferred from what the client sent.
  const { data: event } = await admin
    .from("events")
    .select("id, host_id, cover_media_id")
    .eq("id", eventId)
    .maybeSingle();
  if (!event) return { ok: false, message: "Event not found." };
  if (event.host_id !== userId) return { ok: false, message: "Only the host can change the cover." };

  const file = formData.get("media");
  if (!(file instanceof File)) return { ok: false, message: "Choose an image first." };

  // Magic bytes, never the filename or the claimed MIME type alone.
  const headerBytes = new Uint8Array(await file.slice(0, 32).arrayBuffer());
  const validation = validateImageUpload({
    claimedMimeType: file.type,
    headerBytes,
    sizeBytes: file.size,
    context: "event"
  });
  if (!validation.valid) return { ok: false, message: uploadValidationMessage(validation.reason) };

  const { data: asset, error: assetError } = await admin
    .from("media_assets")
    .insert({
      owner_id: userId,
      storage_key: `pending/${userId}/${Date.now()}`,
      content_type: validation.mimeType as MediaContentType,
      size_bytes: file.size,
      context_type: "event",
      processing_status: "pending"
    })
    .select("id")
    .single();
  if (assetError || !asset) return { ok: false, message: "Couldn't prepare the upload." };

  const { storageKeyFor } = await import("@/lib/media/validation");
  const key = storageKeyFor({ ownerId: userId, context: "event", mediaId: asset.id, kind: validation.kind });
  const removeFailedUpload = async (paths: string[] = []) => {
    if (paths.length > 0) await admin.storage.from("media").remove(paths);
    await admin.from("media_assets").delete().eq("id", asset.id).eq("owner_id", userId);
  };

  // EXIF (including GPS) is stripped before anything reaches storage. An
  // event cover is a public image; shipping the host's coordinates inside it
  // would leak a location the product never asked them to share.
  let processed;
  try {
    const { processImageUpload } = await import("@/lib/media/processing");
    processed = await processImageUpload(Buffer.from(await file.arrayBuffer()), validation.kind);
  } catch {
    await removeFailedUpload();
    return { ok: false, message: "That image couldn't be processed. Try a different one." };
  }

  const dimensionError = coverDimensionError(processed.original.width, processed.original.height);
  if (dimensionError) {
    await removeFailedUpload();
    return { ok: false, message: dimensionError };
  }

  const { toStorageArrayBuffer, variantStorageKey } = await import("@/lib/media/processing");
  const { error: uploadError } = await admin.storage
    .from("media")
    .upload(key, toStorageArrayBuffer(processed.original.buffer), {
      contentType: validation.mimeType,
      upsert: false
    });
  if (uploadError) {
    await removeFailedUpload();
    return { ok: false, message: "Couldn't upload that image. Try again." };
  }

  // One source, processed variants (§3, §8): Home and the ranked list never
  // fetch the multi-megabyte original.
  const variantRows = [
    { variant: "thumb" as const, key: variantStorageKey(key, "thumb"), image: processed.variants.thumb },
    { variant: "feed" as const, key: variantStorageKey(key, "feed"), image: processed.variants.feed }
  ];
  await Promise.all(
    variantRows.map(async ({ variant, key: variantKey, image }) => {
      const { error } = await admin.storage.from("media").upload(variantKey, toStorageArrayBuffer(image.buffer), {
        contentType: validation.mimeType,
        upsert: false
      });
      if (error) return;
      await admin.from("media_variants").insert({
        media_asset_id: asset.id,
        variant_type: variant,
        storage_key: variantKey,
        width: image.width,
        height: image.height,
        size_bytes: image.buffer.byteLength
      });
    })
  );

  const { error: readyError } = await admin
    .from("media_assets")
    .update({
      storage_key: key,
      processing_status: "ready",
      width: processed.original.width,
      height: processed.original.height,
      size_bytes: processed.original.buffer.byteLength,
      updated_at: new Date().toISOString()
    })
    .eq("id", asset.id)
    .eq("owner_id", userId);
  if (readyError) {
    await removeFailedUpload([key, ...variantRows.map((row) => row.key)]);
    return { ok: false, message: "Couldn't finish processing that image. Try again." };
  }

  // ONLY NOW does the event's pointer move. Everything above could have
  // failed without the event losing the artwork it already had.
  const previousCoverId = event.cover_media_id;
  const { error: bindError } = await admin
    .from("events")
    .update({ cover_media_id: asset.id, updated_at: new Date().toISOString() })
    .eq("id", eventId)
    .eq("host_id", userId);
  if (bindError) {
    await removeFailedUpload([key, ...variantRows.map((row) => row.key)]);
    return { ok: false, message: "Couldn't attach that image to the Event. Try again." };
  }

  // Soft-delete the replaced asset so the canonical retention path collects
  // it. Deliberately not a hard delete: the pointer has only just moved, and
  // an aggressive delete here is how a CDN-cached card goes blank.
  if (previousCoverId && previousCoverId !== asset.id) {
    await admin
      .from("media_assets")
      .update({ deleted_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq("id", previousCoverId)
      .eq("owner_id", userId);
  }

  return { ok: true, message: "Cover image updated.", mediaId: asset.id };
}

/** Reposition the focal point. No re-upload: one image, many crops (§5). */
export async function setEventCoverFocalAction(input: unknown): Promise<ActionState> {
  if (!serverReady()) {
    return { ok: false, message: "This action needs the server database configuration." };
  }
  const parsed = focalSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Couldn't save that position." };

  const userId = await getAuthedUserId();
  if (!userId) return { ok: false, message: "Log in first." };

  const admin = createSupabaseAdminClient();
  const { error } = await admin
    .from("events")
    .update({
      cover_focal_x: clampFocal(parsed.data.focalX),
      cover_focal_y: clampFocal(parsed.data.focalY),
      updated_at: new Date().toISOString()
    })
    .eq("id", parsed.data.eventId)
    .eq("host_id", userId);
  if (error) return { ok: false, message: "Couldn't save that position." };
  return { ok: true, message: "Position saved." };
}

/**
 * Publish an event (§2, §36) -- the server-authoritative cover gate.
 *
 * This is the rule that stops a published event from relying on the generated
 * fallback. It re-reads the asset rather than trusting that cover_media_id
 * points at something usable: the asset could have been moderated or deleted
 * between upload and publish.
 */
export async function publishEventAction(eventId: string): Promise<ActionState> {
  if (!serverReady()) {
    return { ok: false, message: "This action needs the server database configuration." };
  }
  if (!uuidSchema.safeParse(eventId).success) return { ok: false, message: "Event not found." };

  const userId = await getAuthedUserId();
  if (!userId) return { ok: false, message: "Log in first." };

  const admin = createSupabaseAdminClient();
  const { data: event } = await admin
    .from("events")
    .select("id, host_id, status, cover_media_id")
    .eq("id", eventId)
    .maybeSingle();
  if (!event) return { ok: false, message: "Event not found." };
  if (event.host_id !== userId) return { ok: false, message: "Only the host can publish this Event." };

  const { data: asset } = event.cover_media_id
    ? await admin
        .from("media_assets")
        .select("owner_id, context_type, processing_status, moderation_status, deleted_at")
        .eq("id", event.cover_media_id)
        .maybeSingle()
    : { data: null };

  const decision = canPublishEvent({
    targetStatus: "scheduled",
    cover: checkCoverAsset(
      asset
        ? {
            ownerId: asset.owner_id,
            contextType: asset.context_type,
            processingStatus: asset.processing_status,
            moderationStatus: asset.moderation_status,
            deletedAt: asset.deleted_at
          }
        : null,
      userId
    )
  });
  if (!decision.ok) return { ok: false, message: coverRejectionMessage(decision.reason) };

  const { error } = await admin
    .from("events")
    .update({ status: "scheduled", updated_at: new Date().toISOString() })
    .eq("id", eventId)
    .eq("host_id", userId);
  if (error) return { ok: false, message: "Couldn't publish this Event. Try again." };
  return { ok: true, message: "Event published." };
}
