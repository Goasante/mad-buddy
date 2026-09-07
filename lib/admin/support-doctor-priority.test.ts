import { describe, expect, it } from "vitest";
import { prioritizeDoctorAreas } from "@/lib/admin/support-doctor-priority";

describe("support ticket to Account Doctor priority routing", () => {
  it("puts messaging checks first when the affected feature names messages", () => {
    expect(prioritizeDoctorAreas({ category: "muddies", affectedFeature: "Messages / inbox" }).slice(0, 3)).toEqual([
      "direct-messaging",
      "blocks-refriend",
      "muddies-requests"
    ]);
  });

  it("puts UpFor, Plans and Plan Chat first for an UpFor report", () => {
    expect(prioritizeDoctorAreas({ category: "plans", affectedFeature: "UpFor" }).slice(0, 3)).toEqual([
      "upfor",
      "plans",
      "plan-chat"
    ]);
  });

  it("prioritizes Safe Arrival without pulling exact-location diagnostics into the route", () => {
    expect(prioritizeDoctorAreas({ category: "privacy", affectedFeature: "Safe Arrival" })[0]).toBe("safe-arrival");
  });

  it("routes unconfirmed and grace-period language to Safe Arrival first", () => {
    expect(prioritizeDoctorAreas({ category: "other", affectedFeature: "Unconfirmed after grace period" })[0]).toBe(
      "safe-arrival"
    );
  });

  it("falls back to category routing when no feature hint is present", () => {
    expect(prioritizeDoctorAreas({ category: "billing", affectedFeature: null })).toEqual(["access-billing"]);
  });

  it("routes renewal-off and entitlement language to Access/Billing", () => {
    expect(prioritizeDoctorAreas({ category: "other", affectedFeature: "Non-renewing entitlement" })[0]).toBe(
      "access-billing"
    );
  });

  it("routes export and deletion language to Privacy/Account Operations", () => {
    expect(prioritizeDoctorAreas({ category: "other", affectedFeature: "Data export stuck" })[0]).toBe(
      "privacy-account-ops"
    );
    expect(prioritizeDoctorAreas({ category: "other", affectedFeature: "Account deletion in progress" })[0]).toBe(
      "privacy-account-ops"
    );
  });

  it("deduplicates areas when feature and category point to the same checks", () => {
    const result = prioritizeDoctorAreas({ category: "plans", affectedFeature: "Plan Chat" });
    expect(result.filter((area) => area === "plans")).toHaveLength(1);
    expect(result.filter((area) => area === "plan-chat")).toHaveLength(1);
  });

  it("returns an empty ordering for unknown metadata instead of inventing a score", () => {
    expect(prioritizeDoctorAreas({ category: "other", affectedFeature: "something unusual" })).toEqual([]);
  });
});

describe("short needles do not match inside longer words", () => {
  it('"age" does not fire on "Messages"', () => {
    /* The real bug this guards: a plain substring match routed "Messages /
       inbox" to DOB/age, so a ticket about messages not sending put date-of-
       birth checks in front of the operator. */
    expect(prioritizeDoctorAreas({ category: null, affectedFeature: "Messages / inbox" })).not.toContain("dob-age");
  });

  it('but "age" still fires when the ticket really says age', () => {
    expect(prioritizeDoctorAreas({ category: null, affectedFeature: "Age verification" })[0]).toBe("dob-age");
  });

  it('"dm" does not fire on unrelated words containing it', () => {
    expect(prioritizeDoctorAreas({ category: null, affectedFeature: "Admin badge" })).not.toContain("direct-messaging");
  });

  it("multi-word needles still match", () => {
    expect(prioritizeDoctorAreas({ category: null, affectedFeature: "Date of birth is wrong" })[0]).toBe("dob-age");
  });

  it("a needle at the very start or end of the text still matches", () => {
    expect(prioritizeDoctorAreas({ category: null, affectedFeature: "age" })[0]).toBe("dob-age");
    expect(prioritizeDoctorAreas({ category: null, affectedFeature: "problem with age" })[0]).toBe("dob-age");
  });
});
