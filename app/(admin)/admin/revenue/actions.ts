"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAdminPermission } from "@/lib/admin/access";
import { recordAdminAuditEvent } from "@/lib/admin/service";
import { reconcileMissingPaystackFees } from "@/lib/revenue/paystack-fees";
import { captureDailyFinancialSnapshots } from "@/lib/revenue/snapshots";
import { consumeRateLimit, rateLimitMessage } from "@/lib/security/rate-limit";
import { requireSafetyAdmin } from "@/lib/safety/admin";

export type FinancialActionState = { ok: boolean; message: string };

const providerCostSchema = z.object({
  provider: z.string().trim().min(1).max(64).regex(/^[a-zA-Z0-9 ._-]+$/),
  billingPeriod: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
  currency: z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/),
  amount: z.string().trim().regex(/^\d{1,12}(\.\d{1,2})?$/),
  category: z.enum(["database", "hosting", "email", "sms", "media_storage", "push", "api", "other"]),
  source: z.enum(["manual", "invoice", "api"]),
  notes: z.string().trim().max(500),
  reason: z.string().trim().min(3).max(500)
});

const alertRuleKeys = ["mrr_drop", "cancellation_spike", "payment_failure_spike", "recovery_rate_drop", "infrastructure_cost_spike"] as const;
const alertRulesSchema = z.object({
  rules: z.array(z.object({ ruleKey: z.enum(alertRuleKeys), enabled: z.boolean(), thresholdPercent: z.number().positive().max(1000) })).length(alertRuleKeys.length),
  reason: z.string().trim().min(3).max(500)
});

export async function saveProviderCostAction(input: unknown): Promise<FinancialActionState> {
  const parsed = providerCostSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Check the provider, month, currency, amount, and change reason." };
  const auth = await requireFinancialOwner();
  if (!auth.ok) return auth.result;
  const limit = await consumeRateLimit({ action: "admin.mutate", userId: auth.context.userId });
  if (!limit.allowed) return { ok: false, message: rateLimitMessage(limit.resetAt) };

  const amountMinor = decimalToMinor(parsed.data.amount);
  const billingPeriod = `${parsed.data.billingPeriod}-01`;
  const provider = parsed.data.provider.trim();
  const { data: existing, error: existingError } = await auth.admin
    .from("provider_cost_records")
    .select("id, amount_minor, source, notes")
    .eq("provider", provider)
    .eq("billing_period", billingPeriod)
    .eq("currency", parsed.data.currency)
    .eq("category", parsed.data.category)
    .maybeSingle();
  if (existingError) return { ok: false, message: "The existing cost record could not be checked." };
  const id = existing?.id ?? randomUUID();
  const nextState = {
    provider,
    billingPeriod,
    currency: parsed.data.currency,
    amountMinor,
    category: parsed.data.category,
    source: parsed.data.source,
    notes: parsed.data.notes || null
  };
  const logged = await recordAdminAuditEvent(auth.admin, {
    actorId: auth.context.userId,
    actorRole: auth.context.email,
    action: existing ? "provider_cost_updated" : "provider_cost_created",
    targetType: "provider_cost",
    targetId: id,
    previousState: existing ? { amountMinor: existing.amount_minor, source: existing.source, notes: existing.notes } : undefined,
    newState: nextState,
    reason: parsed.data.reason
  });
  if (!logged) return { ok: false, message: "The audit entry could not be recorded, so no cost was saved." };

  const now = new Date().toISOString();
  const { error } = await auth.admin.from("provider_cost_records").upsert({
    id,
    provider,
    billing_period: billingPeriod,
    currency: parsed.data.currency,
    amount_minor: amountMinor,
    category: parsed.data.category,
    source: parsed.data.source,
    notes: parsed.data.notes || null,
    created_by: auth.context.userId,
    updated_at: now
  }, { onConflict: "provider,billing_period,currency,category" });
  if (error) return { ok: false, message: "The provider cost could not be saved." };
  revalidatePath("/admin/revenue");
  return { ok: true, message: existing ? "Provider cost updated." : "Provider cost added." };
}

