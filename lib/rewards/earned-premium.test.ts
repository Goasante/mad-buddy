import { describe, expect, it } from "vitest";
import { billingAccessSource, effectivePlan, type BillingState } from "@/lib/billing/entitlements";
import { EARNED_REWARD_RULES, decideEarnedRewardLifecycle, eligibleEarnedReward, rewardEndsSoon, rewardGrantKey, simulateEarnedRewardPace } from "@/lib/rewards/earned-premium";

const now = Date.UTC(2026, 7, 1);
const base: BillingState = { plan: "free", status: "free", periodEndMs: null, graceEndsMs: null, trialId: null, trialPlan: null, trialStartedAtMs: null, trialEndsAtMs: null, earnedRewardId: "r1", earnedPlan: "buddy_plus", earnedStartsAtMs: now - 1000, earnedEndsAtMs: now + 1000, earnedGraceEndsAtMs: null };

describe("earned premium rewards", () => {
  it("resolves paid then trial then earned then free", () => {
    expect(effectivePlan(base, now)).toBe("buddy_plus");
    expect(billingAccessSource(base, now)).toBe("earned");
    expect(effectivePlan({ ...base, trialId: "t", trialPlan: "buddy_pro", trialStartedAtMs: now - 1, trialEndsAtMs: now + 1 }, now)).toBe("buddy_pro");
    expect(effectivePlan({ ...base, plan: "buddy_plus", status: "active" }, now)).toBe("buddy_plus");
    expect(effectivePlan({ ...base, earnedEndsAtMs: now - 1 }, now)).toBe("free");
  });

  it("requires verified, sustained evidence", () => {
    const strong = { score: 1300, accountAgeDays: 400, emailVerified: true, plansCompleted: 10, safeArrivalsCompleted: 4, seriousRestriction: false };
    expect(eligibleEarnedReward(strong)).toBe("buddy_pro");
    expect(eligibleEarnedReward({ ...strong, score: 700, accountAgeDays: 200, plansCompleted: 4, safeArrivalsCompleted: 1 })).toBe("buddy_plus");
    expect(eligibleEarnedReward({ ...strong, seriousRestriction: true })).toBeNull();
    expect(eligibleEarnedReward({ ...strong, emailVerified: false })).toBeNull();
  });

  it("uses renewable, difficult thresholds", () => {
    expect(EARNED_REWARD_RULES.buddy_pro.score).toBeGreaterThan(EARNED_REWARD_RULES.buddy_plus.score);
    expect(EARNED_REWARD_RULES.buddy_plus.durationDays).toBeLessThanOrEqual(90);
    expect(simulateEarnedRewardPace().buddyPro).toContain("year");
  });

  it("creates deterministic monthly grant keys", () => {
    expect(rewardGrantKey("user", "buddy_plus", new Date(now))).toBe(rewardGrantKey("user", "buddy_plus", new Date(now)));
  });

  it("keeps a qualifying reward active and uses grace for a minor eligibility drop", () => {
    const current = { status: "active" as const, expiresAtMs: now + 1_000, graceEndsAtMs: null };
    expect(decideEarnedRewardLifecycle({ current, eligiblePlan: null, seriousRestriction: false, nowMs: now })).toBe("active");
    expect(decideEarnedRewardLifecycle({ current: { ...current, expiresAtMs: now - 1 }, eligiblePlan: null, seriousRestriction: false, nowMs: now })).toBe("grace");
    expect(decideEarnedRewardLifecycle({ current: { status: "grace", expiresAtMs: now - 2_000, graceEndsAtMs: now - 1 }, eligiblePlan: null, seriousRestriction: false, nowMs: now })).toBe("expired");
  });

  it("revokes immediately for a confirmed serious restriction", () => {
    expect(decideEarnedRewardLifecycle({ current: { status: "active", expiresAtMs: now + 1_000, graceEndsAtMs: null }, eligiblePlan: "buddy_plus", seriousRestriction: true, nowMs: now })).toBe("revoked");
  });

  it("renews expired eligible access and deduplicates ending-soon reminders", () => {
    expect(decideEarnedRewardLifecycle({ current: { status: "active", expiresAtMs: now - 1, graceEndsAtMs: null }, eligiblePlan: "buddy_plus", seriousRestriction: false, nowMs: now })).toBe("renewed");
    expect(rewardEndsSoon(now + 2 * 86_400_000, null, now)).toBe(true);
    expect(rewardEndsSoon(now + 2 * 86_400_000, new Date(now).toISOString(), now)).toBe(false);
  });
});
