"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { guardAction } from "@/lib/admin/enforcement";
import { uploadValidationMessage, validateImageUpload } from "@/lib/media/validation";
import { MAX_PROFILE_PHOTOS, nextPhotoSlot } from "@/lib/profile/profile-photos";
import { consumeRateLimit, rateLimitMessage } from "@/lib/security/rate-limit";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import type { MediaContentType } from "@/lib/supabase/database.types";
import { getSupabaseServerEnv } from "@/lib/supabase/env";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * Extra profile photos.
 *
 * Three beyond the avatar, each with its own visibility. The avatar itself is
 * untouched — it stays on `profiles.avatar_url` and remains the identity used
 * across the product.
 *
 * Uploads reuse the `profile` media context rather than adding a new one:
 * these are the same kind of picture, doing the same job, under the same
 * retention. A separate context would be a distinction with no difference.
 */

type ActionState = { ok: boolean; message: string };

const visibilitySchema = z.object({
  photoId: z.string().uuid(),
  visibility: z.enum(["everyone", "approved_muddies", "only_me"])
});

const deleteSchema = z.object({ photoId: z.string().uuid() });

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
 * Add a photo to the gallery.
 *
 * The slot is chosen server-side from what is actually free, never sent by
 * the client: a client-supplied position could overwrite an existing photo or
 * claim a slot beyond the cap.
 */
export async function addProfilePhotoAction(formData: FormData): Promise<ActionState> {
  if (!serverReady()) {
    return { ok: false, message: "This action needs the server database configuration." };
  }

  const userId = await getAuthedUserId();
  if (!userId) return { ok: false, message: "Log in before uploading." };

  const rateLimit = await consumeRateLimit({ action: "media.upload", userId });
  if (!rateLimit.allowed) return { ok: false, message: rateLimitMessage(rateLimit.resetAt) };

  const admin = createSupabaseAdminClient();

  const guard = await guardAction(admin, { userId, surface: "messaging", control: "media_uploads" });
  if (!guard.allowed) return { ok: false, message: guard.message };

  // The cap is checked against what exists, not what the client claims.
  const { data: existing } = await admin
    .from("profile_photos")
    .select("id, position, visibility")
    .eq("user_id", userId);
  const slot = nextPhotoSlot(
    (existing ?? []).map((row) => ({
      id: row.id,
      position: row.position,
      url: "",
      visibility: row.visibility as "everyone" | "approved_muddies" | "only_me"
    }))
  );
  if (slot === null) {
    return { ok: false, message: `You can add up to ${MAX_PROFILE_PHOTOS} photos. Remove one first.` };
  }

  const file = formData.get("media");
  if (!(file instanceof File)) return { ok: false, message: "Choose a photo first." };

  // Magic bytes, never the filename or the claimed MIME type alone.
  const headerBytes = new Uint8Array(await file.slice(0, 32).arrayBuffer());
  const validation = validateImageUpload({
    claimedMimeType: file.type,
    headerBytes,
    sizeBytes: file.size,
    context: "profile"
  });
  if (!validation.valid) return { ok: false, message: uploadValidationMessage(validation.reason) };

  const { data: asset, error: assetError } = await admin
    .from("media_assets")
    .insert({
      owner_id: userId,
      storage_key: `pending/${userId}/${Date.now()}`,
      content_type: validation.mimeType as MediaContentType,
      size_bytes: file.size,
      context_type: "profile",
      processing_status: "pending"
    })
    .select("id")
    .single();
  if (assetError || !asset) return { ok: false, message: "Couldn't prepare the upload." };

  const { storageKeyFor } = await import("@/lib/media/validation");
  const key = storageKeyFor({ ownerId: userId, context: "profile", mediaId: asset.id, kind: validation.kind });
  const removeFailedUpload = async (paths: string[] = []) => {
    if (paths.length > 0) await admin.storage.from("media").remove(paths);
    await admin.from("media_assets").delete().eq("id", asset.id).eq("owner_id", userId);
  };

  // EXIF (including GPS) is stripped before anything reaches storage — the
  // stored original is already the metadata-free re-encode.
  let processed;
  try {
    const { processImageUpload } = await import("@/lib/media/processing");
    processed = await processImageUpload(Buffer.from(await file.arrayBuffer()), validation.kind);
  } catch {
    await removeFailedUpload();
    return { ok: false, message: "That image couldn't be processed. Try a different photo." };
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
    return { ok: false, message: "Couldn't upload that photo. Try again." };
  }

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
    return { ok: false, message: "Couldn't finish processing that photo. Try again." };
  }

  const { error: photoError } = await admin.from("profile_photos").insert({
    user_id: userId,
    media_asset_id: asset.id,
    position: slot
    // visibility defaults to approved_muddies in the schema: the safer answer
    // for someone who never opens the setting.
  });
  if (photoError) {
    await removeFailedUpload([key, ...variantRows.map((row) => row.key)]);
    return { ok: false, message: "Couldn't add that photo. Try again." };
  }

  revalidatePath("/profile");
  return { ok: true, message: "Photo added." };
}

/** Change who can see one photo. Scoped to the caller's own rows. */
export async function setProfilePhotoVisibilityAction(input: unknown): Promise<ActionState> {
  if (!serverReady()) {
    return { ok: false, message: "This action needs the server database configuration." };
  }

  const parsed = visibilitySchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Not available." };

  const userId = await getAuthedUserId();
  if (!userId) return { ok: false, message: "Log in first." };

  const { error } = await createSupabaseAdminClient()
    .from("profile_photos")
    .update({ visibility: parsed.data.visibility, updated_at: new Date().toISOString() })
    .eq("id", parsed.data.photoId)
    // Their own photo, always. Without this a valid id from anywhere would do.
    .eq("user_id", userId);

  if (error) return { ok: false, message: "Couldn't update that photo. Try again." };

  revalidatePath("/profile");
  return { ok: true, message: "Updated." };
}

/**
 * Remove a photo.
 *
 * Deletes the row; the media asset follows through the existing retention
 * sweep rather than being torn down inline, so a slow storage call cannot
 * leave the gallery showing a photo the user already removed.
 */
export async function deleteProfilePhotoAction(input: unknown): Promise<ActionState> {
  if (!serverReady()) {
    return { ok: false, message: "This action needs the server database configuration." };
  }

  const parsed = deleteSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Not available." };

  const userId = await getAuthedUserId();
  if (!userId) return { ok: false, message: "Log in first." };

  const admin = createSupabaseAdminClient();
  const { data: photo } = await admin
    .from("profile_photos")
    .select("media_asset_id")
    .eq("id", parsed.data.photoId)
    .eq("user_id", userId)
    .maybeSingle();

  const { error } = await admin
    .from("profile_photos")
    .delete()
    .eq("id", parsed.data.photoId)
    .eq("user_id", userId);
  if (error) return { ok: false, message: "Couldn't remove that photo. Try again." };

  // Queue the asset for deletion through the existing sweep.
  if (photo?.media_asset_id) {
    await admin
      .from("media_assets")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", photo.media_asset_id)
      .eq("owner_id", userId);
  }

  revalidatePath("/profile");
  return { ok: true, message: "Photo removed." };
}
