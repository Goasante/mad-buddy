"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { guardAction } from "@/lib/admin/enforcement";
import {
  processImageUpload,
  toStorageArrayBuffer,
  variantStorageKey
} from "@/lib/media/processing";
import {
  sniffImageKind,
  storageKeyFor,
  uploadValidationMessage,
  validateImageUpload,
  type ImageKind
} from "@/lib/media/validation";
import { consumeRateLimit, rateLimitMessage } from "@/lib/security/rate-limit";
import {
  activeStoryCount,
  deleteStory,
  loadStoriesForAuthor,
  loadStoryCreationContext,
  loadStorySummariesForAuthors,
  loadStorySummary,
  recordStoryView,
  validateStoryAudienceTargets
} from "@/lib/stories/service";
import {
  STORY_ACTIVE_LIMIT,
  STORY_CAPTION_MAX_LENGTH,
  type StoryAudienceType,
  type StoryCreationContext,
  type StoryItem,
  type StorySummary
} from "@/lib/stories/types";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getSupabaseServerEnv } from "@/lib/supabase/env";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { MediaContentType } from "@/lib/supabase/database.types";

type StoryActionState = {
  ok: boolean;
  message: string;
  storyId?: string;
  activeCount?: number;
  expiresAt?: string;
};

const uuidSchema = z.string().uuid();
const audienceSchema = z.enum(["all_muddies", "close_friends", "selected_muddies"]);

function missingEnvState(): StoryActionState | null {
  const env = getSupabaseServerEnv();
  if (!env.url || !env.serviceRoleKey) {
    return { ok: false, message: "Stories need the server database configuration." };
  }
  return null;
}

async function getAuthedUserId(): Promise<string | null> {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
    error
  } = await supabase.auth.getUser();
  return error || !user ? null : user.id;
}

async function removeStoryUpload(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  ownerId: string,
  mediaId: string,
  paths: string[]
) {
  if (paths.length > 0) await admin.storage.from("media").remove(paths);
  await admin.from("media_assets").delete().eq("id", mediaId).eq("owner_id", ownerId);
}

function storyCreateErrorMessage(message: string | undefined): string {
  if (message?.includes("story_active_limit")) {
    return "You already have 5 active Stories. A new slot opens when your oldest Story expires.";
  }
  if (message?.includes("story_empty_audience") || message?.includes("story_invalid_targets")) {
    return "Choose Muddies who can see this Story and try again.";
  }
  if (message?.includes("story_media_unavailable")) {
    return "That photo is no longer available. Choose it again.";
  }
  return "Couldn't share your Story. Try again.";
}

