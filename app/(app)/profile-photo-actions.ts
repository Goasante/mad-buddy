"use server";

import { revalidatePath } from "next/cache";

import {
  addProfilePhoto,
  deleteProfilePhoto,
  reorderProfilePhoto,
  setProfilePhotoVisibility
} from "@/lib/profile/photo-gallery-service";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
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

  /* The body of this action now lives in lib/profile/photo-gallery-service.ts
     so that /api/profile/photos -- how the native app reaches this feature --
     runs the SAME code rather than a copy that looks alike. Everything
     platform-specific stays here: resolving the session and revalidating the
     route, neither of which a Bearer-token API call has. */
  const result = await addProfilePhoto(createSupabaseAdminClient(), userId, formData);
  if (result.ok) revalidatePath("/profile");
  return result;
}

/** Change who can see one photo. Scoped to the caller's own rows. */
export async function setProfilePhotoVisibilityAction(input: unknown): Promise<ActionState> {
  if (!serverReady()) {
    return { ok: false, message: "This action needs the server database configuration." };
  }

  const userId = await getAuthedUserId();
  if (!userId) return { ok: false, message: "Log in first." };

  const result = await setProfilePhotoVisibility(createSupabaseAdminClient(), userId, input);
  if (result.ok) revalidatePath("/profile");
  return result;
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

  const userId = await getAuthedUserId();
  if (!userId) return { ok: false, message: "Log in first." };

  const result = await deleteProfilePhoto(createSupabaseAdminClient(), userId, input);
  if (result.ok) revalidatePath("/profile");
  return result;
}

/**
 * Move a photo to another slot.
 *
 * Goes through the `reorder_profile_photo` function rather than issuing two
 * updates from here: a swap that half-applied would leave the gallery with a
 * duplicate slot or a hole, and the window between two client-issued writes is
 * exactly where that happens.
 *
 * The photo keeps its id, its media asset and — importantly — its visibility.
 * Visibility belongs to the PHOTO, not the slot, so moving a private picture
 * into first position must never make it public. Nothing is re-uploaded.
 */
export async function reorderProfilePhotoAction(input: unknown): Promise<ActionState> {
  if (!serverReady()) {
    return { ok: false, message: "This action needs the server database configuration." };
  }

  const userId = await getAuthedUserId();
  if (!userId) return { ok: false, message: "Log in first." };

  const result = await reorderProfilePhoto(createSupabaseAdminClient(), userId, input);
  if (result.ok) revalidatePath("/profile");
  return result;
}
