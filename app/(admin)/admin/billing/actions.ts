"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAdminPermission } from "@/lib/admin/access";
import { recordAdminAuditEvent } from "@/lib/admin/service";
import { requireSafetyAdmin } from "@/lib/safety/admin";
import { consumeRateLimit, rateLimitMessage } from "@/lib/security/rate-limit";
import { isOverrideableEntitlement, planLabel } from "@/lib/admin/billing-admin";
import { paystackRequest } from "@/lib/paystack/client";
import { getPaystackSecretKey } from "@/lib/paystack/config";
import { mapPaystackSubscriptionStatus } from "@/lib/paystack/subscriptions";
import type { AdminPermission } from "@/lib/admin/governance";

export type BillingActionState = { ok: boolean; message: string };

type Admin = Awaited<ReturnType<typeof requireSafetyAdmin>>["admin"];

async function authorizeBilling(permission: AdminPermission) {
  const { admin, context } = await requireSafetyAdmin();
  await requireAdminPermission(admin, context, permission);
  const limit = await consumeRateLimit({ action: "admin.mutate", userId: context.userId });
  if (!limit.allowed) return { ok: false as const, message: rateLimitMessage(limit.resetAt) };
  return { ok: true as const, admin, actorId: context.userId };
}

// ---------------------------------------------------------------------------
// Reconcile with Paystack — re-fetch the source of truth and sync. No admin-
// decided value is written; only what Paystack reports. Gated on billing.view.
// ---------------------------------------------------------------------------
const reconcileSchema = z.object({ userId: z.string().uuid() });

export async function reconcileSubscriptionAction(input: unknown): Promise<BillingActionState> {
  const parsed = reconcileSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Choose a valid account." };

  let admin: Admin;
  let actorId: string;
  try {
    const auth = await authorizeBilling("admin.billing.view");
    if (!auth.ok) return auth;
    admin = auth.admin;
    actorId = auth.actorId;
  } catch {
    return { ok: false, message: "Billing access is required." };
  }

  if (!getPaystackSecretKey()) return { ok: false, message: "Paystack isn't configured, so reconciliation is unavailable." };

  const { data: sub } = await admin
    .from("subscriptions")
    .select("id, status, paystack_subscription_code")
    .eq("user_id", parsed.data.userId)
    .maybeSingle();
  if (!sub) return { ok: false, message: "No subscription record for that account." };
  if (!sub.paystack_subscription_code) return { ok: false, message: "No Paystack subscription is linked to reconcile." };

  let remote: { status?: string; next_payment_date?: string | null };
  try {
    remote = await paystackRequest<{ status?: string; next_payment_date?: string | null }>(
      `/subscription/${sub.paystack_subscription_code}`
    );
  } catch {
    return { ok: false, message: "Paystack couldn't be reached. No change was made." };
  }

  const mappedStatus = mapPaystackSubscriptionStatus(remote.status);
  const nextStatus = mappedStatus === "free" ? "active" : mappedStatus;

  const logged = await recordAdminAuditEvent(admin, {
    actorId,
    action: "subscription_reconciled",
    targetType: "subscription",
    targetId: sub.id,
    previousState: { status: sub.status },
    newState: { status: nextStatus, source: "paystack" },
    reason: "Billing reconciliation"
  });
  if (!logged) return { ok: false, message: "The audit entry could not be recorded, so nothing was changed." };

  const { error } = await admin
    .from("subscriptions")
    .update({
      status: nextStatus,
      current_period_end: remote.next_payment_date ?? undefined
    })
    .eq("id", sub.id);
  if (error) return { ok: false, message: "The subscription could not be updated." };

  revalidatePath("/admin/billing");
  revalidatePath(`/admin/billing/${parsed.data.userId}`);
  return { ok: true, message: `Reconciled with Paystack (status: ${nextStatus}).` };
}

// ---------------------------------------------------------------------------
// Entitlement override (comp) — grant a premium feature to one user.
// ---------------------------------------------------------------------------
const grantSchema = z.object({
  userId: z.string().uuid(),
  entitlementKey: z.string().min(1).max(60),
  endsAt: z.string().datetime().optional(),
  reason: z.string().trim().min(3).max(200)
});

