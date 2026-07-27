import { describe, expect, it } from "vitest";
import { evaluateTrialEligibility, hasPaidAccess, type TrialEligibilityInput } from "@/lib/trials/rules";

const NOW = Date.parse("2026-07-27T12:00:00.000Z");
const DAY = 86_400_000;

function eligible(overrides: Partial<TrialEligibilityInput> = {}): TrialEligibilityInput {
  return {
    enabled: true,
    audience: "all_eligible",
    availableFromMs: null,
    availableUntilMs: null,
    minimumAccountAgeDays: 0,
    requiresCompletedOnboarding: true,
    profileCreatedAtMs: NOW - 30 * DAY,
    isOnboarded: true,
    paidPlan: "free",
    paidStatus: "free",
    paidPeriodEndMs: null,
    paidGraceEndsMs: null,
    hasActiveTrial: false,
    hasTrialHistory: false,
    nowMs: NOW,
    ...overrides
  };
}

describe("controlled trial eligibility", () => {
  it("allows a first eligible trial", () => {
    expect(evaluateTrialEligibility(eligible())).toBe("eligible");
  });

  it("rejects paid, previous, active, expired-history, and revoked-history accounts", () => {
    expect(evaluateTrialEligibility(eligible({ paidPlan: "buddy_plus", paidStatus: "active" }))).toBe("already_paid");
    expect(evaluateTrialEligibility(eligible({ hasActiveTrial: true, hasTrialHistory: true }))).toBe("trial_already_active");
    expect(evaluateTrialEligibility(eligible({ hasTrialHistory: true }))).toBe("trial_already_used");
  });

  it("rejects disabled, scheduled, Owner-only, and incomplete-account offers", () => {
    expect(evaluateTrialEligibility(eligible({ enabled: false }))).toBe("trials_disabled");
    expect(evaluateTrialEligibility(eligible({ availableFromMs: NOW + DAY }))).toBe("trial_not_available");
    expect(evaluateTrialEligibility(eligible({ availableUntilMs: NOW }))).toBe("trial_not_available");
    expect(evaluateTrialEligibility(eligible({ audience: "owner_grant_only" }))).toBe("owner_grant_required");
    expect(evaluateTrialEligibility(eligible({ profileCreatedAtMs: null }))).toBe("profile_required");
    expect(evaluateTrialEligibility(eligible({ isOnboarded: false }))).toBe("onboarding_required");
    expect(
      evaluateTrialEligibility(eligible({ minimumAccountAgeDays: 14, profileCreatedAtMs: NOW - 2 * DAY }))
    ).toBe("account_too_new");
  });

  it("uses server-time period and grace boundaries for paid access", () => {
    expect(
      hasPaidAccess(eligible({ paidPlan: "buddy_pro", paidStatus: "past_due", paidGraceEndsMs: NOW + DAY }))
    ).toBe(true);
    expect(
      hasPaidAccess(eligible({ paidPlan: "buddy_pro", paidStatus: "past_due", paidGraceEndsMs: NOW }))
    ).toBe(false);
    expect(
      hasPaidAccess(eligible({ paidPlan: "buddy_plus", paidStatus: "non_renewing", paidPeriodEndMs: NOW }))
    ).toBe(false);
  });
});
