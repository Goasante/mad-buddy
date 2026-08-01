import type { SubscriptionPlan } from "@/lib/supabase/database.types";

export const EARNED_REWARD_RULE_VERSION = 1;
export const EARNED_REWARD_GRACE_DAYS = 7;
export const EARNED_REWARD_ENDING_SOON_DAYS = 3;
export const EARNED_REWARD_RULES = {
  buddy_plus: { score: 650, minimumAccountDays: 180, durationDays: 60, minimumPlans: 3, minimumSafeArrivals: 1 },
  buddy_pro: { score: 1200, minimumAccountDays: 365, durationDays: 30, minimumPlans: 8, minimumSafeArrivals: 3 }
} as const;

export type EarnedRewardPlan = Exclude<SubscriptionPlan, "free">;
export type RewardEvidence = { score: number; accountAgeDays: number; emailVerified: boolean; plansCompleted: number; safeArrivalsCompleted: number; seriousRestriction: boolean };
export type EarnedRewardLifecycle = "active" | "grace" | "expired" | "revoked" | "ineligible" | "unlocked" | "renewed";

export function decideEarnedRewardLifecycle(input: {
  current: { status: "active" | "grace"; expiresAtMs: number; graceEndsAtMs: number | null } | null;
  eligiblePlan: EarnedRewardPlan | null;
  seriousRestriction: boolean;
  nowMs: number;
}): EarnedRewardLifecycle {
  if (input.current && input.seriousRestriction) return "revoked";
  if (input.current && input.current.expiresAtMs > input.nowMs) return "active";
  if (input.current && !input.eligiblePlan) {
    if (input.current.status !== "grace") return "grace";
    return input.current.graceEndsAtMs !== null && input.current.graceEndsAtMs > input.nowMs ? "grace" : "expired";
  }
  if (!input.eligiblePlan) return "ineligible";
  return input.current ? "renewed" : "unlocked";
}

export function rewardEndsSoon(expiresAtMs: number, endingNotifiedAt: string | null, nowMs: number) {
  const remaining = expiresAtMs - nowMs;
  return endingNotifiedAt === null && remaining > 0 && remaining <= EARNED_REWARD_ENDING_SOON_DAYS * 86_400_000;
}

export function eligibleEarnedReward(evidence: RewardEvidence): EarnedRewardPlan | null {
  if (!evidence.emailVerified || evidence.seriousRestriction) return null;
  for (const plan of ["buddy_pro", "buddy_plus"] as const) {
    const rule = EARNED_REWARD_RULES[plan];
    if (evidence.score >= rule.score && evidence.accountAgeDays >= rule.minimumAccountDays && evidence.plansCompleted >= rule.minimumPlans && evidence.safeArrivalsCompleted >= rule.minimumSafeArrivals) return plan;
  }
  return null;
}

export function simulateEarnedRewardPace() {
  return {
    buddyPlus: "Typically six months or more of verified, sustained participation",
    buddyPro: "Typically a year or more and intentionally rare",
    assumptions: { monthlyPlans: 2, quarterlySafeArrivals: 2, genuineConnections: 12 }
  } as const;
}

export function rewardGrantKey(userId: string, plan: EarnedRewardPlan, now: Date) {
  const month = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
  return `${userId}:${plan}:v${EARNED_REWARD_RULE_VERSION}:${month}`;
}
