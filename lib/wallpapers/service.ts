import "server-only";

import type { createSupabaseAdminClient } from "@/lib/supabase/admin";
import type { SubscriptionPlan } from "@/lib/supabase/database.types";
import {
  BUNDLED_WALLPAPERS,
  buildPickerCatalog,
  DEFAULT_WALLPAPER_SLUG,
  defaultResolvedWallpaper,
  resolveEffectiveWallpaper,
  type CustomWallpaperState,
  type PickerWallpaper,
  type ResolvedWallpaper,
  type WallpaperCatalogEntry
} from "@/lib/wallpapers/catalog";

type Admin = ReturnType<typeof createSupabaseAdminClient>;

/** Signed custom-wallpaper URLs are short-lived; the layout re-signs per load. */
export const CUSTOM_WALLPAPER_SIGNED_TTL_SECONDS = 60 * 60;

/**
 * Loads the full catalog (all rows, including disabled — Admin needs those).
 * Falls back to the bundled catalog if the table is missing/unreachable so the
 * picker and background never break before the migration is applied.
 */
export async function loadWallpaperCatalog(admin: Admin): Promise<WallpaperCatalogEntry[]> {
  try {
    const { data, error } = await admin
      .from("wallpapers")
      .select("id, slug, name, render_mode, tier, thumb_url, light_url, dark_url, is_enabled, sort_order, source")
      .order("sort_order", { ascending: true });
    if (error || !data || data.length === 0) return [...BUNDLED_WALLPAPERS];
    return data.map((row) => ({
      id: row.id,
      slug: row.slug,
      name: row.name,
      renderMode: row.render_mode,
      tier: row.tier,
      thumbUrl: row.thumb_url,
      lightUrl: row.light_url,
      darkUrl: row.dark_url,
      isEnabled: row.is_enabled,
      sortOrder: row.sort_order,
      source: row.source
    }));
  } catch {
    return [...BUNDLED_WALLPAPERS];
  }
}

async function loadPreferenceSlug(admin: Admin, userId: string): Promise<string | null> {
  try {
    const { data } = await admin
      .from("user_wallpaper_preferences")
      .select("selected_slug")
      .eq("user_id", userId)
      .maybeSingle();
    return data?.selected_slug ?? null;
  } catch {
    return null;
  }
}

async function loadActiveCustom(
  admin: Admin,
  userId: string,
  { sign }: { sign: boolean }
): Promise<{ state: CustomWallpaperState; id: string | null; storageKey: string | null }> {
  try {
    const { data } = await admin
      .from("custom_wallpapers")
      .select("id, storage_key")
      .eq("owner_id", userId)
      .eq("state", "active")
      .maybeSingle();
    if (!data) return { state: { url: null, isActive: false }, id: null, storageKey: null };

    let url: string | null = null;
    if (sign) {
      const { data: signed } = await admin.storage
        .from("wallpapers")
        .createSignedUrl(data.storage_key, CUSTOM_WALLPAPER_SIGNED_TTL_SECONDS);
      url = signed?.signedUrl ?? null;
    }
    return { state: { url, isActive: true }, id: data.id, storageKey: data.storage_key };
  } catch {
    return { state: { url: null, isActive: false }, id: null, storageKey: null };
  }
}

/**
 * The server-authoritative resolve used by the app layout. Never throws — any
 * failure yields the Mad Buddy Default so the app always renders. `plan` must
 * be the *effective* plan (grace/expiry honoured) from billing, not the raw
 * subscription row.
 */
export async function resolveWallpaperForRender(
  admin: Admin,
  userId: string,
  plan: SubscriptionPlan
): Promise<ResolvedWallpaper> {
  try {
    const [catalog, selectedSlug] = await Promise.all([loadWallpaperCatalog(admin), loadPreferenceSlug(admin, userId)]);
    // Only sign a custom URL when the user actually selected it AND is entitled.
    const needsCustom = selectedSlug === "custom" && plan !== "free";
    const custom = needsCustom
      ? (await loadActiveCustom(admin, userId, { sign: true })).state
      : { url: null, isActive: selectedSlug === "custom" };
    return resolveEffectiveWallpaper({ catalog, plan, selectedSlug, custom });
  } catch {
    return defaultResolvedWallpaper(true);
  }
}

