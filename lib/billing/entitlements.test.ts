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

  it("never paywalls voice notes entirely, accessibility stays free", () => {
    expect(PLAN_ENTITLEMENTS.free.voice_notes).toBe(true);
  });

  it("keeps Free genuinely usable, not a demo account (spec §3)", () => {
    // Phase 0 went further than "usable": the caps that existed only to sell
    // an upgrade are gone. Free is the whole product now.
    const free = PLAN_ENTITLEMENTS.free;
    expect(free.max_muddies).toBe(UNLIMITED);
    expect(free.max_close_friends).toBe(UNLIMITED);
    expect(free.max_daily_moments).toBe(UNLIMITED);
    expect(free.photo_moments).toBe(true);
    expect(free.public_moments).toBe(true);
    // Genuine capacity differences remain.
    /* MONETIZATION RESET: these are UNLIMITED now, not 3 and 5.
       Circles and Plans are free-core surfaces -- organising people you already
       know -- so capping them was monetizing the existing social world. The
       spirit of this assertion ("Free is a real product, not a demo") is
       stronger than before, so it is kept and the expectations moved. */
    expect(isUnlimited(free.max_personal_circles)).toBe(true);
    expect(isUnlimited(free.max_active_plans)).toBe(true);
  });
});

describe("legacy plan registry is non-authoritative", () => {
  it("returns identical consumer capability on every historical plan name", () => {
    expect(PLAN_ENTITLEMENTS.buddy_plus).toEqual(PLAN_ENTITLEMENTS.free);
    expect(PLAN_ENTITLEMENTS.buddy_pro).toEqual(PLAN_ENTITLEMENTS.free);
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

  it("uses a separate active trial when no paid subscription grants access", () => {
    expect(
      effectivePlan(
        state({
          plan: "free",
          status: "free",
          trialId: "trial-1",
          trialPlan: "buddy_pro",
          trialStartedAtMs: NOW - DAY,
          trialEndsAtMs: NOW + DAY
        }),
        NOW
      )
    ).toBe("buddy_pro");
  });

  it("lets paid access override a trial and rejects ended trial windows", () => {
    const trial = {
      trialId: "trial-1",
      trialPlan: "buddy_pro" as const,
      trialStartedAtMs: NOW - DAY,
      trialEndsAtMs: NOW + DAY
    };
    expect(effectivePlan(state({ ...trial, plan: "buddy_plus", status: "active" }), NOW)).toBe("buddy_plus");
    expect(effectivePlan(state({ ...trial, plan: "buddy_plus", status: "expired" }), NOW)).toBe("buddy_pro");
    expect(effectivePlan(state({ ...trial, plan: "free", status: "free", trialEndsAtMs: NOW }), NOW)).toBe("free");
    expect(effectivePlan(state({ ...trial, plan: "free", status: "free", trialId: null }), NOW)).toBe("free");
  });
});

describe("overrides (spec §10, §11)", () => {
  it("applies an in-window override", () => {
    const resolved = resolveEntitlements({
      state: state({ plan: "free", status: "free" }),
      overrides: [{ key: "max_active_nearby_moments", value: 25, startsAtMs: null, endsAtMs: NOW + DAY }],
      nowMs: NOW
    });
    expect(resolved.max_active_nearby_moments).toBe(25);
  });

  it("ignores an expired or not-yet-started override", () => {
    const expired = resolveEntitlements({
      state: state({ plan: "free", status: "free" }),
      overrides: [{ key: "max_active_nearby_moments", value: 25, startsAtMs: null, endsAtMs: NOW - 1 }],
      nowMs: NOW
    });
    expect(expired.max_active_nearby_moments).toBe(50);

    const future = resolveEntitlements({
      state: state({ plan: "free", status: "free" }),
      overrides: [{ key: "max_active_nearby_moments", value: 25, startsAtMs: NOW + DAY, endsAtMs: null }],
      nowMs: NOW
    });
    expect(future.max_active_nearby_moments).toBe(50);
  });
});

describe("checks (spec §12, §14)", () => {
  it("allows within limit and rejects beyond it", () => {
    const entitlements = entitlementsFor("free");
    expect(checkUsageLimit({ entitlements, key: "max_active_nearby_moments", current: 49 })).toMatchObject({
      allowed: true,
      remaining: 1
    });
    expect(checkUsageLimit({ entitlements, key: "max_active_nearby_moments", current: 50 })).toMatchObject({
      allowed: false,
      remaining: 0
    });
  });

  it("validates a requested batch, not just one more", () => {
    const entitlements = entitlementsFor("free");
    expect(
      checkUsageLimit({ entitlements, key: "max_active_nearby_moments", current: 48, requested: 5 }).allowed
    ).toBe(false);
    expect(
      checkUsageLimit({ entitlements, key: "max_active_nearby_moments", current: 48, requested: 2 }).allowed
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
    expect(checkFeature(entitlementsFor("free"), "recurring_plans")).toBe(true);
    expect(checkFeature(entitlementsFor("buddy_plus"), "recurring_plans")).toBe(true);
  });
});

describe("retired upgrade prompts", () => {
  it("never sells the retired tier ladder", () => {
    expect(upgradePromptFor("max_personal_circles", "free")).toBeNull();
    expect(upgradePromptFor("max_active_plans", "buddy_plus")).toBeNull();
  });
});

describe("downgrade safety (spec §45, §48)", () => {
  it("reports what's over the target limit so the user can choose", () => {
    const items = resolveOverLimits({
      targetPlan: "free",
      usage: { personal_circles: 8, close_friends: 22, private_groups: 1 }
    });
    /* Phase 0 made close_friends unlimited; the Monetization Reset did the same
       for personal_circles and private_groups, because organising people you
       already know is the free core.
       
       So downgrading now costs NOTHING among these resources -- which is the
       point, not a gap in coverage. The mechanism is still exercised by the
       assertion below, against a key that genuinely differs by tier. */
    expect(items).toEqual([]);

    /* `storage` is the only resource in OverLimitResource that still differs
       by tier, so it is what keeps this mechanism covered. */
    const free = entitlementsFor("free");
    const over = resolveOverLimits({
      targetPlan: "free",
      usage: { storage: (free.storage_limit_bytes as number) + 1024 }
    });
    expect(over).toEqual([
      {
        resource: "storage",
        current: (free.storage_limit_bytes as number) + 1024,
        newLimit: free.storage_limit_bytes,
        keepCount: free.storage_limit_bytes,
        excess: 1024
      }
    ]);
  });

  it("reports nothing when usage already fits", () => {
    expect(resolveOverLimits({ targetPlan: "free", usage: { personal_circles: 2 } })).toEqual([]);
  });

  it("fails privacy CLOSED, losing paid scheduling never widens the audience", () => {
    const fallback = safePrivacyFallback();
    expect(fallback.glowAudience).toBe("hidden");
    expect(fallback.advancedSchedulesEnabled).toBe(false);
    // The one thing it must never be.
    expect(fallback.glowAudience).not.toBe("all_muddies");
  });
});
