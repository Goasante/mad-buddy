import "server-only";

import { deliverNotification } from "@/lib/notifications/server";
import type { createSupabaseAdminClient } from "@/lib/supabase/admin";
import type { SubscriptionPlan } from "@/lib/supabase/database.types";
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
    paidPlan: subscription?.plan ?? "free",
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

export async function startUserTrial(admin: Admin, userId: string) {
  const { data, error } = await admin.rpc("start_premium_trial", { p_user_id: userId });
  if (error || !data) throw new Error(error?.message ?? "trial_start_failed");
  await deliverPendingBestEffort(admin);
  return data;
}

export async function grantOwnerTrial(
  admin: Admin,
  input: { userId: string; ownerId: string; plan: PaidPlan; reason: string }
) {
  const { data, error } = await admin.rpc("start_premium_trial", {
    p_user_id: input.userId,
    p_owner_override: true,
    p_granted_by: input.ownerId,
    p_override_reason: input.reason,
    p_override_plan: input.plan,
    p_source: "owner_grant"
  });
  if (error || !data) throw new Error(error?.message ?? "trial_grant_failed");
  await deliverPendingBestEffort(admin);
  return data;
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

export async function processTrialLifecycle(admin: Admin) {
  const { data, error } = await admin.rpc("process_premium_trial_lifecycle", {});
  if (error) throw new Error(error.message);
  const delivered = await deliverPendingTrialNotifications(admin);
  return Number(data ?? 0) + delivered;
}

async function deliverPendingTrialNotifications(admin: Admin) {
  const { data, error } = await admin.rpc("claim_premium_trial_notifications", { p_limit: 100 });
  if (error) throw new Error(error.message);

  let delivered = 0;
  for (const row of data ?? []) {
    const copy = trialNotificationCopy(row.notification_type);
    const now = new Date().toISOString();
    try {
      await deliverNotification(admin, {
        userId: row.user_id,
        type: "subscription_update",
        title: copy.title,
        message: copy.message
      });
      await admin
        .from("premium_trial_notifications")
        .update({
          delivery_status: "delivered",
          delivered_at: now,
          updated_at: now
        })
        .eq("id", row.id)
        .eq("delivery_status", "processing");
      delivered += 1;
    } catch {
      await admin
        .from("premium_trial_notifications")
        .update({
          delivery_status: "failed",
          updated_at: now
        })
        .eq("id", row.id)
        .eq("delivery_status", "processing");
    }
  }
  return delivered;
}

async function deliverPendingBestEffort(admin: Admin) {
  try {
    await deliverPendingTrialNotifications(admin);
  } catch {
    // The durable notification row remains pending for the lifecycle job.
  }
}

function trialNotificationCopy(type: string) {
  switch (type) {
    case "started":
      return { title: "Premium trial started", message: "Your premium trial is active." };
    case "ending_soon":
      return { title: "Premium trial ending soon", message: "Your premium trial ends within 24 hours." };
    case "expired":
      return { title: "Premium trial ended", message: "Your account has returned to the Free plan." };
    case "converted":
      return { title: "Premium plan active", message: "Your paid premium plan is now active." };
    case "revoked":
      return { title: "Premium trial ended", message: "Your premium trial access has been revoked." };
    default:
      return { title: "Premium trial update", message: "Your premium trial status changed." };
  }
}
