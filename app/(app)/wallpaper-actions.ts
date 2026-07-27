"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getSupabaseServerEnv } from "@/lib/supabase/env";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { consumeRateLimit, rateLimitMessage } from "@/lib/security/rate-limit";
import { getCurrentSubscriptionAccess } from "@/lib/premium/access";
import {
  loadCustomWallpaperSummary,
  registerCustomWallpaper,
  selectCustomWallpaper,
  setWallpaperSelection
} from "@/lib/wallpapers/service";
import { optimizeWallpaper, toStorageArrayBuffer } from "@/lib/media/processing";
import { sniffImageKind, uploadValidationMessage, validateImageUpload } from "@/lib/media/validation";
import { recordProductEvent } from "@/lib/analytics/track";

// NOTE: per project rule, a "use server" module must not export types — every
// action returns a structural { ok, message, upgrade? } object the client types
// on its own side.

function serviceUnavailable() {
  const env = getSupabaseServerEnv();
  return !env.url || !env.serviceRoleKey;
}

async function currentUserId(): Promise<string | null> {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();
  return user?.id ?? null;
}

/** Picker-opened analytics ping (privacy-safe; no content). */
export async function trackWallpaperPickerOpenedAction(): Promise<{ ok: boolean }> {
  if (serviceUnavailable()) return { ok: false };
  const userId = await currentUserId();
  if (!userId) return { ok: false };
  const admin = createSupabaseAdminClient();
  await recordProductEvent(admin, {
    eventName: "wallpaper_picker_opened",
    actorId: userId,
    resourceType: "wallpaper",
    resourceId: userId,
    featureKey: "wallpaper"
  });
  return { ok: true };
}

/** Selects a catalog wallpaper ('mad-buddy-default', 'plain', or a slug). */
export async function setWallpaperPreferenceAction(slug: string): Promise<{ ok: boolean; message: string; upgrade?: boolean }> {
  if (serviceUnavailable()) return { ok: false, message: "Wallpapers are unavailable right now." };
  if (typeof slug !== "string" || slug.length === 0 || slug.length > 64) {
    return { ok: false, message: "Pick a valid wallpaper." };
  }

  const userId = await currentUserId();
  if (!userId) return { ok: false, message: "Log in to change your wallpaper." };

  const admin = createSupabaseAdminClient();
  const access = await getCurrentSubscriptionAccess(userId);
  const result = await setWallpaperSelection(admin, { userId, plan: access.plan, slug });

  if (!result.ok) {
    if (result.reason === "locked") {
      // Server-authoritative refusal — surface the upgrade path, don't apply.
      await recordProductEvent(admin, {
        eventName: "premium_wallpaper_attempted",
        actorId: userId,
        resourceType: "wallpaper",
        resourceId: slug,
        featureKey: "wallpaper"
      });
      return { ok: false, upgrade: true, message: "That wallpaper needs Buddy Plus or Pro." };
    }
    return { ok: false, message: "That wallpaper isn’t available." };
  }

  await recordProductEvent(admin, {
    eventName: "wallpaper_selected",
    actorId: userId,
    resourceType: "wallpaper",
    resourceId: slug,
    featureKey: "wallpaper"
  });
  revalidatePath("/", "layout");
  return { ok: true, message: "Wallpaper updated." };
}

/** Re-applies the user's already-uploaded custom wallpaper (premium). */
export async function applyCustomWallpaperAction(): Promise<{ ok: boolean; message: string; upgrade?: boolean }> {
  if (serviceUnavailable()) return { ok: false, message: "Wallpapers are unavailable right now." };
  const userId = await currentUserId();
  if (!userId) return { ok: false, message: "Log in to change your wallpaper." };

  const admin = createSupabaseAdminClient();
  const access = await getCurrentSubscriptionAccess(userId);
  if (!access.hasPremium) {
    await recordProductEvent(admin, {
      eventName: "premium_wallpaper_attempted",
      actorId: userId,
      resourceType: "wallpaper",
      resourceId: "custom",
      featureKey: "wallpaper"
    });
    return { ok: false, upgrade: true, message: "Custom wallpapers are a Buddy Plus / Pro feature." };
  }

  const summary = await loadCustomWallpaperSummary(admin, userId);
  if (!summary.hasActive) return { ok: false, message: "Upload a photo first." };

  const applied = await selectCustomWallpaper(admin, userId);
  if (!applied.ok) return { ok: false, message: "Couldn’t apply your wallpaper. Try again." };

  await recordProductEvent(admin, {
    eventName: "custom_wallpaper_applied",
    actorId: userId,
    resourceType: "wallpaper",
    resourceId: "custom",
    featureKey: "wallpaper"
  });
  revalidatePath("/", "layout");
  return { ok: true, message: "Your wallpaper is set." };
}

