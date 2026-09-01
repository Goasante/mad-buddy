import "server-only";

import type { createSupabaseAdminClient } from "@/lib/supabase/admin";
import type { SubscriptionPlan } from "@/lib/supabase/database.types";
import { legacyTierOf } from "@/lib/supabase/database.types";
import {
  evaluateTrialEligibility,
  trialEligibilityMessage,
  type TrialEligibilityCode
} from "@/lib/trials/rules";

type Admin = ReturnType<typeof createSupabaseAdminClient>;
type PaidPlan = Exclude<SubscriptionPlan, "free">;

export type TrialAccess = {
  id: string;
  plan: PaidPlan;
  startedAtMs: number;
  endsAtMs: number;
};

export async function loadActiveTrialAccess(
  admin: Admin,
  userId: string,
  nowMs = Date.now()
): Promise<TrialAccess | null> {
  const nowIso = new Date(nowMs).toISOString();
  const { data, error } = await admin
    .from("premium_trials")
    .select("id, plan, trial_started_at, trial_ends_at")
    .eq("user_id", userId)
    .eq("status", "active")
    .lte("trial_started_at", nowIso)
    .gt("trial_ends_at", nowIso)
    .order("trial_started_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error || !data) return null;
  return {
    id: data.id,
    plan: data.plan,
    startedAtMs: Date.parse(data.trial_started_at),
    endsAtMs: Date.parse(data.trial_ends_at)
  };
}

export async function getTrialEligibility(
  admin: Admin,
  userId: string,
  nowMs = Date.now()
): Promise<{
  code: TrialEligibilityCode;
  eligible: boolean;
  plan: PaidPlan | null;
  durationDays: number | null;
  campaignSource: string | null;
  message: string;
  activeTrial: TrialAccess | null;
}> {
  const [configRes, subscriptionRes, profileRes, historyRes, activeTrial] = await Promise.all([
    admin.from("premium_trial_config").select("*").eq("key", "default").maybeSingle(),
    admin
      .from("subscriptions")
      .select("plan, status, current_period_end, grace_ends_at")
      .eq("user_id", userId)
      .maybeSingle(),
    admin.from("profiles").select("created_at, is_onboarded").eq("user_id", userId).is("deleted_at", null).maybeSingle(),
    admin.from("premium_trials").select("id", { count: "exact", head: true }).eq("user_id", userId),
    loadActiveTrialAccess(admin, userId, nowMs)
  ]);

  const config = configRes.data;
  if (!config) {
    return {
      code: "trials_disabled",
      eligible: false,
      plan: null,
      durationDays: null,
      campaignSource: null,
      message: trialEligibilityMessage("trials_disabled"),
      activeTrial
    };
  }
  const rules = config.eligibility_rules as {
    audience?: "all_eligible" | "owner_grant_only";
    minimum_account_age_days?: number;
    requires_completed_onboarding?: boolean;
  };
  const subscription = subscriptionRes.data;
  const code = evaluateTrialEligibility({
    enabled: config.enabled,
    audience: rules.audience ?? "all_eligible",
    availableFromMs: config.available_from ? Date.parse(config.available_from) : null,
    availableUntilMs: config.available_until ? Date.parse(config.available_until) : null,
    minimumAccountAgeDays: rules.minimum_account_age_days ?? 0,
    requiresCompletedOnboarding: rules.requires_completed_onboarding ?? true,
    profileCreatedAtMs: profileRes.data?.created_at ? Date.parse(profileRes.data.created_at) : null,
    isOnboarded: profileRes.data?.is_onboarded ?? false,
    // legacyTierOf: Access is not a rung on the tier ladder, so it reads as no tier here.
    paidPlan: subscription ? legacyTierOf(subscription.plan) : "free",
    paidStatus: subscription?.status ?? "free",
    paidPeriodEndMs: subscription?.current_period_end ? Date.parse(subscription.current_period_end) : null,
    paidGraceEndsMs: subscription?.grace_ends_at ? Date.parse(subscription.grace_ends_at) : null,
    hasActiveTrial: Boolean(activeTrial),
    hasTrialHistory: (historyRes.count ?? 0) > 0,
    nowMs
  });

  if (code === "eligible") {
    await admin.from("premium_trial_events").insert({
      trial_id: null,
      user_id: userId,
      event_type: "eligible",
      event_key: `trial:eligible:${userId}:${config.updated_at}`,
      metadata: { plan: config.eligible_plan, campaignSource: config.campaign_source } as never,
      occurred_at: new Date(nowMs).toISOString()
    });
  }
  return {
    code,
    eligible: code === "eligible",
    plan: config.eligible_plan,
    durationDays: config.duration_days,
    campaignSource: config.campaign_source,
    message: trialEligibilityMessage(code),
    activeTrial
  };
}

export async function startUserTrial(_admin: Admin, _userId: string) {
  throw new Error("premium_trial_retired");
}

export async function grantOwnerTrial(
  _admin: Admin,
  _input: { userId: string; ownerId: string; plan: PaidPlan; reason: string }
) {
  throw new Error("premium_trial_retired");
}

export async function revokeOwnerTrial(
  admin: Admin,
  input: { trialId: string; ownerId: string; reason: string }
) {
  const { data, error } = await admin.rpc("end_premium_trial", {
    p_trial_id: input.trialId,
    p_action: "revoked",
    p_actor_id: input.ownerId,
    p_reason: input.reason
  });
  if (error) throw new Error(error.message);
  if (data) await deliverPendingBestEffort(admin);
  return Boolean(data);
}

export async function cancelUserTrial(admin: Admin, userId: string) {
  const active = await loadActiveTrialAccess(admin, userId);
  if (!active) return false;
  const { data, error } = await admin.rpc("end_premium_trial", {
    p_trial_id: active.id,
    p_action: "cancelled"
  });
  if (error) throw new Error(error.message);
  return Boolean(data);
}

export async function markTrialConverted(admin: Admin, userId: string, paidPlan: PaidPlan) {
  const { data, error } = await admin.rpc("convert_premium_trial", {
    p_user_id: userId,
    p_paid_plan: paidPlan
  });
  if (error) throw new Error(error.message);
  if (data) await deliverPendingBestEffort(admin);
  return data;
}

export async function recordTrialFeatureUse(
  admin: Admin,
  input: { userId: string; featureKey: string; resourceId: string }
) {
  const trial = await loadActiveTrialAccess(admin, input.userId);
  if (!trial) return false;
  const { error } = await admin.from("premium_trial_events").insert({
    trial_id: trial.id,
    user_id: input.userId,
    event_type: "premium_feature_used",
    event_key: `trial:feature:${trial.id}:${input.featureKey}:${input.resourceId}`,
    feature_key: input.featureKey,
    metadata: {},
    occurred_at: new Date().toISOString()
  });
  return !error || error.code === "23505";
}

export async function processTrialLifecycle(_admin: Admin) {
  return 0;
}

async function deliverPendingTrialNotifications(_admin: Admin) {
  // Do not claim or deliver historical premium-trial notifications.
  return 0;
}

async function deliverPendingBestEffort(_admin: Admin) {
  return;
}
