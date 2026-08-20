import "server-only";

import { signMediaUrls } from "@/lib/linkr/profile-service";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

/**
 * THE LINKR-SAFE MEDIA PROJECTION.
 *
 * Linkr does not own identity imagery. Profile does. This module reads the
 * canonical Profile media and produces the gallery a Linkr candidate card
 * shows -- a PROJECTION, never a second library.
 *
 * The shape, which is Profile's shape and not Linkr's:
 *
 *     profiles.profile_media_id   -> the profile picture, always first
 *     profile_photos (0, 1, 2)    -> up to three showcase photos, in order
 *
 * so a person can appear on a Linkr card with up to four images without ever
 * uploading anything to Linkr.
 *
 * WHY A PROJECTION RATHER THAN A TABLE. `linkr_photos` existed only because
 * Linkr collected its own uploads; every one of its readers was a Linkr
 * upload path. Keeping it would mean two places that answer "what does this
 * person look like", and they would drift the first time somebody changed
 * their avatar. There is no ordering or metadata Linkr needs that Profile does
 * not already hold, so the table has no remaining job.
 *
 * PRIVACY IS NOT INHERITED, IT IS RE-DECIDED. `profile_photos` carries a
 * per-photo visibility -- `only_me`, `approved_muddies`, `everyone` -- chosen
 * for an audience of people who already know you. A Linkr candidate is a
 * stranger, so this projection admits ONLY `everyone` photos. Someone who kept
 * a picture for their Muddies does not have it handed to strangers because
 * they turned on Linkr.
 *
 * The profile picture itself is different in kind: it is the face the product
 * already shows wherever the person appears, so it is included without a
 * per-photo setting to consult.
 */

type Admin = ReturnType<typeof createSupabaseAdminClient>;

/** The most images a Linkr card will ever show: avatar + three showcases. */
export const MAX_LINKR_CARD_PHOTOS = 4;

/** Only this visibility is safe to show a stranger. */
const STRANGER_SAFE = "everyone";

export type LinkrMediaRow = {
  userId: string;
  /** Media asset ids, profile picture first, then showcases in slot order. */
  assetIds: string[];
};

/**
 * The Linkr-safe media for MANY users at once.
 *
 * Batched deliberately: the candidate query resolves a whole page of people,
 * and a per-candidate media lookup is exactly the N+1 the discovery path was
 * built to avoid.
 */
export async function loadLinkrMedia(
  admin: Admin,
  userIds: string[]
): Promise<Map<string, string[]>> {
  const byUser = new Map<string, string[]>();
  if (userIds.length === 0) return byUser;

  const [{ data: profiles }, { data: showcases }] = await Promise.all([
    admin.from("profiles").select("user_id, profile_media_id").in("user_id", userIds),
    admin
      .from("profile_photos")
      .select("user_id, media_asset_id, position, visibility")
      .in("user_id", userIds)
      .eq("visibility", STRANGER_SAFE)
      .order("position", { ascending: true })
  ]);

  for (const profile of profiles ?? []) {
    // The profile picture is always index 0. A card that opened on a landscape
    // photo would make the person the second thing you see.
    byUser.set(profile.user_id, profile.profile_media_id ? [profile.profile_media_id] : []);
  }

  for (const photo of showcases ?? []) {
    const list = byUser.get(photo.user_id);
    // No profile picture means no card at all, so a stray showcase must not
    // become somebody's primary image.
    if (!list || list.length === 0) continue;
    if (list.length >= MAX_LINKR_CARD_PHOTOS) continue;
    list.push(photo.media_asset_id);
  }

  return byUser;
}

/** One person's Linkr-safe gallery, as signed URLs ready to render. */
export async function loadLinkrGallery(admin: Admin, userId: string): Promise<string[]> {
  const assetIds = (await loadLinkrMedia(admin, [userId])).get(userId) ?? [];
  if (assetIds.length === 0) return [];
  const urls = await signMediaUrls(admin, assetIds);
  // Order is preserved from the projection; a missing/unprocessed asset simply
  // drops out rather than leaving a gap in the carousel.
  return assetIds.map((id) => urls.get(id)).filter((url): url is string => Boolean(url));
}

/**
 * Whether this person has the identity photo Linkr requires.
 *
 * Reads the canonical profile picture. Linkr does not define its own idea of
 * "has a photo", which is what let two answers exist before.
 */
export async function hasProfilePicture(admin: Admin, userId: string): Promise<boolean> {
  const { data } = await admin
    .from("profiles")
    .select("profile_media_id")
    .eq("user_id", userId)
    .maybeSingle();
  return Boolean(data?.profile_media_id);
}
