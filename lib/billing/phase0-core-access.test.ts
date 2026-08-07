import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { UNLIMITED, checkFeature, entitlementsFor } from "@/lib/billing/entitlements";
import { HEADLINE_LIMITS } from "@/lib/billing/upgrade-copy";
import { stripComments } from "@/lib/content/strip-comments";
import type { SubscriptionPlan } from "@/lib/supabase/database.types";

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");
const ALL_PLANS: SubscriptionPlan[] = ["free", "buddy_plus", "buddy_pro"];

// ---------------------------------------------------------------------------
// Safety is never monetized
// ---------------------------------------------------------------------------

describe("Safe Arrival is never a paid feature", () => {
  it("gives every tier the same unlimited emergency contacts", () => {
    // The person who needs more emergency contacts is the person in more
    // danger. Charging them is indefensible.
    for (const plan of ALL_PLANS) {
      expect(entitlementsFor(plan).max_safe_arrival_contacts, plan).toBe(UNLIMITED);
    }
  });

  it("gives every tier the same unlimited concurrent journeys", () => {
    for (const plan of ALL_PLANS) {
      expect(entitlementsFor(plan).max_active_safe_arrivals, plan).toBe(UNLIMITED);
    }
  });

  it("never shows an upgrade prompt when adding a contact", () => {
    const actions = read("app/(app)/safe-arrival-actions.ts");
    expect(stripComments(actions)).not.toContain('upgradePromptFor("max_safe_arrival_contacts"');
  });

  it("does not advertise Safe Arrival capacity as a plan difference", () => {
    expect(HEADLINE_LIMITS.map((limit) => limit.key)).not.toContain("max_safe_arrival_contacts");
  });

  it("keeps safety access independent of payment state", () => {
    // Identical on every tier means no billing status, trial or grace period
    // can change it.
    const values = ALL_PLANS.map((plan) => entitlementsFor(plan).max_safe_arrival_contacts);
    expect(new Set(values).size).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Core Air
// ---------------------------------------------------------------------------

describe("core Air is part of the free product", () => {
  it("lets a free user publish to Air", () => {
    expect(checkFeature(entitlementsFor("free"), "public_moments")).toBe(true);
  });

  it("keeps it available on every paid tier too", () => {
    for (const plan of ALL_PLANS) {
      expect(checkFeature(entitlementsFor(plan), "public_moments"), plan).toBe(true);
    }
  });

  it("leaves viewing and joining Air ungated, as they already were", () => {
    // buildSpotlightFeed has no entitlement check: public_moments only ever
    // gated PUBLISHING. This asserts nothing regressed into gating the feed.
    const page = read("app/(app)/moments/page.tsx");
    const feedCall = page.slice(page.indexOf("buildSpotlightFeed(admin"), page.indexOf("buildSpotlightFeed(admin") + 120);
    expect(feedCall).not.toContain("checkFeature");
  });

  it("does not move advanced Air features to free by accident", () => {
    // Scheduled Air, analytics, boost and creator tools stay future paid
    // opportunities behind their own keys — none exist yet.
    const catalog = read("lib/billing/entitlement-catalog.ts");
    for (const unshipped of ["air_boost", "scheduled_air", "air_analytics"]) {
      expect(catalog, `${unshipped} must not have appeared`).not.toContain(unshipped);
    }
  });
});

// ---------------------------------------------------------------------------
// Resentment caps
// ---------------------------------------------------------------------------

describe("caps that only existed to sell an upgrade", () => {
  it("no longer limits how many Muddies a person may have", () => {
    for (const plan of ALL_PLANS) {
      expect(entitlementsFor(plan).max_muddies, plan).toBe(UNLIMITED);
    }
  });

  it("no longer limits Moments per day", () => {
    for (const plan of ALL_PLANS) {
      expect(entitlementsFor(plan).max_daily_moments, plan).toBe(UNLIMITED);
    }
  });

  it("no longer limits Close Friends", () => {
    for (const plan of ALL_PLANS) {
      expect(entitlementsFor(plan).max_close_friends, plan).toBe(UNLIMITED);
    }
  });

  it("removes the upgrade prompts those caps produced", () => {
    for (const [path, key] of [
      ["lib/content/moment-mobile.ts", "max_daily_moments"],
      ["app/(app)/moments-actions.ts", "max_daily_moments"],
      ["app/(app)/circles-actions.ts", "max_close_friends"]
    ] as const) {
      expect(stripComments(read(path)), `${path} must not prompt on ${key}`).not.toContain(
        `upgradePromptFor("${key}"`
      );
    }
  });

  it("stops advertising them as plan differences", () => {
    const advertised = HEADLINE_LIMITS.map((limit) => limit.key);
    for (const key of ["max_muddies", "max_close_friends", "max_daily_moments"] as const) {
      expect(advertised, `${key} is no longer a difference`).not.toContain(key);
    }
  });

  it("only advertises limits that genuinely differ between tiers", () => {
    // Advertising an identical value as a plan benefit would be false.
    for (const { key } of HEADLINE_LIMITS) {
      const values = ALL_PLANS.map((plan) => entitlementsFor(plan)[key]);
      expect(new Set(values).size, `${key} is identical on every tier`).toBeGreaterThan(1);
    }
  });
});

// ---------------------------------------------------------------------------
// Anti-spam
// ---------------------------------------------------------------------------

describe("friend-request throttling is abuse protection, not a product tier", () => {
  it("applies the same entitlement value to every tier", () => {
    const values = ALL_PLANS.map((plan) => entitlementsFor(plan).max_friend_requests_per_day);
    expect(new Set(values).size).toBe(1);
  });

  it("is really enforced by the rate limiter, uniformly", () => {
    // The audit found max_friend_requests_per_day is read only by
    // REQUEST_LIMITS, which nothing enforces. The live control is this rule.
    const rateLimit = read("lib/security/rate-limit.ts");
    expect(rateLimit).toContain('"friends.request"');
    // One rule for everyone — no per-plan branch.
    const rule = rateLimit.slice(rateLimit.indexOf('"friends.request":'));
    expect(rule.slice(0, 120)).not.toContain("plan");
  });

  it("never offers a paid bypass", () => {
    const rateLimit = stripComments(read("lib/security/rate-limit.ts"));
    for (const banned of ["buddy_plus", "buddy_pro", "upgradePromptFor", "checkFeature"]) {
      expect(rateLimit, `abuse control must not consider ${banned}`).not.toContain(banned);
    }
  });

  it("uses neutral copy that never mentions a subscription", () => {
    const rateLimit = read("lib/security/rate-limit.ts");
    const message = rateLimit.slice(rateLimit.indexOf("rateLimitMessage"));
    for (const banned of ["upgrade", "Buddy Plus", "Buddy Pro", "subscription"]) {
      expect(message.slice(0, 600).toLowerCase(), `must not mention ${banned}`).not.toContain(
        banned.toLowerCase()
      );
    }
  });
});

// ---------------------------------------------------------------------------
// Phantom entitlements
// ---------------------------------------------------------------------------

describe("phantom entitlements", () => {
  it("stops advertising capabilities that gate nothing", () => {
    // The audit found community_analytics and moderation_dashboard enforce no
    // shipped functionality. Selling them would be selling nothing.
    const plans = stripComments(read("components/premium/plans.ts"));
    expect(plans).not.toContain('key: "community_analytics"');
    expect(plans).not.toContain('key: "moderation_dashboard"');
  });

  it("keeps the keys for compatibility rather than deleting them", () => {
    // Deleting a key would break admin overrides and stored configurations.
    const catalog = read("lib/billing/entitlement-catalog.ts");
    expect(catalog).toContain("community_analytics");
    expect(catalog).toContain("moderation_dashboard");
  });

  it("keeps friendship_recaps advertised, because it is real", () => {
    // Unlike the other two, this one has a job handler and a table.
    expect(read("lib/jobs/handlers.ts")).toContain("friendship_recaps");
  });
});

// ---------------------------------------------------------------------------
// Migration safety
// ---------------------------------------------------------------------------

describe("nobody loses access", () => {
  it("never gives a paid tier less than free", () => {
    // The core migration guarantee: existing subscribers can only gain.
    const free = entitlementsFor("free");
    for (const plan of ["buddy_plus", "buddy_pro"] as const) {
      const paid = entitlementsFor(plan);
      for (const key of Object.keys(free) as Array<keyof typeof free>) {
        const freeValue = free[key];
        const paidValue = paid[key];
        if (typeof freeValue === "number" && typeof paidValue === "number") {
          expect(paidValue, `${plan}.${String(key)} regressed below free`).toBeGreaterThanOrEqual(freeValue);
        }
        if (typeof freeValue === "boolean" && typeof paidValue === "boolean") {
          if (freeValue) expect(paidValue, `${plan}.${String(key)} lost a free feature`).toBe(true);
        }
      }
    }
  });

  it("keeps deprecated caps permissive so old checks fail open", () => {
    // Any surviving `usage < limit` check passes against UNLIMITED.
    for (const key of ["max_muddies", "max_daily_moments", "max_close_friends"] as const) {
      expect(entitlementsFor("free")[key]).toBe(UNLIMITED);
      expect(Number.isFinite(entitlementsFor("free")[key])).toBe(false);
    }
  });

  it("changes no subscription record or price", () => {
    const pricing = read("lib/billing/pricing.ts");
    expect(pricing).toContain('free: "GHS 0"');
    expect(pricing).toContain('plus: "GHS 4.99"');
    expect(pricing).toContain('pro: "GHS 9.99"');
  });

  it("adds no second entitlement system", () => {
    const entitlements = read("lib/billing/entitlements.ts");
    expect(entitlements).toContain("export function entitlementsFor");
    // Still one catalogue, one resolver.
    expect(read("lib/billing/entitlement-catalog.ts")).toContain("NUMERIC_ENTITLEMENTS");
  });
});
