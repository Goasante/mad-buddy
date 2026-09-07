import { describe, expect, it } from "vitest";
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
      expect(area?.repair).toBe("planned");
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
