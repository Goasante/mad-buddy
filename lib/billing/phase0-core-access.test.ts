import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { UNLIMITED, entitlementsFor } from "@/lib/billing/entitlements";
import type { SubscriptionPlan } from "@/lib/supabase/database.types";

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");
const ALL_LEGACY_PLANS: SubscriptionPlan[] = ["free", "buddy_plus", "buddy_pro"];

describe("Mad Buddy free-core convergence", () => {
  it("makes historical tier names non-authoritative for consumer capability", () => {
    const baseline = entitlementsFor("free");
    for (const plan of ALL_LEGACY_PLANS) expect(entitlementsFor(plan)).toEqual(baseline);
  });

  it("keeps existing-social-world capacity permissive", () => {
    const core = entitlementsFor("free");
    for (const key of [
      "max_muddies",
      "max_personal_circles",
      "max_close_friends",
      "max_active_plans",
      "max_plan_participants",
      "max_private_groups",
      "max_group_members",
      "max_daily_moments",
      "max_safe_arrival_contacts",
      "max_active_safe_arrivals"
    ] as const) expect(core[key], key).toBe(UNLIMITED);
  });

  it("keeps Air publishing in free core", () => {
    expect(entitlementsFor("free").public_moments).toBe(true);
    const actions = read("app/(app)/moments-actions.ts");
    expect(actions).not.toContain("getCurrentSubscriptionAccess");
    expect(actions).not.toContain('checkFeature(entitlements, "public_moments")');
  });

  it("keeps Safe Arrival independent of payment state", () => {
    for (const path of ["app/(app)/safe-arrival-actions.ts", "lib/safety/safe-arrival-mobile.ts"]) {
      expect(read(path), path).not.toContain("getCurrentSubscriptionAccess");
    }
  });

  it("does not grant billing-derived staff or moderation powers", () => {
    const core = entitlementsFor("free");
    expect(core.community_roles).toBe(false);
    expect(core.moderation_dashboard).toBe(false);
    expect(core.community_analytics).toBe(false);
    expect(core.priority_support).toBe(false);
  });
});
