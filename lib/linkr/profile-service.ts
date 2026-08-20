import "server-only";

import { z } from "zod";

import { calculateAge, dateKeyInTimeZone } from "@/lib/profile/birth-date";
import { isLinkrIntent, type LinkrIntent } from "@/lib/linkr/intent";
import { PRIMARY_SLOT, orderedPhotos, type LinkrPhoto } from "@/lib/linkr/photos";
import {
  missingProfileRequirements,
  resolveDiscoverability,
  type LinkrDistancePreference
} from "@/lib/linkr/rules";
import { MEDIA_SIGNED_URL_TTL_SECONDS } from "@/lib/media/constants";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import type { Database } from "@/lib/supabase/database.types";
import { getSupabaseServerEnv } from "@/lib/supabase/env";

/**
 * The user's own Linkr profile: reading it, turning Linkr on and off, editing
 * what strangers see, and managing the four photos.
 *
 * Everything here is scoped to ONE user -- the caller's own id, passed in
 * already authenticated. Nothing in this file reads another person's Linkr
 * profile; that is candidate-service.ts, which has to answer a much harder
 * question before it may show anybody anything.
 */

type Admin = ReturnType<typeof createSupabaseAdminClient>;

/**
 * The generated Insert shape, used for the partial upserts below. Typed rather
 * than Record<string, unknown> so a renamed or removed column fails the build
 * here instead of silently writing nothing at runtime.
 */
type LinkrProfileInsert = Database["public"]["Tables"]["linkr_profiles"]["Insert"];

export type LinkrActionResult = { ok: boolean; message: string };

export type LinkrOwnProfile = {
  enabled: boolean;
  intent: LinkrIntent;
  bio: string;
  discoveryDistance: LinkrDistancePreference;
  requirePhotos: boolean;
  onlyActiveNow: boolean;
  onlyNewToday: boolean;
  eventModeEnabled: boolean;
  photos: LinkrPhoto[];
  interests: string[];
  /** Identity fields drawn from the canonical profile, never duplicated here. */
  displayName: string;
  age: number | null;
  isVerifiedAccount: boolean;
  /** What still blocks discoverability, if anything. */
  missingRequirements: string[];
  discoverable: boolean;
};

function serverReady(): boolean {
  const env = getSupabaseServerEnv();
  return Boolean(env.url && env.serviceRoleKey);
}

/**
 * Age from the canonical birth-date table.
 *
 * Returns null rather than a guess when the row is missing or unparseable.
 * Every caller treats null as "not eligible", which is the only safe reading
 * on an 18+ surface.
 */
export async function resolveAge(admin: Admin, userId: string): Promise<number | null> {
  const { data } = await admin
    .from("profile_birth_details")
    .select("date_of_birth")
    .eq("user_id", userId)
    .maybeSingle();
  if (!data?.date_of_birth) return null;
  try {
    return calculateAge(data.date_of_birth, dateKeyInTimeZone(new Date()));
  } catch {
    return null;
  }
}

/** Ages for many users at once. The batched form the candidate query needs. */
export async function resolveAges(
  admin: Admin,
  userIds: string[]
): Promise<Map<string, number | null>> {
  const ages = new Map<string, number | null>();
  for (const id of userIds) ages.set(id, null);
  if (userIds.length === 0) return ages;

  const { data } = await admin
    .from("profile_birth_details")
    .select("user_id, date_of_birth")
    .in("user_id", userIds);
  const today = dateKeyInTimeZone(new Date());
  for (const row of data ?? []) {
    try {
      ages.set(row.user_id, calculateAge(row.date_of_birth, today));
    } catch {
      ages.set(row.user_id, null);
    }
  }
  return ages;
}

/**
 * Signed URLs for a set of media assets, in one round trip per asset batch.
 *
 * Linkr photos live in the private `media` bucket like every other image, so
 * they are served as short-lived signed URLs rather than public links: a
 * stranger-facing photo that is permanently fetchable by anyone with the URL
 * is not actually stranger-facing, it is public.
 */
export async function signMediaUrls(
  admin: Admin,
  assetIds: string[]
): Promise<Map<string, string>> {
  const urls = new Map<string, string>();
  if (assetIds.length === 0) return urls;

  const { data: assets } = await admin
    .from("media_assets")
    .select("id, storage_key, processing_status, deleted_at")
    .in("id", assetIds);

  const usable = (assets ?? []).filter(
    (asset) => asset.storage_key && !asset.deleted_at && asset.processing_status === "ready"
  );
  if (usable.length === 0) return urls;

  const { data: signed } = await admin.storage
    .from("media")
    .createSignedUrls(
      usable.map((asset) => asset.storage_key as string),
      MEDIA_SIGNED_URL_TTL_SECONDS
    );

  const byKey = new Map((signed ?? []).map((row) => [row.path, row.signedUrl]));
  for (const asset of usable) {
    const url = byKey.get(asset.storage_key as string);
    if (url) urls.set(asset.id, url);
  }
  return urls;
}

