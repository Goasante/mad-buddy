import { describe, expect, it } from "vitest";
import {
  PLAN_ENTITLEMENTS,
  UNLIMITED,
  checkFeature,
  checkUsageLimit,
  effectivePlan,
  entitlementsFor,
  isUnlimited,
  resolveEntitlements,
  resolveOverLimits,
  safePrivacyFallback,
  serializeLimit,
  upgradePromptFor,
  type BillingState
} from "@/lib/billing/entitlements";

const NOW = Date.parse("2026-07-17T12:00:00.000Z");
const DAY = 24 * 60 * 60 * 1000;

function state(overrides: Partial<BillingState> = {}): BillingState {
  return {
    plan: "buddy_plus",
    status: "active",
    periodEndMs: NOW + 10 * DAY,
    graceEndsMs: null,
    ...overrides
  };
}

describe("basic safety is never an entitlement (spec §1)", () => {
  it("has no key that could gate safety or privacy basics", () => {
    const keys = Object.keys(PLAN_ENTITLEMENTS.free);
    for (const forbidden of [
      "ghost_mode",
      "blocking",
      "block",
      "reporting",
      "report",
      "remove_muddy",
      "account_deletion",
      "delete_account",
      "visibility_control",
      "location_permission",
      "data_export"
    ]) {
      expect(keys, `"${forbidden}" must not be gateable`).not.toContain(forbidden);
    }
  });

  it("never paywalls voice notes entirely — accessibility stays free", () => {
    expect(PLAN_ENTITLEMENTS.free.voice_notes).toBe(true);
  });

  it("keeps Free genuinely usable, not a demo account (spec §3)", () => {
    const free = PLAN_ENTITLEMENTS.free;
    expect(free.max_muddies).toBe(30);
    expect(free.max_personal_circles).toBe(3);
    expect(free.max_close_friends).toBe(8);
    expect(free.max_active_plans).toBe(5);
    expect(free.photo_moments).toBe(true);
  });
});

describe("plan registry (spec §3, §4, §5)", () => {
  it("increases capability upward without ever reducing it", () => {
    const free = PLAN_ENTITLEMENTS.free;
    const plus = PLAN_ENTITLEMENTS.buddy_plus;
    const pro = PLAN_ENTITLEMENTS.buddy_pro;

    for (const key of ["max_muddies", "max_close_friends", "max_plan_participants", "max_group_members"] as const) {
      expect(plus[key], key).toBeGreaterThanOrEqual(free[key]);
      expect(pro[key], key).toBeGreaterThanOrEqual(plus[key]);
    }
    // A boolean feature is never taken away on a higher tier.
    for (const key of ["voice_notes", "photo_moments", "event_circle_creation"] as const) {
      if (free[key]) expect(plus[key], key).toBe(true);
      if (plus[key]) expect(pro[key], key).toBe(true);
    }
  });

  it("gives community tools to Pro only", () => {
    expect(PLAN_ENTITLEMENTS.buddy_plus.moderation_dashboard).toBe(false);
    expect(PLAN_ENTITLEMENTS.buddy_pro.moderation_dashboard).toBe(true);
    expect(PLAN_ENTITLEMENTS.buddy_pro.qr_check_in).toBe(true);
  });
});

describe("effectivePlan / grace period (spec §59, §61, §62)", () => {
  it("keeps paid access during a grace period after a failed renewal", () => {
    const grace = state({ status: "past_due", graceEndsMs: NOW + 3 * DAY });
    expect(effectivePlan(grace, NOW)).toBe("buddy_plus");
    // Features must survive the grace window (spec §61).
    expect(resolveEntitlements({ state: grace, nowMs: NOW }).voice_notes).toBe(true);
  });

  it("falls back to free once the grace window expires", () => {
    const grace = state({ status: "past_due", graceEndsMs: NOW - 1 });
    expect(effectivePlan(grace, NOW)).toBe("free");
  });

  it("honours a cancelled-but-paid-through subscription until period end", () => {
    expect(effectivePlan(state({ status: "non_renewing" }), NOW)).toBe("buddy_plus");
    expect(effectivePlan(state({ status: "non_renewing", periodEndMs: NOW - 1 }), NOW)).toBe("free");
  });

  it("treats cancelled/expired as free immediately", () => {
    expect(effectivePlan(state({ status: "cancelled" }), NOW)).toBe("free");
    expect(effectivePlan(state({ status: "expired" }), NOW)).toBe("free");
  });

  it("grants trial access", () => {
    expect(effectivePlan(state({ status: "trialing" }), NOW)).toBe("buddy_plus");
  });
});

