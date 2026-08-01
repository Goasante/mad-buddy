import { effectivePlan, type BillingState } from "@/lib/billing/entitlements";
import type { SubscriptionPlan, SubscriptionStatus } from "@/lib/supabase/database.types";

export type EffectivePlanSubscriptionRow = {
  user_id: string;
  plan: SubscriptionPlan;
  status: SubscriptionStatus;
  current_period_end: string | null;
  grace_ends_at: string | null;
};

export type EffectivePlanTrialRow = {
  id: string;
  user_id: string;
  plan: Exclude<SubscriptionPlan, "free">;
  trial_started_at: string;
  trial_ends_at: string;
};
export type EffectivePlanRewardRow = { id: string; user_id: string; reward_plan: Exclude<SubscriptionPlan, "free">; granted_at: string; expires_at: string; grace_ends_at: string | null };

/**
 * Resolves identity tiers from the same server-authoritative billing state used
 * by entitlement checks. The result intentionally contains only a plan name,
 * never payment, trial-source, or provider identifiers.
 */
export function resolveEffectivePlanMap(
  userIds: readonly string[],
  subscriptionRows: readonly EffectivePlanSubscriptionRow[],
  trialRows: readonly EffectivePlanTrialRow[],
  nowMs: number,
  rewardRows: readonly EffectivePlanRewardRow[] = []
): Map<string, SubscriptionPlan> {
  const subscriptions = new Map(subscriptionRows.map((row) => [row.user_id, row]));
  const trials = new Map<string, EffectivePlanTrialRow>();
  const rewards = new Map<string, EffectivePlanRewardRow>();

  for (const row of trialRows) {
    const current = trials.get(row.user_id);
    if (!current || Date.parse(row.trial_started_at) > Date.parse(current.trial_started_at)) {
      trials.set(row.user_id, row);
    }
  }
  for (const row of rewardRows) {
    const current = rewards.get(row.user_id);
    if (!current || Date.parse(row.granted_at) > Date.parse(current.granted_at)) rewards.set(row.user_id, row);
  }

  return new Map(
    [...new Set(userIds)].map((userId) => {
      const subscription = subscriptions.get(userId);
      const trial = trials.get(userId);
      const reward = rewards.get(userId);
      const state: BillingState = {
        plan: subscription?.plan ?? "free",
        status: subscription?.status ?? "free",
        periodEndMs: subscription?.current_period_end ? Date.parse(subscription.current_period_end) : null,
        graceEndsMs: subscription?.grace_ends_at ? Date.parse(subscription.grace_ends_at) : null,
        trialId: trial?.id ?? null,
        trialPlan: trial?.plan ?? null,
        trialStartedAtMs: trial ? Date.parse(trial.trial_started_at) : null,
        trialEndsAtMs: trial ? Date.parse(trial.trial_ends_at) : null,
        earnedRewardId: reward?.id ?? null,
        earnedPlan: reward?.reward_plan ?? null,
        earnedStartsAtMs: reward ? Date.parse(reward.granted_at) : null,
        earnedEndsAtMs: reward ? Date.parse(reward.expires_at) : null,
        earnedGraceEndsAtMs: reward?.grace_ends_at ? Date.parse(reward.grace_ends_at) : null
      };
      return [userId, effectivePlan(state, nowMs)] as const;
    })
  );
}