/**
 * One person's Linkr gallery -- PROJECTED from canonical Profile media.
 *
 * Reads `profiles.profile_media_id` plus the stranger-safe rows of
 * `profile_photos`, never a Linkr-owned table. The ids are synthetic (`slot-N`)
 * because these photos have no Linkr identity of their own to expose: they are
 * Profile's photos, and Profile is where they are managed.
 */
export async function loadLinkrPhotos(admin: Admin, userId: string): Promise<LinkrPhoto[]> {
  const { loadLinkrGallery } = await import("@/lib/linkr/media-projection");
  const urls = await loadLinkrGallery(admin, userId);
  return orderedPhotos(
    urls.map((url, index) => ({ id: `slot-${index}`, position: index, url }))
  );
}

/**
 * The caller's own Linkr profile, creating nothing.
 *
 * A user who has never opened Linkr has no row, and that is the "Linkr off"
 * state -- returning defaults rather than inserting means simply looking at
 * the screen never makes anybody discoverable.
 */
export async function loadOwnLinkrProfile(userId: string): Promise<LinkrOwnProfile | null> {
  if (!serverReady()) return null;
  const admin = createSupabaseAdminClient();

  const [{ data: linkr }, { data: profile }, { data: interests }, photos, age, { data: verifications }] =
    await Promise.all([
      admin
        .from("linkr_profiles")
        .select(
          "enabled, intent, bio, discovery_distance, require_photos, only_active_now, only_new_today, event_mode_enabled"
        )
        .eq("user_id", userId)
        .maybeSingle(),
      admin
        .from("profiles")
        .select("full_name, visibility_status, deleted_at")
        .eq("user_id", userId)
        .maybeSingle(),
      admin.from("linkr_interests").select("interest").eq("user_id", userId).order("created_at"),
      loadLinkrPhotos(admin, userId),
      resolveAge(admin, userId),
      admin.from("account_verifications").select("status").eq("user_id", userId)
    ]);

  const hasPrimaryPhoto = photos.some((photo) => photo.position === PRIMARY_SLOT);


  const discoverability = resolveDiscoverability({
    linkrEnabled: Boolean(linkr?.enabled),
    age,
    hasPrimaryPhoto,
    // "ghost" is this product's hidden state: the same value the proximity
    // engine already refuses to place. Linkr must agree with it, or someone in
    // Ghost Mode would be invisible on the map and visible on a card.
    accountVisible: profile?.visibility_status !== "ghost",
    restricted: false,
    deleted: Boolean(profile?.deleted_at)
  });

  return {
    enabled: Boolean(linkr?.enabled),
    intent: isLinkrIntent(linkr?.intent) ? linkr.intent : "friends",
    bio: linkr?.bio ?? "",
    discoveryDistance: (linkr?.discovery_distance as LinkrDistancePreference) ?? "around_you",
    requirePhotos: Boolean(linkr?.require_photos),
    onlyActiveNow: Boolean(linkr?.only_active_now),
    onlyNewToday: Boolean(linkr?.only_new_today),
    eventModeEnabled: linkr?.event_mode_enabled ?? true,
    photos,
    interests: (interests ?? []).map((row) => row.interest),
    displayName: profile?.full_name?.trim() ?? "",
    age,
    isVerifiedAccount: (verifications ?? []).some((row) => row.status === "verified"),
    missingRequirements: missingProfileRequirements({ age, hasPrimaryPhoto }),
    discoverable: discoverability.discoverable
  };
}

// ---------------------------------------------------------------------------
// Activation
// ---------------------------------------------------------------------------

const activationSchema = z.object({
  intent: z.string().refine(isLinkrIntent, "Choose what you're here for.")
});

/**
 * Turns Linkr on.
 *
 * The age check is HERE and not only on the discovery query, because this is
 * the moment somebody asks to be discoverable. Refusing at the point of the
 * request is honest; letting the row be written and then quietly never showing
 * them would leave a user who believes they are on Linkr and is not.
 */
export async function enableLinkr(userId: string, input: unknown): Promise<LinkrActionResult> {
  if (!serverReady()) return { ok: false, message: "This action needs the server database configuration." };
  const parsed = activationSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? "Check the details and try again." };
  }

  const admin = createSupabaseAdminClient();
  const age = await resolveAge(admin, userId);
  if (age === null) return { ok: false, message: "Add your date of birth before turning on Linkr." };
  if (age < 18) return { ok: false, message: "Linkr is for people 18 and over." };

  const { error } = await admin.from("linkr_profiles").upsert(
    {
      user_id: userId,
      enabled: true,
      intent: parsed.data.intent,
      updated_at: new Date().toISOString()
    },
    { onConflict: "user_id" }
  );
  if (error) return { ok: false, message: "Couldn't turn on Linkr. Try again." };
  return { ok: true, message: "Linkr is on" };
}

