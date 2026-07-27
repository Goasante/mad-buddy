"use server";

import { revalidatePath } from "next/cache";
import { requireAdminPermission } from "@/lib/admin/access";
import { recordAdminAuditEvent } from "@/lib/admin/service";
import { requireSafetyAdmin } from "@/lib/safety/admin";
import { consumeRateLimit, rateLimitMessage } from "@/lib/security/rate-limit";
import {
  applyWallpaperUpdate,
  createWallpaperSchema,
  findWallpaperById,
  insertWallpaper,
  updateWallpaperSchema
} from "@/lib/wallpapers/admin";
import { z } from "zod";

// Per project rule, this "use server" module exports no types — actions return
// a structural { ok, message } the admin client types on its own side.

const PERMISSION = "admin.wallpapers.manage" as const;

async function guard() {
  const { admin, context } = await requireSafetyAdmin();
  await requireAdminPermission(admin, context, PERMISSION);
  const limit = await consumeRateLimit({ action: "admin.mutate", userId: context.userId });
  if (!limit.allowed) return { admin, context, blocked: rateLimitMessage(limit.resetAt) as string };
  return { admin, context, blocked: null as string | null };
}

export async function createWallpaperAction(input: unknown): Promise<{ ok: boolean; message: string }> {
  const parsed = createWallpaperSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Fill in a valid slug, name, mode and tier." };

  try {
    const { admin, context, blocked } = await guard();
    if (blocked) return { ok: false, message: blocked };

    const result = await insertWallpaper(admin, parsed.data, context.userId);
    if (!result.ok) {
      return { ok: false, message: result.reason === "duplicate_slug" ? "That slug is already in use." : "Could not create the wallpaper." };
    }

    const logged = await recordAdminAuditEvent(admin, {
      actorId: context.userId,
      action: "wallpaper_created",
      targetType: "wallpaper",
      targetId: result.id,
      newState: { slug: parsed.data.slug, tier: parsed.data.tier, render_mode: parsed.data.renderMode },
      reason: "Wallpaper catalog management"
    });
    if (!logged) return { ok: false, message: "The audit entry could not be recorded, so no change was made." };

    revalidatePath("/admin/wallpapers");
    return { ok: true, message: "Wallpaper added." };
  } catch {
    return { ok: false, message: "You don’t have permission to manage wallpapers." };
  }
}

export async function updateWallpaperMetadataAction(input: unknown): Promise<{ ok: boolean; message: string }> {
  const parsed = updateWallpaperSchema
    .pick({ id: true, name: true, thumbUrl: true, lightUrl: true, darkUrl: true, sortOrder: true })
    .safeParse(input);
  if (!parsed.success) return { ok: false, message: "Enter valid wallpaper details." };

  try {
    const { admin, context, blocked } = await guard();
    if (blocked) return { ok: false, message: blocked };

    const before = await findWallpaperById(admin, parsed.data.id);
    if (!before) return { ok: false, message: "That wallpaper no longer exists." };

    const result = await applyWallpaperUpdate(admin, parsed.data);
    if (!result.ok) return { ok: false, message: "Could not update the wallpaper." };

    const logged = await recordAdminAuditEvent(admin, {
      actorId: context.userId,
      action: "wallpaper_updated",
      targetType: "wallpaper",
      targetId: parsed.data.id,
      previousState: { name: before.name, sort_order: before.sortOrder },
      newState: { name: parsed.data.name ?? before.name, sort_order: parsed.data.sortOrder ?? before.sortOrder },
      reason: "Wallpaper catalog management"
    });
    if (!logged) return { ok: false, message: "The audit entry could not be recorded, so no change was made." };

    revalidatePath("/admin/wallpapers");
    return { ok: true, message: "Wallpaper updated." };
  } catch {
    return { ok: false, message: "You don’t have permission to manage wallpapers." };
  }
}

const tierSchema = z.object({ id: z.string().uuid(), tier: z.enum(["free", "buddy_plus", "buddy_pro"]) });

export async function setWallpaperTierAction(input: unknown): Promise<{ ok: boolean; message: string }> {
  const parsed = tierSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Choose a valid tier." };

  try {
    const { admin, context, blocked } = await guard();
    if (blocked) return { ok: false, message: blocked };

    const before = await findWallpaperById(admin, parsed.data.id);
    if (!before) return { ok: false, message: "That wallpaper no longer exists." };
    if (before.tier === parsed.data.tier) return { ok: true, message: "No change." };

    const result = await applyWallpaperUpdate(admin, { id: parsed.data.id, tier: parsed.data.tier });
    if (!result.ok) return { ok: false, message: "Could not change the tier." };

    const logged = await recordAdminAuditEvent(admin, {
      actorId: context.userId,
      action: "wallpaper_tier_changed",
      targetType: "wallpaper",
      targetId: parsed.data.id,
      previousState: { tier: before.tier },
      newState: { tier: parsed.data.tier },
      reason: "Wallpaper access tier change"
    });
    if (!logged) return { ok: false, message: "The audit entry could not be recorded, so no change was made." };

    revalidatePath("/admin/wallpapers");
    return { ok: true, message: "Tier updated." };
  } catch {
    return { ok: false, message: "You don’t have permission to manage wallpapers." };
  }
}

const enabledSchema = z.object({ id: z.string().uuid(), isEnabled: z.boolean() });

export async function setWallpaperEnabledAction(input: unknown): Promise<{ ok: boolean; message: string }> {
  const parsed = enabledSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Invalid request." };

  try {
    const { admin, context, blocked } = await guard();
    if (blocked) return { ok: false, message: blocked };

    const before = await findWallpaperById(admin, parsed.data.id);
    if (!before) return { ok: false, message: "That wallpaper no longer exists." };

    // Never let the last enabled fallback (the Mad Buddy Default) be disabled —
    // users must always keep a usable background.
    if (!parsed.data.isEnabled && before.slug === "mad-buddy-default") {
      return { ok: false, message: "Mad Buddy Default can’t be disabled — it’s the safe fallback." };
    }

    const result = await applyWallpaperUpdate(admin, { id: parsed.data.id, isEnabled: parsed.data.isEnabled });
    if (!result.ok) return { ok: false, message: "Could not update the wallpaper." };

    const logged = await recordAdminAuditEvent(admin, {
      actorId: context.userId,
      action: parsed.data.isEnabled ? "wallpaper_enabled" : "wallpaper_disabled",
      targetType: "wallpaper",
      targetId: parsed.data.id,
      previousState: { is_enabled: before.isEnabled },
      newState: { is_enabled: parsed.data.isEnabled },
      reason: parsed.data.isEnabled ? "Wallpaper enabled" : "Wallpaper retired/disabled"
    });
    if (!logged) return { ok: false, message: "The audit entry could not be recorded, so no change was made." };

    revalidatePath("/admin/wallpapers");
    return { ok: true, message: parsed.data.isEnabled ? "Wallpaper enabled." : "Wallpaper disabled." };
  } catch {
    return { ok: false, message: "You don’t have permission to manage wallpapers." };
  }
}
