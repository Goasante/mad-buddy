"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAdminPermission } from "@/lib/admin/access";
import { recordAdminAuditEvent } from "@/lib/admin/service";
import { requireSafetyAdmin } from "@/lib/safety/admin";
import { consumeRateLimit, rateLimitMessage } from "@/lib/security/rate-limit";
import { isBooleanEntitlementKey, isNumericEntitlementKey } from "@/lib/billing/entitlement-catalog";
import { refreshTierOverrides } from "@/lib/billing/tier-overrides-loader";

export type EntitlementActionState = { ok: boolean; message: string };

type Admin = Awaited<ReturnType<typeof requireSafetyAdmin>>["admin"];

async function authorize() {
  const { admin, context } = await requireSafetyAdmin();
  await requireAdminPermission(admin, context, "admin.entitlements.manage");
  const limit = await consumeRateLimit({ action: "admin.mutate", userId: context.userId });
  if (!limit.allowed) return { ok: false as const, message: rateLimitMessage(limit.resetAt) };
  return { ok: true as const, admin, actorId: context.userId };
}

const setSchema = z.object({
  plan: z.enum(["free", "buddy_plus", "buddy_pro"]),
  key: z.string().min(1).max(60),
  // Numeric value; `unlimited` sets +Infinity. Ignored for boolean keys.
  numericValue: z.number().int().min(0).max(1_000_000_000).nullable().optional(),
  unlimited: z.boolean().optional(),
  booleanValue: z.boolean().optional()
});

/** Override one entitlement for one tier (or update an existing override). */
export async function setTierEntitlementAction(input: unknown): Promise<EntitlementActionState> {
  const parsed = setSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Invalid entitlement change." };

  const { plan, key } = parsed.data;
  const numeric = isNumericEntitlementKey(key);
  const boolean = isBooleanEntitlementKey(key);
  if (!numeric && !boolean) return { ok: false, message: "Unknown entitlement key." };

  let admin: Admin;
  let actorId: string;
  try {
    const auth = await authorize();
    if (!auth.ok) return auth;
    admin = auth.admin;
    actorId = auth.actorId;
  } catch {
    return { ok: false, message: "You don't have permission to edit entitlements." };
  }

  const unlimited = numeric ? Boolean(parsed.data.unlimited) : false;
  const numericValue = numeric && !unlimited ? parsed.data.numericValue ?? 0 : null;
  const booleanValue = boolean ? Boolean(parsed.data.booleanValue) : null;

  const logged = await recordAdminAuditEvent(admin, {
    actorId,
    action: "tier_entitlement_set",
    targetType: "subscription",
    targetId: `${plan}:${key}`,
    newState: { plan, key, unlimited, numericValue, booleanValue },
    reason: "Tier entitlement override"
  });
  if (!logged) return { ok: false, message: "The audit entry could not be recorded, so nothing was changed." };

  const { error } = await admin.from("tier_entitlement_overrides").upsert(
    {
      plan,
      entitlement_key: key,
      value_type: numeric ? "number" : "boolean",
      numeric_value: numericValue,
      is_unlimited: unlimited,
      boolean_value: booleanValue,
      updated_by: actorId,
      updated_at: new Date().toISOString()
    },
    { onConflict: "plan,entitlement_key" }
  );
  if (error) return { ok: false, message: "The entitlement could not be saved." };

  await refreshTierOverrides(admin); // apply immediately
  revalidatePath("/admin/entitlements");
  return { ok: true, message: "Entitlement updated." };
}

const resetSchema = z.object({
  plan: z.enum(["free", "buddy_plus", "buddy_pro"]),
  key: z.string().min(1).max(60)
});

/** Remove a tier override so the entitlement reverts to the code default. */
export async function resetTierEntitlementAction(input: unknown): Promise<EntitlementActionState> {
  const parsed = resetSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Invalid entitlement reset." };

  let admin: Admin;
  let actorId: string;
  try {
    const auth = await authorize();
    if (!auth.ok) return auth;
    admin = auth.admin;
    actorId = auth.actorId;
  } catch {
    return { ok: false, message: "You don't have permission to edit entitlements." };
  }

  const logged = await recordAdminAuditEvent(admin, {
    actorId,
    action: "tier_entitlement_reset",
    targetType: "subscription",
    targetId: `${parsed.data.plan}:${parsed.data.key}`,
    reason: "Tier entitlement reverted to default"
  });
  if (!logged) return { ok: false, message: "The audit entry could not be recorded, so nothing was changed." };

  const { error } = await admin
    .from("tier_entitlement_overrides")
    .delete()
    .eq("plan", parsed.data.plan)
    .eq("entitlement_key", parsed.data.key);
  if (error) return { ok: false, message: "The entitlement could not be reset." };

  await refreshTierOverrides(admin);
  revalidatePath("/admin/entitlements");
  return { ok: true, message: "Reverted to default." };
}
