import "server-only";

import { sniffImageKind, uploadValidationMessage, validateImageUpload } from "@/lib/media/validation";
import { createRequestId, errorType, logBackendEvent } from "@/lib/observability/logger";
import type { createSupabaseAdminClient } from "@/lib/supabase/admin";
import type { User } from "@supabase/supabase-js";

type Admin = ReturnType<typeof createSupabaseAdminClient>;

/**
 * Uploading a profile avatar, as a transport-agnostic service.
 *
 * Extracted from app/(app)/actions.ts so the native app can reach the same
 * behaviour through /api/profile/avatar/upload. The web Server Action and the
 * route handler both call this, so magic-byte validation, the EXIF-stripping
 * re-encode, the stored-file verification and the rollback on every failure
 * branch are one implementation rather than two.
 *
 * Takes the USER, not just an id: the fallback profile it creates when none
 * exists reads user_metadata and email to derive a name and username.
 *
 * Authentication stays with the caller (a Server Action resolves the session,
 * a route uses resolveApiUser); this is handed the user the caller proved.
 */
export type AvatarUploadResult = {
  ok: boolean;
  message: string;
  avatarUrl?: string;
};

export async function uploadProfileAvatar(
  admin: Admin,
  user: User,
  formData: FormData
): Promise<AvatarUploadResult> {
  const userId = user.id;
  const file = formData.get("avatar");

  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, message: "Choose an avatar image first." };
  }

  // Shared upload validator (feature spec batch 6 §39): type support, size,
  // and, critically, that the real magic bytes match the claimed MIME type.
  const headerBytes = new Uint8Array(await file.slice(0, 32).arrayBuffer());
  const validation = validateImageUpload({
    claimedMimeType: file.type,
    headerBytes,
    sizeBytes: file.size,
    context: "profile"
  });

  if (!validation.valid) {
    return {
      ok: false,
      message: validation.reason === "too_large"
        ? "Use a profile photo smaller than 5 MB."
        : uploadValidationMessage(validation.reason)
    };
  }

  const uploadedAt = Date.now();
  const path = `${userId}/avatar-${uploadedAt}.webp`;

  // Avatars are on a public bucket, so EXIF stripping matters even more here:
  // re-encode (drops GPS and all metadata) and cap the dimensions.
  let avatarBuffer: Buffer;
  try {
    // Keep the native image dependency out of the shared Server Action module
    // until this upload action actually needs it. A profile/DOB save must not
    // fail merely because the deployment cannot load Sharp's native runtime.
    const { optimizeProfileAvatar, toStorageArrayBuffer } = await import("@/lib/media/processing");
    avatarBuffer = await optimizeProfileAvatar(Buffer.from(await file.arrayBuffer()));
    const { error } = await admin.storage.from("avatars").upload(path, toStorageArrayBuffer(avatarBuffer), {
      contentType: "image/webp",
      cacheControl: "31536000",
      upsert: false
    });

    if (error) {
      return { ok: false, message: "Profile photo upload failed. Please try again." };
    }
  } catch (error) {
    logBackendEvent("error", {
      requestId: createRequestId(),
      route: "/profile",
      action: "upload_avatar_process",
      statusCode: 500,
      userId,
      errorType: errorType(error)
    });
    return {
      ok: false,
      message: validation.kind === "heic"
        ? "This HEIC photo could not be converted. Export it as JPG or PNG and try again."
        : "That image couldn't be processed. Try a different photo."
    };
  }

  const { data: storedAvatar, error: verifyError } = await admin.storage.from("avatars").download(path);
  const storedKind = storedAvatar
    ? sniffImageKind(new Uint8Array(await storedAvatar.slice(0, 12).arrayBuffer()))
    : null;
  if (verifyError || storedKind !== "webp") {
    await admin.storage.from("avatars").remove([path]);
    return { ok: false, message: "Your profile photo was not stored correctly. Please try again." };
  }

  const { data } = admin.storage.from("avatars").getPublicUrl(path);
  const avatarUrl = data.publicUrl;
  const { data: savedProfile, error: profileError } = await admin
    .from("profiles")
    .update({ avatar_url: avatarUrl })
    .eq("user_id", userId)
    .select("avatar_url")
    .maybeSingle();

  if (profileError) {
    await admin.storage.from("avatars").remove([path]);
    return { ok: false, message: "Your profile photo could not be saved. Please try again." };
  }

  if (!savedProfile) {
    const fallbackName =
      typeof user.user_metadata?.full_name === "string"
        ? user.user_metadata.full_name
        : user.email?.split("@")[0] ?? "Mad Buddy User";
    const fallbackUsernameBase = (user.email?.split("@")[0] ?? `user_${userId.slice(0, 8)}`)
      .toLowerCase()
      .replace(/[^a-z0-9_]/g, "_")
      .replace(/_+/g, "_")
      .slice(0, 16);
    const fallbackUsername = `${fallbackUsernameBase}_${userId.slice(0, 6)}`.slice(0, 24);
    const { error: insertError } = await admin.from("profiles").insert({
      user_id: userId,
      full_name: fallbackName,
      username: fallbackUsername,
      avatar_url: avatarUrl
    });

    if (insertError) {
      await admin.storage.from("avatars").remove([path]);
      return { ok: false, message: "Your profile photo could not be saved. Please try again." };
    }
  }

  try {
    await admin.auth.admin.updateUserById(userId, {
      user_metadata: {
        ...user.user_metadata,
        avatar_url: avatarUrl
      }
    });
  } catch {
    // Profile.avatar_url is the source of truth; auth metadata is a convenience mirror.
  }

  try {
    const { data: files } = await admin.storage.from("avatars").list(userId);
    const stalePaths = (files ?? [])
      .map((item) => `${userId}/${item.name}`)
      .filter((item) => item !== path);

    if (stalePaths.length > 0) {
      await admin.storage.from("avatars").remove(stalePaths);
    }
  } catch {
    // Old avatar cleanup is best-effort; the saved profile URL above is authoritative.
  }


  return { ok: true, message: "Profile photo updated.", avatarUrl: `${avatarUrl}?v=${Date.now()}` };
}
