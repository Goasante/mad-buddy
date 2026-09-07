import { describe, expect, it } from "vitest";
import { REPAIR_CATALOG } from "@/lib/admin/repairs";
import { SUPPORT_OPERATIONS_AREAS, supportCoverageCounts } from "@/lib/admin/support-operations-catalog";

describe("support operations coverage catalog", () => {
  it("has unique stable area ids", () => {
    const ids = SUPPORT_OPERATIONS_AREAS.map((area) => area.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("covers the full founder-approved product support surface", () => {
    const ids = new Set(SUPPORT_OPERATIONS_AREAS.map((area) => area.id));
    for (const required of [
      "account-auth",
      "onboarding-activation",
      "profile-media",
      "dob-age",
      "muddies-requests",
      "blocks-refriend",
      "direct-messaging",
      "plan-chat",
      "plans",
      "upfor",
      "linkr",
      "presence",
      "notifications",
      "push",
      "events",
      "safe-arrival",
      "access-billing",
      "features-tours",
      "journey",
      "privacy-account-ops"
    ]) {
      expect(ids.has(required), `missing ${required}`).toBe(true);
    }
  });

  it("gives every area concrete user reports and a safety boundary", () => {
    for (const area of SUPPORT_OPERATIONS_AREAS) {
      expect(area.issues.length).toBeGreaterThan(0);
      expect(area.boundary.length).toBeGreaterThan(10);
    }
  });

  it("keeps the areas where NO repair is ever safe free of one", () => {
    /* DOB/age and privacy operations have no safe automatic repair at all: age
       is a legal gate, a spent DOB correction is an intentional lock, and a
       deletion cannot be proven complete-or-undone from a support console.
       They stay diagnostic-and-escalation only. */
    for (const id of ["dob-age", "privacy-account-ops"]) {
      const area = SUPPORT_OPERATIONS_AREAS.find((item) => item.id === id);
      expect(area).toBeDefined();
      /* `by_design`, not `planned`: these are settled decisions, not a backlog.
         The stricter assertion lives in "repair-free-by-design areas are marked
         by_design, never planned" below. */
      expect(area?.repair).toBe("by_design");
    }
  });

  it("allows Safe Arrival exactly one repair, and only with verification behind it", () => {
    /* Safe Arrival was in the list above until a repair existed that could be
       shown safe: `close_stalled_safe_arrival` touches only active/grace/
       extended journeys past their grace period, and provably leaves an
       `unconfirmed` one alone (lib/admin/repair-recipes.local.test.ts). The
       guard therefore becomes "a repair here must never ship without a live
       verifier", which is the property that actually matters. */
    const area = SUPPORT_OPERATIONS_AREAS.find((item) => item.id === "safe-arrival");
    expect(area).toBeDefined();
    if (area?.repair === "live") {
      expect(area.verification).toBe("live");
    }
  });

  it("derives coverage metrics from the catalog rather than hardcoded UI counts", () => {
    const counts = supportCoverageCounts();
    expect(counts.areas).toBe(SUPPORT_OPERATIONS_AREAS.length);
    expect(counts.diagnosticLive).toBeGreaterThan(0);
    expect(counts.repairLive).toBeGreaterThan(0);
    /* Was 0 before the verification contract shipped. Direct messaging and
       Plan Chat are now diagnose + repair + VERIFY, so the honest assertion is
       that fully-live areas exist and never exceed the catalog -- not a frozen
       number that has to be edited every time an area is completed. */
    expect(counts.fullyLive).toBeGreaterThan(0);
    expect(counts.fullyLive).toBeLessThanOrEqual(counts.areas);
  });
});

describe("the coverage map cannot overclaim capability", () => {
  it("every area claiming a live repair maps to a real executable repair", () => {
    /* The map graded itself on whether a module had been WRITTEN, which made
       it advertise capability an operator could not reach. "Live" now has to
       mean there is a repair in the executable catalog behind it. */
    const AREA_TO_REPAIRS: Record<string, readonly string[]> = {
      "onboarding-activation": ["reset_onboarding"],
      "blocks-refriend": ["reconcile_direct_messaging"],
      "direct-messaging": ["reconcile_direct_messaging"],
      "plan-chat": ["reconcile_plan_chats"],
      upfor: ["settle_stranded_upfor_requests"],
      presence: ["pause_visibility", "reset_glow_signal", "clear_stuck_status"],
      notifications: ["clear_notification_badge"],
      push: ["clear_push_subscriptions"],
      "features-tours": ["clear_rate_limits"]
    };
    const catalogIds = new Set(REPAIR_CATALOG.map((repair) => repair.id));

    for (const area of SUPPORT_OPERATIONS_AREAS) {
      if (area.repair !== "live") continue;
      const backing = AREA_TO_REPAIRS[area.id];
      expect(backing, `${area.id} claims a live repair with nothing behind it`).toBeDefined();
      for (const repairId of backing ?? []) {
        expect(catalogIds.has(repairId), `${area.id} -> ${repairId} is not in the catalog`).toBe(true);
      }
    }
  });

  it("no area claims a live repair without at least a partial verification", () => {
    for (const area of SUPPORT_OPERATIONS_AREAS) {
      if (area.repair === "live") expect(area.verification).not.toBe("planned");
    }
  });

  it("repair-free-by-design areas are marked by_design, never planned", () => {
    /* `planned` implies work that is coming. For these three it never is: age
       is a legal gate, a deletion cannot be proven complete-or-undone from a
       console, and an overdue journey belongs to the canonical safety sweep. */
    for (const id of ["dob-age", "privacy-account-ops", "safe-arrival"]) {
      const area = SUPPORT_OPERATIONS_AREAS.find((item) => item.id === id);
      expect(area?.repair, `${id} must be by_design`).toBe("by_design");
    }
  });

  it("Safe Arrival has no executable repair at all", () => {
    expect(REPAIR_CATALOG.find((repair) => repair.id === "close_stalled_safe_arrival")).toBeUndefined();
    expect(REPAIR_CATALOG.some((repair) => /safe_arrival|journey/i.test(repair.id))).toBe(false);
  });
});