export async function createStoryAction(formData: FormData): Promise<StoryActionState> {
  const missing = missingEnvState();
  if (missing) return missing;

  const userId = await getAuthedUserId();
  if (!userId) return { ok: false, message: "Log in before sharing a Story." };

  const admin = createSupabaseAdminClient();
  const guard = await guardAction(admin, { userId, surface: "moments", control: "media_uploads" });
  if (!guard.allowed) return { ok: false, message: guard.message };

  // Cheap limit check BEFORE image processing. The database RPC repeats this
  // transactionally, so this is only a fast path that avoids wasted upload work.
  const currentCount = await activeStoryCount(admin, userId);
  if (currentCount >= STORY_ACTIVE_LIMIT) {
    return {
      ok: false,
      activeCount: currentCount,
      message: "You already have 5 active Stories. A new slot opens when your oldest Story expires."
    };
  }

  const captionValue = formData.get("caption");
  const audienceValue = formData.get("audienceType");
  const rawTargets = formData.getAll("targetId").filter((value): value is string => typeof value === "string");
  const parsed = z
    .object({
      caption: z.string().max(STORY_CAPTION_MAX_LENGTH),
      audienceType: audienceSchema,
      targetIds: z.array(uuidSchema).max(50)
    })
    .safeParse({
      caption: typeof captionValue === "string" ? captionValue.trim() : "",
      audienceType: audienceValue,
      targetIds: rawTargets
    });

  if (!parsed.success) return { ok: false, message: "Check the Story details and try again." };
  const audienceType = parsed.data.audienceType as StoryAudienceType;
  const targetIds = [...new Set(parsed.data.targetIds)];

  if (!(await validateStoryAudienceTargets(admin, userId, audienceType, targetIds))) {
    return { ok: false, message: "Choose an available Story audience and try again." };
  }

  const uploadLimit = await consumeRateLimit({ action: "media.upload", userId });
  if (!uploadLimit.allowed) return { ok: false, message: rateLimitMessage(uploadLimit.resetAt) };

  const file = formData.get("media");
  if (!(file instanceof File)) return { ok: false, message: "Choose a photo first." };

  const headerBytes = new Uint8Array(await file.slice(0, 32).arrayBuffer());
  const validation = validateImageUpload({
    claimedMimeType: file.type,
    headerBytes,
    sizeBytes: file.size,
    context: "moment"
  });
  if (!validation.valid) return { ok: false, message: uploadValidationMessage(validation.reason) };

  const uploadExpiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString();
  const { data: asset, error: assetError } = await admin
    .from("media_assets")
    .insert({
      owner_id: userId,
      storage_key: `pending/${userId}/${Date.now()}`,
      content_type: validation.mimeType as MediaContentType,
      size_bytes: file.size,
      context_type: "moment",
      processing_status: "pending",
      intended_media_kind: "image",
      upload_expires_at: uploadExpiresAt
    })
    .select("id")
    .single();

  if (assetError || !asset) return { ok: false, message: "Couldn't prepare that photo." };

  const key = storageKeyFor({
    ownerId: userId,
    context: "moment",
    mediaId: asset.id,
    kind: validation.kind
  });

  let processed;
  try {
    processed = await processImageUpload(Buffer.from(await file.arrayBuffer()), validation.kind as ImageKind);
  } catch {
    await removeStoryUpload(admin, userId, asset.id, []);
    return { ok: false, message: "That image couldn't be processed. Try a different photo." };
  }

  // Stories never need a camera-resolution original. The 1080px processed
  // image is the canonical stored file; the only extra object is a thumbnail.
  // signMediaForAsset("feed") safely falls back to this canonical key when no
  // separate feed variant exists, so viewing quality stays the same while
  // duplicate Story storage disappears.
  const storyImage = processed.variants.feed;
  const { error: uploadError } = await admin.storage
    .from("media")
    .upload(key, toStorageArrayBuffer(storyImage.buffer), {
      contentType: validation.mimeType,
      upsert: false
    });

  if (uploadError) {
    await removeStoryUpload(admin, userId, asset.id, []);
    return { ok: false, message: "Couldn't upload that photo. Try again." };
  }

  const variantRows: Array<{
    variant: "thumb";
    key: string;
    image: (typeof processed.variants)["thumb"];
  }> = [
    { variant: "thumb", key: variantStorageKey(key, "thumb"), image: processed.variants.thumb }
  ];

  const uploadedVariantPaths: string[] = [];
  await Promise.all(
    variantRows.map(async ({ variant, key: variantKey, image }) => {
      const { error } = await admin.storage
        .from("media")
        .upload(variantKey, toStorageArrayBuffer(image.buffer), {
          contentType: validation.mimeType,
          upsert: false
        });
      if (error) return;
      uploadedVariantPaths.push(variantKey);
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

  // Verify the stored object before marking it ready. A transformed request
  // body must never become a Story merely because Storage acknowledged it.
  const { data: storedOriginal, error: verifyError } = await admin.storage.from("media").download(key);
  const storedKind = storedOriginal
    ? sniffImageKind(new Uint8Array(await storedOriginal.slice(0, 12).arrayBuffer()))
    : null;
  if (verifyError || storedKind !== validation.kind) {
    await removeStoryUpload(admin, userId, asset.id, [key, ...uploadedVariantPaths]);
    return { ok: false, message: "That photo was not stored correctly. Please try again." };
  }

  const { error: readyError } = await admin
    .from("media_assets")
    .update({
      storage_key: key,
      processing_status: "ready",
      width: storyImage.width,
      height: storyImage.height,
      size_bytes: storyImage.buffer.byteLength,
      updated_at: new Date().toISOString()
    })
    .eq("id", asset.id)
    .eq("owner_id", userId);

  if (readyError) {
    await removeStoryUpload(admin, userId, asset.id, [key, ...uploadedVariantPaths]);
    return { ok: false, message: "Couldn't finish preparing that photo. Try again." };
  }

  const { data: created, error: createError } = await admin.rpc("create_story", {
    p_actor_id: userId,
    p_media_id: asset.id,
    p_caption: parsed.data.caption,
    p_audience_type: audienceType,
    p_target_ids: audienceType === "selected_muddies" ? targetIds : []
  });
  const row = created?.[0];

  if (createError || !row) {
    // A network failure can arrive after the transaction committed. Check by
    // the media id before compensating so an acknowledged Story is never left
    // pointing at media we deleted underneath it.
    const { data: existing } = await admin
      .from("moments")
      .select("id, expires_at")
      .eq("author_id", userId)
      .eq("media_id", asset.id)
      .eq("surface", "story")
      .maybeSingle();

    if (existing) {
      const activeCountNow = await activeStoryCount(admin, userId);
      revalidatePath("/profile");
      revalidatePath("/friends");
      return {
        ok: true,
        message: "Story shared.",
        storyId: existing.id,
        expiresAt: existing.expires_at,
        activeCount: activeCountNow
      };
    }

    await removeStoryUpload(admin, userId, asset.id, [key, ...uploadedVariantPaths]);
    return {
      ok: false,
      activeCount: await activeStoryCount(admin, userId),
      message: storyCreateErrorMessage(createError?.message)
    };
  }

  revalidatePath("/profile");
  revalidatePath("/friends");
  return {
    ok: true,
    message: "Story shared for 12 hours.",
    storyId: row.story_id,
    expiresAt: row.story_expires_at,
    activeCount: row.active_count
  };
}

export async function getStorySummaryAction(authorId: string): Promise<StorySummary | null> {
  if (!uuidSchema.safeParse(authorId).success) return null;
  const userId = await getAuthedUserId();
  if (!userId) return null;
  return loadStorySummary(createSupabaseAdminClient(), userId, authorId);
}

export async function getStorySummariesAction(
  authorIds: string[]
): Promise<Record<string, StorySummary>> {
  const parsed = z.array(uuidSchema).max(100).safeParse(authorIds);
  if (!parsed.success || parsed.data.length === 0) return {};
  const userId = await getAuthedUserId();
  if (!userId) return {};
  return loadStorySummariesForAuthors(
    createSupabaseAdminClient(),
    userId,
    [...new Set(parsed.data)]
  );
}

export async function getStoriesForAuthorAction(authorId: string): Promise<StoryItem[]> {
  if (!uuidSchema.safeParse(authorId).success) return [];
  const userId = await getAuthedUserId();
  if (!userId) return [];
  return loadStoriesForAuthor(createSupabaseAdminClient(), userId, authorId);
}

export async function recordStoryViewAction(storyId: string): Promise<boolean> {
  if (!uuidSchema.safeParse(storyId).success) return false;
  const userId = await getAuthedUserId();
  if (!userId) return false;
  return recordStoryView(createSupabaseAdminClient(), userId, storyId);
}

export async function deleteStoryAction(storyId: string): Promise<StoryActionState> {
  if (!uuidSchema.safeParse(storyId).success) return { ok: false, message: "That Story isn't available." };
  const userId = await getAuthedUserId();
  if (!userId) return { ok: false, message: "Log in first." };

  const ok = await deleteStory(createSupabaseAdminClient(), userId, storyId);
  if (!ok) return { ok: false, message: "Couldn't delete that Story." };

  revalidatePath("/profile");
  revalidatePath("/friends");
  return {
    ok: true,
    message: "Story deleted.",
    activeCount: await activeStoryCount(createSupabaseAdminClient(), userId)
  };
}

export async function getStoryCreationContextAction(): Promise<StoryCreationContext> {
  const userId = await getAuthedUserId();
  if (!userId) return { muddies: [], closeFriendsAvailable: false };
  return loadStoryCreationContext(createSupabaseAdminClient(), userId);
}
