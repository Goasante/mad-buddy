import { describe, expect, it } from "vitest";

import { UNLIMITED, entitlementsFor, isUnlimited } from "@/lib/billing/entitlements";
import type { SubscriptionPlan } from "@/lib/supabase/database.types";

/**
 * THE FREE CORE IS FREE, ON EVERY TIER.
 *
 * "Your existing social world is free. Expanding your social world is paid."
 * Exactly two surfaces are paid -- Linkr and UpFor -- and this file is the
 * standing guard that nothing else drifts behind a payment.
 *
 * WHY THIS IS ASSERTED AT THE ENTITLEMENT REGISTRY rather than at each call
 * site: the registry is upstream of every consumer. A cap reintroduced here
 * would silently re-gate Plans, Groups, Circles, Events and Plan chat all at
 * once, and a per-call-site test would not necessarily notice.
 *
 * The audit that produced this found the model INVERTED: Linkr had no billing
 * reference anywhere, UpFor's catalog limits were enforced nowhere, and the
 * free core carried real caps (5 active plans, 3 groups, 3 circles, tiered
 * archive windows). This test is what stops that coming back.
 */

const ALL_PLANS: SubscriptionPlan[] = ["free", "buddy_plus", "buddy_pro"];

/**
 * Numeric entitlements that belong to the free core.
 *
 * Each is a capability over people you ALREADY know, so metering it charges
 * for the existing social world.
 */
const FREE_CORE_NUMERIC = [
  ["max_muddies", "your Muddies"],
  ["max_close_friends", "Close Friends is an audience, not a capacity"],
  ["max_personal_circles", "organising your own Muddies"],
  ["max_active_plans", "Plans are free core"],
  ["max_plan_participants", "inviting people you already know"],
  ["max_private_groups", "group conversations are Messages"],
  ["max_group_members", "same reasoning as plan participants"],
  ["max_polls_per_plan", "a poll is how a Plan gets decided"],
  ["max_event_circle_members", "Events are free core"],
  ["event_circle_archive_days", "paying to keep your own history"],
  ["plan_chat_archive_days", "Plan chat is Messages"],
  ["max_safe_arrival_contacts", "SAFETY IS NEVER MONETIZED"],
  ["max_active_safe_arrivals", "SAFETY IS NEVER MONETIZED"],
  ["max_daily_moments", "deprecated as a paywall in Phase 0"]
] as const;

describe("free-core entitlements are unlimited on every tier", () => {
  for (const [key, why] of FREE_CORE_NUMERIC) {
    it(`${key} — ${why}`, () => {
      for (const plan of ALL_PLANS) {
        expect(isUnlimited(entitlementsFor(plan)[key]), `${key} is capped on ${plan}`).toBe(true);
      }
    });
  }
});

describe("no paid tier is ever worse than free", () => {
  it("every numeric entitlement is at least the free value", () => {
    /* THE MIGRATION GUARANTEE. When free-core keys became UNLIMITED, the paid
       tiers still carried lower finite overrides -- which would have meant a
       paying subscriber got FEWER plan participants than a free account. The
       overrides were removed rather than raised, so the tiers inherit
       UNLIMITED. This is the assertion that caught it. */
    const free = entitlementsFor("free");
    for (const plan of ["buddy_plus", "buddy_pro"] as const) {
      const paid = entitlementsFor(plan);
      for (const key of Object.keys(free) as Array<keyof typeof free>) {
        const f = free[key];
        const p = paid[key];
        if (typeof f === "number" && typeof p === "number") {
          expect(p, `${plan}.${String(key)} is below free`).toBeGreaterThanOrEqual(f);
        }
        if (typeof f === "boolean" && typeof p === "boolean" && f) {
          expect(p, `${plan}.${String(key)} lost a free capability`).toBe(true);
        }
      }
    }
  });
});

describe("safety is never monetized", () => {
  it("emergency contacts and journeys are identical everywhere", () => {
    /* The person who needs more emergency contacts is the person in more
       danger. Identical on every tier means no billing status, grace period or
       expiry can change it. */
    for (const key of ["max_safe_arrival_contacts", "max_active_safe_arrivals"] as const) {
      const values = ALL_PLANS.map((plan) => entitlementsFor(plan)[key]);
      expect(new Set(values).size, `${key} differs by tier`).toBe(1);
      expect(values[0]).toBe(UNLIMITED);
    }
  });
});

describe("anti-abuse limits are flat, not purchasable", () => {
  it("friend requests per day is the same on every tier", () => {
    /* A per-day cap on friend requests is spam control. Keeping it tiered
       would mean paying to send more friend requests -- both a monetization of
       the free core and an anti-abuse hole. */
    const values = ALL_PLANS.map((plan) => entitlementsFor(plan).max_friend_requests_per_day);
    expect(new Set(values).size, "friend-request throttling became purchasable").toBe(1);
  });
});