export async function updateBusinessAlertRulesAction(input: unknown): Promise<FinancialActionState> {
  const parsed = alertRulesSchema.safeParse(input);
  if (!parsed.success || new Set(parsed.data.rules.map((rule) => rule.ruleKey)).size !== alertRuleKeys.length) {
    return { ok: false, message: "Check every alert threshold and add a reason." };
  }
  const auth = await requireFinancialOwner();
  if (!auth.ok) return auth.result;
  const limit = await consumeRateLimit({ action: "admin.mutate", userId: auth.context.userId });
  if (!limit.allowed) return { ok: false, message: rateLimitMessage(limit.resetAt) };

  const { data: previous, error: previousError } = await auth.admin.from("business_alert_rules").select("rule_key, enabled, threshold_percent");
  if (previousError) return { ok: false, message: "The current alert controls could not be loaded." };
  const logged = await recordAdminAuditEvent(auth.admin, {
    actorId: auth.context.userId,
    actorRole: auth.context.email,
    action: "business_alert_rules_updated",
    targetType: "business_alert_rules",
    previousState: { rules: previous ?? [] },
    newState: { rules: parsed.data.rules },
    reason: parsed.data.reason
  });
  if (!logged) return { ok: false, message: "The audit entry could not be recorded, so no controls were changed." };

  const now = new Date().toISOString();
  const { error } = await auth.admin.from("business_alert_rules").upsert(parsed.data.rules.map((rule) => ({
    rule_key: rule.ruleKey,
    enabled: rule.enabled,
    threshold_percent: rule.thresholdPercent,
    updated_by: auth.context.userId,
    updated_at: now
  })), { onConflict: "rule_key" });
  if (error) return { ok: false, message: "The business alert controls could not be updated." };
  revalidatePath("/admin/revenue");
  return { ok: true, message: "Business alert controls updated." };
}

export async function runFinancialMaintenanceAction(input: unknown): Promise<FinancialActionState> {
  const parsed = z.object({ action: z.enum(["snapshot", "fees"]), reason: z.string().trim().min(3).max(500) }).safeParse(input);
  if (!parsed.success) return { ok: false, message: "Choose an action and add a short reason." };
  const auth = await requireFinancialOwner();
  if (!auth.ok) return auth.result;
  const limit = await consumeRateLimit({ action: "admin.mutate", userId: auth.context.userId });
  if (!limit.allowed) return { ok: false, message: rateLimitMessage(limit.resetAt) };
  const logged = await recordAdminAuditEvent(auth.admin, {
    actorId: auth.context.userId,
    actorRole: auth.context.email,
    action: parsed.data.action === "snapshot" ? "financial_snapshot_requested" : "paystack_fee_reconciliation_requested",
    targetType: "financial_intelligence",
    newState: { action: parsed.data.action },
    reason: parsed.data.reason
  });
  if (!logged) return { ok: false, message: "The audit entry could not be recorded, so the action was not run." };

  try {
    const count = parsed.data.action === "snapshot"
      ? (await captureDailyFinancialSnapshots(auth.admin)).length
      : await reconcileMissingPaystackFees(auth.admin, 50);
    revalidatePath("/admin/revenue");
    return { ok: true, message: parsed.data.action === "snapshot" ? `${count} currency snapshot${count === 1 ? "" : "s"} captured.` : `${count} Paystack fee${count === 1 ? "" : "s"} reconciled.` };
  } catch {
    return { ok: false, message: "The financial maintenance action could not be completed." };
  }
}

async function requireFinancialOwner() {
  try {
    const auth = await requireSafetyAdmin();
    const access = await requireAdminPermission(auth.admin, auth.context, "admin.revenue.manage");
    if (access.role !== "owner") throw new Error("Owner access required.");
    return { ok: true as const, ...auth };
  } catch {
    return { ok: false as const, result: { ok: false, message: "Only the Owner can change financial controls." } };
  }
}

function decimalToMinor(value: string) {
  const [whole, decimal = ""] = value.split(".");
  return Number(whole) * 100 + Number(decimal.padEnd(2, "0"));
}
