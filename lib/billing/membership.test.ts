import { describe, expect, it } from "vitest";
import { PLAN_ENTITLEMENTS, type BillingState } from "@/lib/billing/entitlements";
import { membershipUsageItems, membershipUsagePercent, resolveMembershipIdentity } from "@/lib/billing/membership";

const NOW = Date.parse("2026-08-01T12:00:00.000Z");

function state(overrides: Partial<BillingState> = {}): BillingState {
  return {
    plan: "free",
    status: "free",
    periodEndMs: null,
    graceEndsMs: null,
    trialId: null,
    trialPlan: null,
    trialStartedAtMs: null,
    trialEndsAtMs: null,
    earnedRewardId: null,
    earnedPlan: null,
    earnedStartsAtMs: null,
    earnedEndsAtMs: null,
    earnedGraceEndsAtMs: null,
    ...overrides
  };
}

describe("membership identity", () => {
  it("uses paid membership ahead of trial and earned access", () => {
    const identity = resolveMembershipIdentity(
      state({
        plan: "buddy_plus",
        status: "active",
        periodEndMs: NOW + 86_400_000,
        trialId: "trial-1",
        trialPlan: "buddy_pro",
        trialStartedAtMs: NOW - 1,
        trialEndsAtMs: NOW + 86_400_000,
        earnedRewardId: "reward-1",
        earnedPlan: "buddy_pro",
        earnedStartsAtMs: NOW - 1,
        earnedEndsAtMs: NOW + 86_400_000
      }),
      NOW
    );

    expect(identity).toMatchObject({ plan: "buddy_plus", source: "subscription", statusLabel: "Active" });
  });

  it("describes active trial access without calling it paid", () => {
    const identity = resolveMembershipIdentity(
      state({
        trialId: "trial-1",
        trialPlan: "buddy_pro",
        trialStartedAtMs: NOW - 1,
        trialEndsAtMs: NOW + 86_400_000
      }),
      NOW
    );

    expect(identity).toMatchObject({
      plan: "buddy_pro",
      source: "trial",
      sourceLabel: "Premium trial",
      dateLabel: "Trial ends"
    });
  });

  it("describes earned access and its expiry", () => {
    const identity = resolveMembershipIdentity(
      state({
        earnedRewardId: "reward-1",
        earnedPlan: "buddy_plus",
        earnedStartsAtMs: NOW - 1,
        earnedEndsAtMs: NOW + 86_400_000
      }),
      NOW
    );

    expect(identity).toMatchObject({
      plan: "buddy_plus",
      source: "earned",
      statusLabel: "Earned access",
      dateLabel: "Earned access ends"
    });
  });

  it("falls back to Free after temporary access expires", () => {
    const identity = resolveMembershipIdentity(
      state({
        trialId: "trial-1",
        trialPlan: "buddy_pro",
        trialStartedAtMs: NOW - 10,
        trialEndsAtMs: NOW - 1
      }),
      NOW
    );

    expect(identity).toMatchObject({ plan: "free", source: "free", dateLabel: null });
  });
});

describe("membership usage", () => {
  it("maps real usage to canonical entitlement limits", () => {
    const items = membershipUsageItems(
      { muddies: 4, personalCircles: 2, closeFriends: 1, activePlans: 3, privateGroups: 1 },
      PLAN_ENTITLEMENTS.free
    );

    expect(items.map((item) => [item.label, item.current, item.limit])).toEqual([
      ["Muddies", 4, 30],
      ["Personal circles", 2, 3],
      ["Close Friends", 1, 8],
      ["Active plans", 3, 5],
      ["Private groups", 1, 3]
    ]);
  });

  it("does not invent a percentage for unlimited access", () => {
    expect(membershipUsagePercent(100, Number.POSITIVE_INFINITY)).toBe(0);
    expect(membershipUsagePercent(4, 5)).toBe(80);
  });
});
