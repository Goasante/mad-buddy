import "server-only";

import { MAX_LINKR_CARD_PHOTOS } from "@/lib/linkr/media-projection-limits";
import { signMediaUrls } from "@/lib/linkr/profile-service";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getSupabaseBrowserEnv } from "@/lib/supabase/env";

/**
 * THE LINKR-SAFE MEDIA PROJECTION.
 *
 * Linkr does not own identity imagery. Profile does. This module reads the
 * canonical Profile media and produces the gallery a Linkr candidate card
 * shows -- a PROJECTION, never a second library.
 *
 * The shape, which is Profile's shape and not Linkr's:
 *
 *     profiles.avatar_url         -> the canonical profile picture, first
 *     profiles.profile_media_id   -> legacy private-media fallback
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

/**
 * The most images a Linkr card will ever show: avatar + three showcases.
 *
 * Re-exported from the client-safe module so the candidate card can read the
 * same constant without importing this `server-only` file. Defined once, in
 * lib/linkr/media-projection-limits.ts.
 */
export { MAX_LINKR_CARD_PHOTOS } from "@/lib/linkr/media-projection-limits";

/** Only this visibility is safe to show a stranger. */
const STRANGER_SAFE = "everyone";

/** Refuse an owner-written URL from becoming a cross-origin tracking image. */
export function canonicalAvatarUrl(userId: string, value: string | null): string | null {
  if (!value) return null;
  const { url: supabaseUrl } = getSupabaseBrowserEnv();
  if (!supabaseUrl) return null;
  try {
    const source = new URL(value);
    const storageOrigin = new URL(supabaseUrl).origin;
    const expectedPath = `/storage/v1/object/public/avatars/${userId}/`;
    return source.origin === storageOrigin && source.pathname.startsWith(expectedPath) ? value : null;
  } catch {
    return null;
  }
}

export type LinkrMediaRow = {
  userId: string;
  primaryUrl: string | null;
  primaryAssetId: string | null;
  showcaseAssetIds: string[];
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
): Promise<Map<string, LinkrMediaRow>> {
  const byUser = new Map<string, LinkrMediaRow>();
  if (userIds.length === 0) return byUser;

  const [{ data: profiles }, { data: showcases }] = await Promise.all([
    admin.from("profiles").select("user_id, avatar_url, profile_media_id").in("user_id", userIds),
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
    const avatarUrl = canonicalAvatarUrl(profile.user_id, profile.avatar_url);
    byUser.set(profile.user_id, {
      userId: profile.user_id,
      primaryUrl: avatarUrl,
      // Existing Linkr uploads were migrated here. Keep them as a fallback,
      // but Profile's current avatar_url is the authority for new uploads.
      primaryAssetId: avatarUrl ? null : (profile.profile_media_id ?? null),
      showcaseAssetIds: []
    });
  }

  for (const photo of showcases ?? []) {
    const media = byUser.get(photo.user_id);
    // No profile picture means no card at all, so a stray showcase must not
    // become somebody's primary image.
    if (!media || (!media.primaryUrl && !media.primaryAssetId)) continue;
    if (media.showcaseAssetIds.length >= MAX_LINKR_CARD_PHOTOS - 1) continue;
    media.showcaseAssetIds.push(photo.media_asset_id);
  }

  return byUser;
}

/** One person's Linkr-safe gallery, as signed URLs ready to render. */
export async function loadLinkrGallery(admin: Admin, userId: string): Promise<string[]> {
  const media = (await loadLinkrMedia(admin, [userId])).get(userId);
  if (!media || (!media.primaryUrl && !media.primaryAssetId)) return [];
  const assetIds = [media.primaryAssetId, ...media.showcaseAssetIds].filter(
    (id): id is string => Boolean(id)
  );
  const urls = await signMediaUrls(admin, assetIds);
  const primary = media.primaryUrl ?? (media.primaryAssetId ? urls.get(media.primaryAssetId) : null);
  if (!primary) return [];
  return [
    primary,
    ...media.showcaseAssetIds.map((id) => urls.get(id)).filter((url): url is string => Boolean(url))
  ];
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
    .select("avatar_url, profile_media_id")
    .eq("user_id", userId)
    .maybeSingle();
  return Boolean(canonicalAvatarUrl(userId, data?.avatar_url ?? null) || data?.profile_media_id);
}
