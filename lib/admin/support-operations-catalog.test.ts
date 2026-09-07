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

  it("never labels the most sensitive areas as fully implemented while their repairs are still planned", () => {
    for (const id of ["dob-age", "safe-arrival", "privacy-account-ops"]) {
      const area = SUPPORT_OPERATIONS_AREAS.find((item) => item.id === id);
      expect(area).toBeDefined();
      expect(area?.repair).toBe("planned");
    }
  });

  it("derives coverage metrics from the catalog rather than hardcoded UI counts", () => {
    const counts = supportCoverageCounts();
    expect(counts.areas).toBe(SUPPORT_OPERATIONS_AREAS.length);
    expect(counts.diagnosticLive).toBeGreaterThan(0);
    expect(counts.repairLive).toBeGreaterThan(0);
    expect(counts.fullyLive).toBe(0);
  });
});