/**
 * Persists a catalog-slug selection ('mad-buddy-default', 'plain', or an
 * enabled catalog slug). Entitlement is enforced here: an ineligible or unknown
 * slug is rejected, so a client can never write a premium slug it can't use.
 */
export async function setWallpaperSelection(
  admin: Admin,
  input: { userId: string; plan: SubscriptionPlan; slug: string }
): Promise<{ ok: boolean; reason?: "unknown" | "locked" }> {
  const catalog = await loadWallpaperCatalog(admin);
  const entry = catalog.find((item) => item.slug === input.slug);
  if (!entry || !entry.isEnabled) return { ok: false, reason: "unknown" };
  // Reuse the pure access rule.
  const { canAccessTier } = await import("@/lib/wallpapers/catalog");
  if (!canAccessTier(input.plan, entry.tier)) return { ok: false, reason: "locked" };

  const { error } = await admin
    .from("user_wallpaper_preferences")
    .upsert({ user_id: input.userId, selected_slug: input.slug, updated_at: new Date().toISOString() });
  return { ok: !error };
}

/** Points a user's preference at their custom upload (premium only). */
export async function selectCustomWallpaper(admin: Admin, userId: string): Promise<{ ok: boolean }> {
  const { error } = await admin
    .from("user_wallpaper_preferences")
    .upsert({ user_id: userId, selected_slug: "custom", updated_at: new Date().toISOString() });
  return { ok: !error };
}

/**
 * Registers an uploaded custom wallpaper: supersedes any prior active one
 * (marks it removed and best-effort deletes its object) and inserts the new
 * metadata row. Bytes are already in the private bucket.
 */
export async function registerCustomWallpaper(
  admin: Admin,
  input: { userId: string; storageKey: string; mimeType: "image/webp"; sizeBytes: number; width: number; height: number }
): Promise<{ ok: boolean }> {
  const previous = await loadActiveCustom(admin, input.userId, { sign: false });
  if (previous.id && previous.storageKey) {
    await admin.from("custom_wallpapers").update({ state: "removed", updated_at: new Date().toISOString() }).eq("id", previous.id);
    await admin.storage.from("wallpapers").remove([previous.storageKey]).catch(() => undefined);
  }
  const { error } = await admin.from("custom_wallpapers").insert({
    owner_id: input.userId,
    storage_key: input.storageKey,
    mime_type: input.mimeType,
    size_bytes: input.sizeBytes,
    width: input.width,
    height: input.height,
    state: "active"
  });
  return { ok: !error };
}

export type WallpaperPickerData = {
  picker: PickerWallpaper[];
  selectedSlug: string;
  custom: { hasActive: boolean; thumbUrl: string | null; canUse: boolean };
};

/** Everything the settings picker needs in one round of loads. */
export async function loadWallpaperPickerData(
  admin: Admin,
  userId: string,
  plan: SubscriptionPlan
): Promise<WallpaperPickerData> {
  const [catalog, selectedSlug, custom] = await Promise.all([
    loadWallpaperCatalog(admin),
    loadPreferenceSlug(admin, userId),
    loadActiveCustom(admin, userId, { sign: true })
  ]);
  return {
    picker: buildPickerCatalog(catalog, plan),
    selectedSlug: selectedSlug ?? DEFAULT_WALLPAPER_SLUG,
    custom: { hasActive: custom.state.isActive, thumbUrl: custom.state.url, canUse: plan !== "free" }
  };
}

/** Whether the user currently has an active custom upload (for the picker). */
export async function loadCustomWallpaperSummary(
  admin: Admin,
  userId: string
): Promise<{ hasActive: boolean; thumbUrl: string | null }> {
  const custom = await loadActiveCustom(admin, userId, { sign: true });
  return { hasActive: custom.state.isActive, thumbUrl: custom.state.url };
}

export { DEFAULT_WALLPAPER_SLUG };
