"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAdminPermission } from "@/lib/admin/access";
import { recordAdminAuditEvent } from "@/lib/admin/service";
import { consumeRateLimit, rateLimitMessage } from "@/lib/security/rate-limit";
import { requireSafetyAdmin } from "@/lib/safety/admin";
import { grantOwnerTrial, revokeOwnerTrial } from "@/lib/trials/service";

export type TrialAdminActionState = { ok: boolean; message: string };

const configSchema = z.object({
  enabled: z.enum(["true", "false"]),
  plan: z.enum(["buddy_plus", "buddy_pro"]),
  durationDays: z.coerce.number().int().min(1).max(60),
  audience: z.enum(["all_eligible", "owner_grant_only"]),
  minimumAccountAgeDays: z.coerce.number().int().min(0).max(3650),
  requiresCompletedOnboarding: z.enum(["true", "false"]),
  campaignSource: z.string().trim().max(80),
  reason: z.string().trim().min(3).max(500)
});

export async function updateTrialConfigAction(
  _previous: TrialAdminActionState,
  formData: FormData
): Promise<TrialAdminActionState> {
  const parsed = configSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, message: "Check the plan, duration, eligibility rules, and reason." };
  const auth = await requireTrialOwner();
  if (!auth.ok) return auth.result;
  const limited = await consumeRateLimit({ action: "admin.mutate", userId: auth.context.userId });
  if (!limited.allowed) return { ok: false, message: rateLimitMessage(limited.resetAt) };

  const { data: previous, error: readError } = await auth.admin
    .from("premium_trial_config")
    .select("*")
    .eq("key", "default")
    .maybeSingle();
  if (readError) return { ok: false, message: "The current trial configuration could not be loaded." };
  const next = {
    enabled: parsed.data.enabled === "true",
    eligiblePlan: parsed.data.plan,
    durationDays: parsed.data.durationDays,
    eligibilityRules: {
      audience: parsed.data.audience,
      minimum_account_age_days: parsed.data.minimumAccountAgeDays,
      requires_completed_onboarding: parsed.data.requiresCompletedOnboarding === "true"
    },
    campaignSource: parsed.data.campaignSource || null
  };
  const logged = await recordAdminAuditEvent(auth.admin, {
    actorId: auth.context.userId,
    actorRole: auth.context.email,
    action: "premium_trial_config_updated",
    targetType: "premium_trial_config",
    targetId: "default",
    previousState: previous ?? undefined,
    newState: next,
    reason: parsed.data.reason
  });
  if (!logged) return { ok: false, message: "The audit entry failed, so no trial setting was changed." };

  const { error } = await auth.admin.from("premium_trial_config").upsert({
    key: "default",
    enabled: next.enabled,
    eligible_plan: next.eligiblePlan,
    duration_days: next.durationDays,
    eligibility_rules: next.eligibilityRules,
    campaign_source: next.campaignSource,
    updated_by: auth.context.userId,
    updated_at: new Date().toISOString()
  });
  if (error) return { ok: false, message: "The trial configuration could not be saved." };
  revalidatePath("/admin/revenue/trials");
  return { ok: true, message: "Trial controls updated." };
}

const grantSchema = z.object({
  account: z.string().trim().min(2).max(100),
  plan: z.enum(["buddy_plus", "buddy_pro"]),
  reason: z.string().trim().min(3).max(500)
});

