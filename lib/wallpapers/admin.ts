import "server-only";

import { z } from "zod";
import type { createSupabaseAdminClient } from "@/lib/supabase/admin";
import type { Database } from "@/lib/supabase/database.types";
import type { WallpaperTier } from "@/lib/wallpapers/catalog";

type Admin = ReturnType<typeof createSupabaseAdminClient>;

/**
 * Admin-side wallpaper catalog mutations. These are the raw DB writes; the
 * server actions in app/(admin)/admin/wallpapers/actions.ts wrap each one with
 * the permission gate, rate limit, and an append-only audit record. Keeping the
 * writes here keeps validation in one testable place.
 */

export const wallpaperSlugSchema = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9][a-z0-9-]*$/, "Use lowercase letters, numbers and hyphens.");

// Absent (undefined) means "leave unchanged" on a partial update; an empty
// string means "clear it" (→ null). Preserving undefined is what stops a
// metadata update that omits URLs from wiping an existing image.
const urlOrNull = z
  .string()
  .trim()
  .max(500)
  .optional()
  .transform((value) => (value === undefined ? undefined : value.length > 0 ? value : null));

export const createWallpaperSchema = z.object({
  slug: wallpaperSlugSchema,
  name: z.string().trim().min(1).max(80),
  renderMode: z.enum(["ambient", "plain", "image"]),
  tier: z.enum(["free", "buddy_plus", "buddy_pro"]),
  thumbUrl: urlOrNull,
  lightUrl: urlOrNull,
  darkUrl: urlOrNull,
  sortOrder: z.number().int().min(0).max(9999).default(100)
});

export const updateWallpaperSchema = z.object({
  id: z.string().uuid(),
  name: z.string().trim().min(1).max(80).optional(),
  tier: z.enum(["free", "buddy_plus", "buddy_pro"]).optional(),
  thumbUrl: urlOrNull,
  lightUrl: urlOrNull,
  darkUrl: urlOrNull,
  sortOrder: z.number().int().min(0).max(9999).optional(),
  isEnabled: z.boolean().optional()
});

export type WallpaperAdminRow = {
  id: string;
  slug: string;
  name: string;
  renderMode: "ambient" | "plain" | "image";
  tier: WallpaperTier;
  thumbUrl: string | null;
  lightUrl: string | null;
  darkUrl: string | null;
  isEnabled: boolean;
  sortOrder: number;
  source: "bundled" | "managed" | "custom";
};

/** Full catalog for the Admin table (includes disabled rows). */
export async function loadAdminWallpapers(admin: Admin): Promise<WallpaperAdminRow[]> {
  const { data } = await admin
    .from("wallpapers")
    .select("id, slug, name, render_mode, tier, thumb_url, light_url, dark_url, is_enabled, sort_order, source")
    .order("sort_order", { ascending: true });
  return (data ?? []).map((row) => ({
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
}

export async function findWallpaperById(admin: Admin, id: string): Promise<WallpaperAdminRow | null> {
  const { data } = await admin
    .from("wallpapers")
    .select("id, slug, name, render_mode, tier, thumb_url, light_url, dark_url, is_enabled, sort_order, source")
    .eq("id", id)
    .maybeSingle();
  if (!data) return null;
  return {
    id: data.id,
    slug: data.slug,
    name: data.name,
    renderMode: data.render_mode,
    tier: data.tier,
    thumbUrl: data.thumb_url,
    lightUrl: data.light_url,
    darkUrl: data.dark_url,
    isEnabled: data.is_enabled,
    sortOrder: data.sort_order,
    source: data.source
  };
}

export async function insertWallpaper(
  admin: Admin,
  input: z.infer<typeof createWallpaperSchema>,
  createdBy: string
): Promise<{ ok: boolean; id?: string; reason?: "duplicate_slug" | "error" }> {
  const { data: existing } = await admin.from("wallpapers").select("id").eq("slug", input.slug).maybeSingle();
  if (existing) return { ok: false, reason: "duplicate_slug" };

  const { data, error } = await admin
    .from("wallpapers")
    .insert({
      slug: input.slug,
      name: input.name,
      render_mode: input.renderMode,
      tier: input.tier,
      thumb_url: input.thumbUrl,
      light_url: input.lightUrl,
      dark_url: input.darkUrl,
      sort_order: input.sortOrder,
      source: "managed",
      created_by: createdBy
    })
    .select("id")
    .maybeSingle();
  if (error || !data) return { ok: false, reason: "error" };
  return { ok: true, id: data.id };
}

export type WallpaperUpdateInput = {
  id: string;
  name?: string;
  tier?: WallpaperTier;
  thumbUrl?: string | null;
  lightUrl?: string | null;
  darkUrl?: string | null;
  sortOrder?: number;
  isEnabled?: boolean;
};

export async function applyWallpaperUpdate(admin: Admin, input: WallpaperUpdateInput): Promise<{ ok: boolean }> {
  const patch: Database["public"]["Tables"]["wallpapers"]["Update"] = { updated_at: new Date().toISOString() };
  if (input.name !== undefined) patch.name = input.name;
  if (input.tier !== undefined) patch.tier = input.tier;
  if (input.thumbUrl !== undefined) patch.thumb_url = input.thumbUrl;
  if (input.lightUrl !== undefined) patch.light_url = input.lightUrl;
  if (input.darkUrl !== undefined) patch.dark_url = input.darkUrl;
  if (input.sortOrder !== undefined) patch.sort_order = input.sortOrder;
  if (input.isEnabled !== undefined) patch.is_enabled = input.isEnabled;

  const { error } = await admin.from("wallpapers").update(patch).eq("id", input.id);
  return { ok: !error };
}
