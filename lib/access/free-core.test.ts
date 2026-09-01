import { describe, expect, it } from "vitest";
import { PLAN_ENTITLEMENTS, UNLIMITED, entitlementsFor } from "@/lib/billing/entitlements";

const PLANS = ["free", "buddy_plus", "buddy_pro"] as const;

describe("Mad Buddy free-core compatibility registry", () => {
  it("billing history cannot change any consumer entitlement", () => {
    const baseline = entitlementsFor("free");
    for (const plan of PLANS) expect(entitlementsFor(plan)).toEqual(baseline);
  });
  it("keeps the core continuity surfaces unmetered", () => {
    const e = entitlementsFor("free");
    for (const key of ["max_muddies","max_personal_circles","max_close_friends","max_active_plans","max_plan_participants","max_private_groups","max_group_members","max_daily_moments","max_safe_arrival_contacts","max_active_safe_arrivals","max_polls_per_plan","max_event_circle_members","event_circle_archive_days","plan_chat_archive_days"] as const) {
      expect(e[key], key).toBe(UNLIMITED);
    }
  });
  it("does not turn moderator/admin authority into a free consumer perk", () => {
    for (const plan of PLANS) {
      expect(PLAN_ENTITLEMENTS[plan].moderation_dashboard).toBe(false);
      expect(PLAN_ENTITLEMENTS[plan].community_analytics).toBe(false);
      expect(PLAN_ENTITLEMENTS[plan].community_roles).toBe(false);
    }
  });
});