export async function grantEntitlementOverrideAction(input: unknown): Promise<BillingActionState> {
  const parsed = grantSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Choose a feature and add a short reason." };
  if (!isOverrideableEntitlement(parsed.data.entitlementKey)) {
    return { ok: false, message: "That entitlement can't be granted here." };
  }

  let admin: Admin;
  let actorId: string;
  try {
    const auth = await authorizeBilling("admin.billing.refund");
    if (!auth.ok) return auth;
    admin = auth.admin;
    actorId = auth.actorId;
  } catch {
    return { ok: false, message: "You don't have permission to change billing." };
  }

  const { data: profile } = await admin.from("profiles").select("user_id, deleted_at").eq("user_id", parsed.data.userId).maybeSingle();
  if (!profile || profile.deleted_at) return { ok: false, message: "That account is unavailable." };

  const logged = await recordAdminAuditEvent(admin, {
    actorId,
    action: "entitlement_override_granted",
    targetType: "user",
    targetId: parsed.data.userId,
    newState: { entitlementKey: parsed.data.entitlementKey, value: true, endsAt: parsed.data.endsAt ?? null },
    reason: parsed.data.reason
  });
  if (!logged) return { ok: false, message: "The audit entry could not be recorded, so nothing was granted." };

  const { error } = await admin.from("entitlement_overrides").insert({
    subject_type: "user",
    subject_id: parsed.data.userId,
    entitlement_key: parsed.data.entitlementKey,
    value_type: "boolean",
    boolean_value: true,
    reason: parsed.data.reason,
    starts_at: new Date().toISOString(),
    ends_at: parsed.data.endsAt ?? null,
    created_by: actorId
  });
  if (error) return { ok: false, message: "The override could not be saved." };

  revalidatePath(`/admin/billing/${parsed.data.userId}`);
  return { ok: true, message: "Entitlement granted." };
}

const revokeSchema = z.object({ overrideId: z.string().uuid(), userId: z.string().uuid() });

export async function revokeEntitlementOverrideAction(input: unknown): Promise<BillingActionState> {
  const parsed = revokeSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Choose a valid override." };

  let admin: Admin;
  let actorId: string;
  try {
    const auth = await authorizeBilling("admin.billing.refund");
    if (!auth.ok) return auth;
    admin = auth.admin;
    actorId = auth.actorId;
  } catch {
    return { ok: false, message: "You don't have permission to change billing." };
  }

  const { data: existing } = await admin
    .from("entitlement_overrides")
    .select("id, entitlement_key, ends_at")
    .eq("id", parsed.data.overrideId)
    .maybeSingle();
  if (!existing) return { ok: false, message: "That override is unavailable." };

  const logged = await recordAdminAuditEvent(admin, {
    actorId,
    action: "entitlement_override_revoked",
    targetType: "user",
    targetId: parsed.data.userId,
    previousState: { entitlementKey: existing.entitlement_key },
    reason: "Billing override revoked"
  });
  if (!logged) return { ok: false, message: "The audit entry could not be recorded, so nothing was changed." };

  // Soft-expire so the record and its reason remain auditable.
  const { error } = await admin.from("entitlement_overrides").update({ ends_at: new Date().toISOString() }).eq("id", existing.id);
  if (error) return { ok: false, message: "The override could not be revoked." };

  revalidatePath(`/admin/billing/${parsed.data.userId}`);
  return { ok: true, message: "Entitlement override revoked." };
}

// ---------------------------------------------------------------------------
// Change plan (upgrade / downgrade) — a manual admin override of the user's
// plan. Gated on admin.billing.manage_plan (owner / admin / support).
// ---------------------------------------------------------------------------
const PLAN_RANK: Record<string, number> = { free: 0, buddy_plus: 1, buddy_pro: 2 };
const changePlanSchema = z.object({
  userId: z.string().uuid(),
  plan: z.enum(["free", "buddy_plus", "buddy_pro"]),
  reason: z.string().trim().min(3).max(200)
});