/** Uploads a personal wallpaper to private storage and applies it (premium). */
export async function uploadCustomWallpaperAction(formData: FormData): Promise<{ ok: boolean; message: string; upgrade?: boolean }> {
  if (serviceUnavailable()) return { ok: false, message: "Wallpapers are unavailable right now." };

  const userId = await currentUserId();
  if (!userId) return { ok: false, message: "Log in to upload a wallpaper." };

  const admin = createSupabaseAdminClient();

  // Server-authoritative entitlement gate — a Free user cannot upload.
  const access = await getCurrentSubscriptionAccess(userId);
  if (!access.hasPremium) {
    await recordProductEvent(admin, {
      eventName: "premium_wallpaper_attempted",
      actorId: userId,
      resourceType: "wallpaper",
      resourceId: "custom",
      featureKey: "wallpaper"
    });
    return { ok: false, upgrade: true, message: "Custom wallpapers are a Buddy Plus / Pro feature." };
  }

  const rateLimit = await consumeRateLimit({ action: "media.upload", userId });
  if (!rateLimit.allowed) return { ok: false, message: rateLimitMessage(rateLimit.resetAt) };

  const file = formData.get("wallpaper");
  if (!(file instanceof File) || file.size === 0) return { ok: false, message: "Choose an image first." };

  const headerBytes = new Uint8Array(await file.slice(0, 32).arrayBuffer());
  const validation = validateImageUpload({
    claimedMimeType: file.type,
    headerBytes,
    sizeBytes: file.size,
    context: "profile" // 5 MB cap, allows HEIC from iOS; re-encoded to WebP below
  });
  if (!validation.valid) {
    return {
      ok: false,
      message: validation.reason === "too_large" ? "Use an image smaller than 5 MB." : uploadValidationMessage(validation.reason)
    };
  }

  let optimized;
  try {
    optimized = await optimizeWallpaper(Buffer.from(await file.arrayBuffer()));
  } catch {
    return { ok: false, message: "That image couldn’t be processed. Try a different photo." };
  }

  const path = `${userId}/wallpaper-${Date.now()}.webp`;
  const { error: uploadError } = await admin.storage.from("wallpapers").upload(path, toStorageArrayBuffer(optimized.buffer), {
    contentType: "image/webp",
    cacheControl: "31536000",
    upsert: false
  });
  if (uploadError) return { ok: false, message: "Upload failed. Please try again." };

  // Verify the stored bytes really are a WebP before we point anyone at them.
  const { data: stored } = await admin.storage.from("wallpapers").download(path);
  const storedKind = stored ? sniffImageKind(new Uint8Array(await stored.slice(0, 12).arrayBuffer())) : null;
  if (storedKind !== "webp") {
    await admin.storage.from("wallpapers").remove([path]);
    return { ok: false, message: "Your wallpaper was not stored correctly. Please try again." };
  }

  const registered = await registerCustomWallpaper(admin, {
    userId,
    storageKey: path,
    mimeType: "image/webp",
    sizeBytes: optimized.buffer.length,
    width: optimized.width,
    height: optimized.height
  });
  if (!registered.ok) {
    await admin.storage.from("wallpapers").remove([path]);
    return { ok: false, message: "Your wallpaper could not be saved. Please try again." };
  }

  await selectCustomWallpaper(admin, userId);
  await recordProductEvent(admin, {
    eventName: "custom_wallpaper_uploaded",
    actorId: userId,
    resourceType: "wallpaper",
    resourceId: "custom",
    featureKey: "wallpaper"
  });
  await recordProductEvent(admin, {
    eventName: "custom_wallpaper_applied",
    actorId: userId,
    resourceType: "wallpaper",
    resourceId: "custom",
    featureKey: "wallpaper"
  });
  revalidatePath("/", "layout");
  return { ok: true, message: "Your wallpaper is set." };
}
