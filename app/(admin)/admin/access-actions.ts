"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import {
  GRANT_DURATIONS,
  durationAllowedForSupport,
  grantAccess,
  openGlobalWindow,
  revokeAdminGrants,
  revokeGlobalWindow
} from "@/lib/access/admin";
import { requireAdminPermission } from "@/lib/admin/access";
import { recordAdminAuditEvent } from "@/lib/admin/service";
import { requireSafetyAdmin } from "@/lib/safety/admin";
import { consumeRateLimit, rateLimitMessage } from "@/lib/security/rate-limit";

/**
 * Admin actions for Mad Buddy Access.
 *
 * Access is the ad-free entitlement. These actions never unlock Linkr, UpFor
 * or another core feature; they control whether Mad Buddy-controlled ads may be
 * shown while the resulting source is valid.
 *
 * NO TYPES ARE EXPORTED FROM THIS FILE. A `"use server"` module that exports a
 * type produces a Turbopack runtime ReferenceError that breaks every action in
 * it, and `tsc` does not catch it -- only a real build does. The result shape
 * is declared inline for that reason.
 *
 * Each action follows the house pattern in ./actions.ts: authorize, rate limit,
 * WRITE THE AUDIT EVENT, and only then mutate. A grant is a monetized benefit,
 * so an unattributed grant is still unacceptable even though it no longer
 * changes feature capability.
 */

const durationSchema = z.enum(
  Object.keys(GRANT_DURATIONS) as [keyof typeof GRANT_DURATIONS, ...Array<keyof typeof GRANT_DURATIONS>]
);

const grantSchema = z.object({
  userId: z.string().uuid(),
  duration: durationSchema,
  customExpiry: z.string().datetime().nullish(),
  reason: z.string().trim().min(3).max(500)
});

const revokeSchema = z.object({
  userId: z.string().uuid(),
  reason: z.string().trim().min(3).max(500)
});

const globalSchema = z.object({
  duration: durationSchema,
  customExpiry: z.string().datetime().nullish(),
  reason: z.string().trim().min(3).max(500)
});

const revokeGlobalSchema = z.object({
  windowId: z.string().uuid(),
  reason: z.string().trim().min(3).max(500)
});

export async function grantAccessAction(input: unknown): Promise<{ ok: boolean; message: string }> {
  const parsed = grantSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Check the grant details and try again." };

  try {
    const { admin, context } = await requireSafetyAdmin();
    await requireAdminPermission(admin, context, "admin.entitlements.manage");

    const limit = await consumeRateLimit({ action: "admin.mutate", userId: context.userId });
    if (!limit.allowed) return { ok: false, message: rateLimitMessage(limit.resetAt) };

    /* THE ROLE BOUNDARY.
     *
     * `admin.entitlements.manage` lets somebody grant ad-free Access. It does
     * not by itself let them grant a YEAR of it, or grant it forever. Long and
     * indefinite grants are an ownership decision, so they additionally require
     * `admin.access.global.manage`, which super_administrator alone holds. */
    const longGrant = !durationAllowedForSupport(parsed.data.duration) || Boolean(parsed.data.customExpiry);
    if (longGrant) {
      await requireAdminPermission(admin, context, "admin.access.global.manage");
    }

    const logged = await recordAdminAuditEvent(admin, {
      actorId: context.userId,
      action: "access_granted",
      targetType: "user",
      targetId: parsed.data.userId,
      previousState: undefined,
      newState: {
        duration: parsed.data.duration,
        customExpiry: parsed.data.customExpiry ?? null
      },
      reason: parsed.data.reason
    });
    if (!logged) {
      return { ok: false, message: "The audit entry could not be recorded, so no Access was granted." };
    }

    const result = await grantAccess(admin, {
      userId: parsed.data.userId,
      actorId: context.userId,
      duration: parsed.data.duration,
      customExpiry: parsed.data.customExpiry ?? null,
      reason: parsed.data.reason
    });
    if (!result.ok) return result;

    revalidatePath("/admin");
    revalidatePath("/admin/entitlements");
    return { ok: true, message: "Ad-free Access granted." };
  } catch {
    return { ok: false, message: "Admin access is required." };
  }
}

