import { describe, expect, it } from "vitest";
import { resolveEffectivePlanMap } from "@/lib/billing/effective-plans";
import { premiumBadgeIdentity } from "@/lib/billing/premium-identity";
import { PremiumPlanBadge } from "@/components/premium/premium-plan-badge";

const NOW = Date.parse("2026-08-01T12:00:00.000Z");

describe("premium identity badges", () => {
  it("does not give Free a premium badge", () => {
    expect(premiumBadgeIdentity("free")).toBeNull();
    expect(PremiumPlanBadge({ plan: "free" })).toBeNull();
  });

  it("maps Plus and Pro to distinct identities", () => {
    expect(premiumBadgeIdentity("buddy_plus")?.tier).toBe("plus");
    expect(premiumBadgeIdentity("buddy_pro")?.tier).toBe("pro");
    expect(PremiumPlanBadge({ plan: "buddy_plus" })).not.toBeNull();
    expect(PremiumPlanBadge({ plan: "buddy_pro" })).not.toBeNull();
  });

  it("uses a paid plan ahead of a simultaneous trial", () => {
    const plans = resolveEffectivePlanMap(
      ["user-1"],
      [{ user_id: "user-1", plan: "buddy_plus", status: "active", current_period_end: null, grace_ends_at: null }],
      [{ id: "trial-1", user_id: "user-1", plan: "buddy_pro", trial_started_at: "2026-07-31T12:00:00.000Z", trial_ends_at: "2026-08-08T12:00:00.000Z" }],
      NOW
    );
    expect(plans.get("user-1")).toBe("buddy_plus");
  });

  it("removes the badge after paid access and grace expire", () => {
    const plans = resolveEffectivePlanMap(
      ["user-1"],
      [{ user_id: "user-1", plan: "buddy_pro", status: "past_due", current_period_end: "2026-07-20T00:00:00.000Z", grace_ends_at: "2026-07-31T00:00:00.000Z" }],
      [],
      NOW
    );
    expect(premiumBadgeIdentity(plans.get("user-1"))).toBeNull();
  });

  it("reflects an owner or admin plan adjustment stored in the canonical subscription", () => {
    const plans = resolveEffectivePlanMap(
      ["user-1"],
      [{ user_id: "user-1", plan: "buddy_pro", status: "active", current_period_end: null, grace_ends_at: null }],
      [],
      NOW
    );
    expect(premiumBadgeIdentity(plans.get("user-1"))?.label).toBe("Buddy Pro");
  });

  it("ignores expired trials", () => {
    const plans = resolveEffectivePlanMap(
      ["user-1"],
      [],
      [{ id: "trial-1", user_id: "user-1", plan: "buddy_plus", trial_started_at: "2026-07-01T00:00:00.000Z", trial_ends_at: "2026-07-31T00:00:00.000Z" }],
      NOW
    );
    expect(plans.get("user-1")).toBe("free");
  });

  it("cannot be upgraded by a client plan claim", () => {
    const untrustedClientPayload = { userId: "user-1", plan: "buddy_pro" };
    const plans = resolveEffectivePlanMap([untrustedClientPayload.userId], [], [], NOW);
    expect(plans.get("user-1")).toBe("free");
    expect(premiumBadgeIdentity(plans.get("user-1"))).toBeNull();
  });

  it("uses an earned reward for the badge while keeping paid access first", () => {
    const reward = [{ id: "reward-1", user_id: "user-1", reward_plan: "buddy_pro" as const, granted_at: "2026-07-31T12:00:00.000Z", expires_at: "2026-08-31T12:00:00.000Z", grace_ends_at: null }];
    const earnedPlans = resolveEffectivePlanMap(["user-1"], [], [], NOW, reward);
    expect(premiumBadgeIdentity(earnedPlans.get("user-1"))?.label).toBe("Buddy Pro");
    const paidPlans = resolveEffectivePlanMap(
      ["user-1"],
      [{ user_id: "user-1", plan: "buddy_plus", status: "active", current_period_end: null, grace_ends_at: null }],
      [],
      NOW,
      reward
    );
    expect(paidPlans.get("user-1")).toBe("buddy_plus");
  });
});