export async function changeSubscriptionPlanAction(input: unknown): Promise<BillingActionState> {
  const parsed = changePlanSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: "Choose a plan and add a short reason (3+ characters)." };
  }

  let admin: Admin;
  let actorId: string;
  try {
    const auth = await authorizeBilling("admin.billing.manage_plan");
    if (!auth.ok) return auth;
    admin = auth.admin;
    actorId = auth.actorId;
  } catch {
    return { ok: false, message: "You don't have permission to change plans." };
  }

  const { data: sub } = await admin
    .from("subscriptions")
    .select("id, plan, status")
    .eq("user_id", parsed.data.userId)
    .maybeSingle();
  if (!sub) return { ok: false, message: "No subscription record for that account." };
  if (sub.plan === parsed.data.plan) {
    return { ok: true, message: `Already on ${planLabel(parsed.data.plan)}.` };
  }

  const toPaid = parsed.data.plan !== "free";
  const nextStatus = toPaid ? "active" : "free";
  const changeType = PLAN_RANK[parsed.data.plan] > PLAN_RANK[sub.plan] ? "upgrade" : "downgrade";

  // Audit-first: an unlogged billing change is worse than a failed one.
  const logged = await recordAdminAuditEvent(admin, {
    actorId,
    action: "subscription_plan_changed",
    targetType: "subscription",
    targetId: sub.id,
    previousState: { plan: sub.plan, status: sub.status },
    newState: { plan: parsed.data.plan, status: nextStatus, source: "manual" },
    reason: parsed.data.reason
  });
  if (!logged) return { ok: false, message: "The audit entry could not be recorded, so nothing was changed." };

  const nowIso = new Date().toISOString();
  const { error } = await admin
    .from("subscriptions")
    .update({
      plan: parsed.data.plan,
      status: nextStatus,
      // A fresh paid grant shouldn't inherit a pending cancellation.
      ...(toPaid ? { cancel_at_period_end: false } : {}),
      updated_at: nowIso
    })
    .eq("id", sub.id);
  if (error) return { ok: false, message: "The plan could not be changed." };

  await admin.from("subscription_changes").insert({
    subscription_id: sub.id,
    user_id: parsed.data.userId,
    change_type: changeType,
    from_plan: sub.plan,
    to_plan: parsed.data.plan,
    effective_at: nowIso,
    applied_at: nowIso,
    status: "applied",
    reason: parsed.data.reason
  });

  revalidatePath("/admin/billing");
  revalidatePath(`/admin/billing/${parsed.data.userId}`);
  return { ok: true, message: `Plan changed to ${planLabel(parsed.data.plan)} (${changeType}).` };
}

// ---------------------------------------------------------------------------
// Cancel at period end / reactivate — a real, safe subscription control.
// ---------------------------------------------------------------------------
const cancelSchema = z.object({ userId: z.string().uuid(), cancel: z.boolean(), reason: z.string().trim().max(200).optional() });

export async function setCancelAtPeriodEndAction(input: unknown): Promise<BillingActionState> {
  const parsed = cancelSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Choose a valid account." };

  let admin: Admin;
  let actorId: string;
  try {
    const auth = await authorizeBilling("admin.billing.refund");
    if (!auth.ok) return auth;
    admin = auth.admin;
    actorId = auth.actorId;
  } catch {
    return { ok: false, message: "You don't have permission to change billing." };
  }

  const { data: sub } = await admin
    .from("subscriptions")
    .select("id, plan, cancel_at_period_end, current_period_end")
    .eq("user_id", parsed.data.userId)
    .maybeSingle();
  if (!sub) return { ok: false, message: "No subscription record for that account." };
  if (sub.plan === "free") return { ok: false, message: "There's no paid plan to change." };
  if (sub.cancel_at_period_end === parsed.data.cancel) {
    return { ok: true, message: parsed.data.cancel ? "Already set to cancel at period end." : "Already active." };
  }

  const logged = await recordAdminAuditEvent(admin, {
    actorId,
    action: parsed.data.cancel ? "subscription_cancel_scheduled" : "subscription_reactivated",
    targetType: "subscription",
    targetId: sub.id,
    previousState: { cancelAtPeriodEnd: sub.cancel_at_period_end },
    newState: { cancelAtPeriodEnd: parsed.data.cancel },
    reason: parsed.data.reason || "Billing lifecycle change"
  });
  if (!logged) return { ok: false, message: "The audit entry could not be recorded, so nothing was changed." };

  const { error } = await admin.from("subscriptions").update({ cancel_at_period_end: parsed.data.cancel }).eq("id", sub.id);
  if (error) return { ok: false, message: "The subscription could not be updated." };

  // Record the lifecycle change (no plan movement here; from/to stay the same).
  await admin.from("subscription_changes").insert({
    subscription_id: sub.id,
    user_id: parsed.data.userId,
    change_type: parsed.data.cancel ? "cancel" : "reactivate",
    from_plan: sub.plan,
    to_plan: sub.plan,
    effective_at: sub.current_period_end,
    status: "scheduled",
    reason: parsed.data.reason || null
  });

  revalidatePath(`/admin/billing/${parsed.data.userId}`);
  return { ok: true, message: parsed.data.cancel ? "Set to cancel at period end." : "Reactivated." };
}