export async function revokeAccessAction(input: unknown): Promise<{ ok: boolean; message: string }> {
  const parsed = revokeSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Give a reason for this revocation." };

  try {
    const { admin, context } = await requireSafetyAdmin();
    await requireAdminPermission(admin, context, "admin.entitlements.manage");

    const limit = await consumeRateLimit({ action: "admin.mutate", userId: context.userId });
    if (!limit.allowed) return { ok: false, message: rateLimitMessage(limit.resetAt) };

    const logged = await recordAdminAuditEvent(admin, {
      actorId: context.userId,
      action: "access_revoked",
      targetType: "user",
      targetId: parsed.data.userId,
      previousState: undefined,
      newState: undefined,
      reason: parsed.data.reason
    });
    if (!logged) {
      return { ok: false, message: "The audit entry could not be recorded, so nothing was revoked." };
    }

    const result = await revokeAdminGrants(admin, {
      userId: parsed.data.userId,
      actorId: context.userId,
      reason: parsed.data.reason
    });
    if (!result.ok) return result;

    revalidatePath("/admin");
    revalidatePath("/admin/entitlements");

    return {
      ok: true,
      message:
        result.revoked === 0
          ? "No active admin grants to revoke."
          : `Revoked ${result.revoked} admin ${result.revoked === 1 ? "grant" : "grants"}. A paid subscription, Welcome Access or another live source can still keep this account ad-free.`
    };
  } catch {
    return { ok: false, message: "Admin access is required." };
  }
}

export async function openGlobalAccessAction(input: unknown): Promise<{ ok: boolean; message: string }> {
  const parsed = globalSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Check the promotion details and try again." };

  try {
    const { admin, context } = await requireSafetyAdmin();
    /* OWNER ONLY, via a DEDICATED permission.
     *
     * A global Access window makes the whole user base ad-free, so it remains
     * an owner-level monetization decision. */
    await requireAdminPermission(admin, context, "admin.entitlements.manage");
    await requireAdminPermission(admin, context, "admin.access.global.manage");

    const limit = await consumeRateLimit({ action: "admin.mutate", userId: context.userId });
    if (!limit.allowed) return { ok: false, message: rateLimitMessage(limit.resetAt) };

    const logged = await recordAdminAuditEvent(admin, {
      actorId: context.userId,
      action: "access_global_window_opened",
      targetType: "global",
      targetId: undefined,
      previousState: undefined,
      newState: { duration: parsed.data.duration, customExpiry: parsed.data.customExpiry ?? null },
      reason: parsed.data.reason
    });
    if (!logged) {
      return { ok: false, message: "The audit entry could not be recorded, so no promotion was opened." };
    }

    const result = await openGlobalWindow(admin, {
      actorId: context.userId,
      duration: parsed.data.duration,
      customExpiry: parsed.data.customExpiry ?? null,
      reason: parsed.data.reason
    });
    if (!result.ok) return result;

    revalidatePath("/admin");
    revalidatePath("/admin/entitlements");
    return { ok: true, message: "Everyone now has ad-free Mad Buddy Access for this window." };
  } catch {
    return { ok: false, message: "Owner access is required." };
  }
}

export async function closeGlobalAccessAction(input: unknown): Promise<{ ok: boolean; message: string }> {
  const parsed = revokeGlobalSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Give a reason for ending this promotion." };

  try {
    const { admin, context } = await requireSafetyAdmin();
    await requireAdminPermission(admin, context, "admin.entitlements.manage");
    await requireAdminPermission(admin, context, "admin.access.global.manage");

    const limit = await consumeRateLimit({ action: "admin.mutate", userId: context.userId });
    if (!limit.allowed) return { ok: false, message: rateLimitMessage(limit.resetAt) };

    const logged = await recordAdminAuditEvent(admin, {
      actorId: context.userId,
      action: "access_global_window_closed",
      targetType: "global",
      targetId: parsed.data.windowId,
      previousState: undefined,
      newState: undefined,
      reason: parsed.data.reason
    });
    if (!logged) {
      return { ok: false, message: "The audit entry could not be recorded, so nothing was ended." };
    }

    const result = await revokeGlobalWindow(admin, {
      windowId: parsed.data.windowId,
      actorId: context.userId,
      reason: parsed.data.reason
    });
    if (!result.ok) return result;

    revalidatePath("/admin");
    revalidatePath("/admin/entitlements");
    return {
      ok: true,
      message: "Global ad-free window ended. Each account now follows its own subscription, grant, Welcome Access or other Access source."
    };
  } catch {
    return { ok: false, message: "Owner access is required." };
  }
}