/**
 * Turns Linkr off.
 *
 * Removes them from new candidacy immediately -- the discovery query reads
 * `enabled` on every request, so there is no cleanup and no delay. Existing
 * mutual connections and their conversations are deliberately left alone:
 * leaving discovery is not the same as ending relationships that already
 * formed, and someone who wants that has Block and disconnect.
 */
export async function disableLinkr(userId: string): Promise<LinkrActionResult> {
  if (!serverReady()) return { ok: false, message: "This action needs the server database configuration." };
  const { error } = await createSupabaseAdminClient()
    .from("linkr_profiles")
    .upsert(
      { user_id: userId, enabled: false, updated_at: new Date().toISOString() },
      { onConflict: "user_id" }
    );
  if (error) return { ok: false, message: "Couldn't turn off Linkr. Try again." };
  return { ok: true, message: "Linkr is off" };
}

// ---------------------------------------------------------------------------
// Editing
// ---------------------------------------------------------------------------

const profileSchema = z.object({
  intent: z.string().refine(isLinkrIntent).optional(),
  bio: z.string().trim().max(120).optional(),
  interests: z.array(z.string().trim().min(1).max(40)).max(8).optional()
});

export async function updateLinkrProfile(userId: string, input: unknown): Promise<LinkrActionResult> {
  if (!serverReady()) return { ok: false, message: "This action needs the server database configuration." };
  const parsed = profileSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? "Check the details and try again." };
  }

  const admin = createSupabaseAdminClient();
  const patch: LinkrProfileInsert = { user_id: userId, updated_at: new Date().toISOString() };
  if (parsed.data.intent !== undefined) patch.intent = parsed.data.intent;
  if (parsed.data.bio !== undefined) patch.bio = parsed.data.bio || null;

  const { error } = await admin.from("linkr_profiles").upsert(patch, { onConflict: "user_id" });
  if (error) return { ok: false, message: "Couldn't save that. Try again." };

  if (parsed.data.interests) {
    // Replace wholesale: the editor sends the full set, and diffing it would
    // add a failure mode (a half-applied change) for no benefit at this size.
    const unique = [...new Set(parsed.data.interests.map((value) => value.trim()).filter(Boolean))];
    await admin.from("linkr_interests").delete().eq("user_id", userId);
    if (unique.length > 0) {
      await admin
        .from("linkr_interests")
        .insert(unique.map((interest) => ({ user_id: userId, interest })));
    }
  }

  return { ok: true, message: "Saved." };
}

const settingsSchema = z.object({
  discoveryDistance: z.enum(["very_close", "around_you", "wider"]).optional(),
  requirePhotos: z.boolean().optional(),
  onlyActiveNow: z.boolean().optional(),
  onlyNewToday: z.boolean().optional(),
  eventModeEnabled: z.boolean().optional()
});

export async function updateLinkrSettings(userId: string, input: unknown): Promise<LinkrActionResult> {
  if (!serverReady()) return { ok: false, message: "This action needs the server database configuration." };
  const parsed = settingsSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Check the details and try again." };

  const patch: LinkrProfileInsert = { user_id: userId, updated_at: new Date().toISOString() };
  if (parsed.data.discoveryDistance !== undefined) patch.discovery_distance = parsed.data.discoveryDistance;
  if (parsed.data.requirePhotos !== undefined) patch.require_photos = parsed.data.requirePhotos;
  if (parsed.data.onlyActiveNow !== undefined) patch.only_active_now = parsed.data.onlyActiveNow;
  if (parsed.data.onlyNewToday !== undefined) patch.only_new_today = parsed.data.onlyNewToday;
  if (parsed.data.eventModeEnabled !== undefined) patch.event_mode_enabled = parsed.data.eventModeEnabled;

  const { error } = await createSupabaseAdminClient()
    .from("linkr_profiles")
    .upsert(patch, { onConflict: "user_id" });
  if (error) return { ok: false, message: "Couldn't save that. Try again." };
  return { ok: true, message: "Saved." };
}

// ---------------------------------------------------------------------------
// Photos
// ---------------------------------------------------------------------------

/**
 * PHOTO AND DATE-OF-BIRTH MANAGEMENT LIVES IN PROFILE.
 *
 * This file previously carried attachLinkrPhoto, reuseProfilePhotoAsLinkrPhoto,
 * setPrimaryLinkrPhoto, removeLinkrPhoto, reorderLinkrPhotos and
 * setDateOfBirth -- a complete second identity-management system sitting
 * beside the canonical one.
 *
 * They are gone. Profile owns the profile picture, the showcase photos and the
 * date of birth; Linkr reads a stranger-safe projection of the first two
 * (lib/linkr/media-projection.ts) and the derived age from the third. Linkr no
 * longer writes identity at all, so there is exactly one answer to who
 * somebody is and how old they are.
 */