export async function grantTrialAction(
  _previous: TrialAdminActionState,
  formData: FormData
): Promise<TrialAdminActionState> {
  const parsed = grantSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, message: "Enter a user ID or username, plan, and reason." };
  const auth = await requireTrialOwner();
  if (!auth.ok) return auth.result;
  const limited = await consumeRateLimit({ action: "admin.mutate", userId: auth.context.userId });
  if (!limited.allowed) return { ok: false, message: rateLimitMessage(limited.resetAt) };
  const userId = await resolveUserId(auth.admin, parsed.data.account);
  if (!userId) return { ok: false, message: "No account matches that user ID or username." };

  const logged = await recordAdminAuditEvent(auth.admin, {
    actorId: auth.context.userId,
    actorRole: auth.context.email,
    action: "premium_trial_manual_grant_requested",
    targetType: "user",
    targetId: userId,
    newState: { plan: parsed.data.plan, ownerOverride: true },
    reason: parsed.data.reason
  });
  if (!logged) return { ok: false, message: "The audit entry failed, so no trial was granted." };
  try {
    await grantOwnerTrial(auth.admin, {
      userId,
      ownerId: auth.context.userId,
      plan: parsed.data.plan,
      reason: parsed.data.reason
    });
    revalidatePath("/admin/revenue/trials");
    return { ok: true, message: "Premium trial granted." };
  } catch (error) {
    return { ok: false, message: safeOwnerError(error, "The premium trial could not be granted.") };
  }
}

const revokeSchema = z.object({
  trialId: z.string().uuid(),
  reason: z.string().trim().min(3).max(500)
});

export async function revokeTrialAction(
  _previous: TrialAdminActionState,
  formData: FormData
): Promise<TrialAdminActionState> {
  const parsed = revokeSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, message: "Choose an active trial and add a reason." };
  const auth = await requireTrialOwner();
  if (!auth.ok) return auth.result;
  const limited = await consumeRateLimit({ action: "admin.mutate", userId: auth.context.userId });
  if (!limited.allowed) return { ok: false, message: rateLimitMessage(limited.resetAt) };

  const { data: trial } = await auth.admin
    .from("premium_trials")
    .select("id, user_id, plan, status")
    .eq("id", parsed.data.trialId)
    .maybeSingle();
  if (!trial || trial.status !== "active") return { ok: false, message: "This trial is no longer active." };
  const logged = await recordAdminAuditEvent(auth.admin, {
    actorId: auth.context.userId,
    actorRole: auth.context.email,
    action: "premium_trial_revocation_requested",
    targetType: "premium_trial",
    targetId: trial.id,
    previousState: { userId: trial.user_id, plan: trial.plan, status: trial.status },
    newState: { status: "revoked" },
    reason: parsed.data.reason
  });
  if (!logged) return { ok: false, message: "The audit entry failed, so the trial was not revoked." };
  try {
    const changed = await revokeOwnerTrial(auth.admin, {
      trialId: trial.id,
      ownerId: auth.context.userId,
      reason: parsed.data.reason
    });
    revalidatePath("/admin/revenue/trials");
    return changed
      ? { ok: true, message: "Premium trial revoked." }
      : { ok: false, message: "This trial was already closed." };
  } catch (error) {
    return { ok: false, message: safeOwnerError(error, "The premium trial could not be revoked.") };
  }
}

async function resolveUserId(admin: Awaited<ReturnType<typeof requireSafetyAdmin>>["admin"], account: string) {
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(account)) {
    const { data } = await admin.from("profiles").select("user_id").eq("user_id", account).maybeSingle();
    return data?.user_id ?? null;
  }
  const normalized = account.replace(/^@/, "").toLowerCase();
  const { data } = await admin
    .from("profiles")
    .select("user_id")
    .eq("username_normalized", normalized)
    .is("deleted_at", null)
    .maybeSingle();
  return data?.user_id ?? null;
}

async function requireTrialOwner() {
  try {
    const auth = await requireSafetyAdmin();
    const access = await requireAdminPermission(auth.admin, auth.context, "admin.revenue.manage");
    if (access.role !== "owner") throw new Error("Owner access required.");
    return { ok: true as const, ...auth };
  } catch {
    return {
      ok: false as const,
      result: { ok: false, message: "Only the Owner can manage premium trials." }
    };
  }
}

function safeOwnerError(error: unknown, fallback: string) {
  const message = error instanceof Error ? error.message : "";
  if (message.includes("already_paid")) return "This account already has paid premium access.";
  if (message.includes("trial_already_active")) return "This account already has an active trial.";
  if (message.includes("profile_required")) return "This account does not have an active profile.";
  return fallback;
}
