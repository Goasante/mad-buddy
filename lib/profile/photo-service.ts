import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { ProfilePhoto } from "@/lib/profile/profile-photos";
import type { Database } from "@/lib/supabase/database.types";

type Admin = SupabaseClient<Database>;

/**
 * The ONE place gallery photos are authorised and signed.
 *
 * Every profile surface calls this rather than writing its own filter: the
 * own profile, the Muddy profile, and anything added later. A second copy of
 * these rules is how two surfaces end up disagreeing about who may see a
 * photo, and the disagreement always resolves in favour of the more
 * permissive one.
 *
 * Authorisation is in the WHERE clause, not applied after the fetch. An
 * `only_me` photo is never read into memory for anyone but its owner, so
 * there is no filtered-out row sitting in a response object waiting for
 * somebody to forget to remove it.
 *
 * BLOCKS ARE NOT CHECKED HERE, deliberately. Both callers resolve blocking
 * before they reach this point — the profile is refused entirely, not shown
 * with an empty gallery — and re-checking would imply this function is safe
 * to call without that guard, which it is not.
 */
export async function loadVisibleProfilePhotosFor(
  admin: Admin,
  targetId: string,
  viewer: { isOwner: boolean; isApprovedMuddy: boolean }
): Promise<ProfilePhoto[]> {
  let query = admin
    .from("profile_photos")
    .select("id, media_asset_id, position, visibility")
    .eq("user_id", targetId)
    .order("position", { ascending: true });

  if (!viewer.isOwner) {
    // A stranger sees `everyone`. An ACTIVE Muddy also sees
    // `approved_muddies` — callers pass that flag from areApprovedMuddies,
    // which requires ended_at IS NULL, so an ended friendship lands in the
    // stranger branch without a separate check.
    //
    // `only_me` is in neither list, so it is unreachable except through the
    // owner branch above.
    query = viewer.isApprovedMuddy
      ? query.in("visibility", ["everyone", "approved_muddies"])
      : query.eq("visibility", "everyone");
  }

  const { data: rows } = await query;
  if (!rows?.length) return [];

  const { signMediaForAsset } = await import("@/lib/content/service");

  // THUMB ONLY. The full-resolution URL is minted when a viewer actually
  // opens a photo, so a profile with three photos does not sign three large
  // images nobody may look at.
  const signed = await Promise.all(
    rows.map(async (row) => {
      // Signed and short-lived rather than permanent: a permanent URL would
      // outlive the setting that allowed it, so switching a photo to
      // `only_me` could not take back a link already handed out.
      const url = await signMediaForAsset(admin, row.media_asset_id, "thumb");
      if (!url) return null;
      return {
        id: row.id,
        position: row.position,
        url,
        visibility: row.visibility as ProfilePhoto["visibility"]
      };
    })
  );

  return signed.filter((photo): photo is ProfilePhoto => photo !== null);
}
