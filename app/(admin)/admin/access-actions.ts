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
 * NO TYPES ARE EXPORTED FROM THIS FILE. A `"use server"` module that exports a
 * type produces a Turbopack runtime ReferenceError that breaks every action in
 * it, and `tsc` does not catch it -- only a real build does. The result shape
 * is declared inline for that reason.
 *
 * Each action follows the house pattern in ./actions.ts: authorize, rate limit,
 * WRITE THE AUDIT EVENT, and only then mutate. Audit-before-mutate matters here
 * more than almost anywhere else -- these actions give away a paid product, and
 * a grant nobody can attribute is indistinguishable from an abused one. If the
 * audit write fails, the mutation does not happen.
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
     * `admin.entitlements.manage` lets somebody grant access. It does not by
     * itself let them grant a YEAR of it, or grant it forever. Long and
     * indefinite grants are an ownership decision, so they additionally require
     * `admin.access.global.manage`, which super_administrator alone holds.
     *
     * Checked here rather than in lib/access/admin so the capability system
     * stays the single authority on who may do what. */
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
      return { ok: false, message: "The audit entry could not be recorded, so no access was granted." };
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
    return { ok: true, message: "Access granted." };
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

    /* Deliberately precise about what happened. This revokes ADMIN GRANTS
       only; a paid subscription or a live welcome window is untouched, and an
       admin who reads "access revoked" and assumes otherwise would be misled. */
    return {
      ok: true,
      message:
        result.revoked === 0
          ? "No active admin grants to revoke."
          : `Revoked ${result.revoked} admin ${result.revoked === 1 ? "grant" : "grants"}. Any paid subscription or Welcome Access is unaffected.`
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
     * The first draft required `admin.roles.manage` and described it as
     * owner-only. It is not: `trust_safety_administrator` holds it too, so
     * that check would have let a T&S admin hand the entire user base a paid
     * product. `admin.access.global.manage` is granted to super_administrator
     * alone, and a test asserts no other role acquires it. */
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
    return { ok: true, message: "Mad Buddy Access is now open to everyone." };
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
    /* Says what happens next, because "ended" alone sounds like everybody
       loses access -- most people fall back to a source of their own. */
    return {
      ok: true,
      message: "Promotion ended. Everyone falls back to their own subscription, grant or Welcome Access."
    };
  } catch {
    return { ok: false, message: "Owner access is required." };
  }
}