describe("overrides (spec §10, §11)", () => {
  it("applies an in-window override", () => {
    const resolved = resolveEntitlements({
      state: state({ plan: "free", status: "free" }),
      overrides: [{ key: "max_personal_circles", value: 25, startsAtMs: null, endsAtMs: NOW + DAY }],
      nowMs: NOW
    });
    expect(resolved.max_personal_circles).toBe(25);
  });

  it("ignores an expired or not-yet-started override", () => {
    const expired = resolveEntitlements({
      state: state({ plan: "free", status: "free" }),
      overrides: [{ key: "max_personal_circles", value: 25, startsAtMs: null, endsAtMs: NOW - 1 }],
      nowMs: NOW
    });
    expect(expired.max_personal_circles).toBe(3);

    const future = resolveEntitlements({
      state: state({ plan: "free", status: "free" }),
      overrides: [{ key: "max_personal_circles", value: 25, startsAtMs: NOW + DAY, endsAtMs: null }],
      nowMs: NOW
    });
    expect(future.max_personal_circles).toBe(3);
  });
});

describe("checks (spec §12, §14)", () => {
  it("allows within limit and rejects beyond it", () => {
    const entitlements = entitlementsFor("free");
    expect(checkUsageLimit({ entitlements, key: "max_personal_circles", current: 2 })).toMatchObject({
      allowed: true,
      remaining: 1
    });
    expect(checkUsageLimit({ entitlements, key: "max_personal_circles", current: 3 })).toMatchObject({
      allowed: false,
      remaining: 0
    });
  });

  it("validates a requested batch, not just one more", () => {
    const entitlements = entitlementsFor("free");
    expect(
      checkUsageLimit({ entitlements, key: "max_plan_participants", current: 8, requested: 5 }).allowed
    ).toBe(false);
    expect(
      checkUsageLimit({ entitlements, key: "max_plan_participants", current: 8, requested: 2 }).allowed
    ).toBe(true);
  });

  it("treats unlimited as always allowed", () => {
    const entitlements = entitlementsFor("buddy_plus");
    expect(isUnlimited(entitlements.max_personal_circles)).toBe(true);
    expect(checkUsageLimit({ entitlements, key: "max_personal_circles", current: 9_999 }).allowed).toBe(true);
  });

  it("serializes unlimited as null for JSON (spec §14)", () => {
    expect(serializeLimit(UNLIMITED)).toBeNull();
    expect(serializeLimit(30)).toBe(30);
  });

  it("resolves boolean features", () => {
    expect(checkFeature(entitlementsFor("free"), "recurring_plans")).toBe(false);
    expect(checkFeature(entitlementsFor("buddy_plus"), "recurring_plans")).toBe(true);
  });
});

describe("upgrade prompts (spec §37)", () => {
  it("is specific about the limit hit and what Plus gives", () => {
    expect(upgradePromptFor("max_personal_circles", "free")).toBe(
      "Free includes 3 circles. Buddy Plus includes unlimited personal circles."
    );
  });

  it("never uses the coercive 'upgrade to continue' framing", () => {
    for (const key of ["max_personal_circles", "max_close_friends", "max_active_plans"] as const) {
      const prompt = upgradePromptFor(key, "free");
      expect(prompt).not.toMatch(/upgrade now to continue|continue using mad buddy/i);
    }
  });

  it("doesn't nag people who already pay", () => {
    expect(upgradePromptFor("max_personal_circles", "buddy_plus")).toBeNull();
  });
});

describe("downgrade safety (spec §45, §48)", () => {
  it("reports what's over the target limit so the user can choose", () => {
    const items = resolveOverLimits({
      targetPlan: "free",
      usage: { personal_circles: 8, close_friends: 22, private_groups: 1 }
    });
    expect(items).toEqual([
      { resource: "personal_circles", current: 8, newLimit: 3, keepCount: 3, excess: 5 },
      { resource: "close_friends", current: 22, newLimit: 8, keepCount: 8, excess: 14 }
    ]);
  });

  it("reports nothing when usage already fits", () => {
    expect(resolveOverLimits({ targetPlan: "free", usage: { personal_circles: 2 } })).toEqual([]);
  });

  it("fails privacy CLOSED — losing paid scheduling never widens the audience", () => {
    const fallback = safePrivacyFallback();
    expect(fallback.glowAudience).toBe("hidden");
    expect(fallback.advancedSchedulesEnabled).toBe(false);
    // The one thing it must never be.
    expect(fallback.glowAudience).not.toBe("all_muddies");
  });
});
