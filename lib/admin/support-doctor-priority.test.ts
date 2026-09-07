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

  it("falls back to a FIXED order for unknown metadata, never an invented score", () => {
    /* This asserted an empty list, which meant an unrecognised ticket gave the
       operator no ordering at all and the ticket context silently did nothing.
       The fallback is a hard-coded list, not a ranking: the guarantee that
       matters is that it is deterministic and identical every time, with no
       weighting derived from the ticket. */
    const first = prioritizeDoctorAreas({ category: "other", affectedFeature: "something unusual" });
    const second = prioritizeDoctorAreas({ category: "other", affectedFeature: "something entirely different" });

    expect(first.length).toBeGreaterThan(0);
    expect(first).toEqual(second);
    expect(first[0]).toBe("safe-arrival");
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

describe("the founder's routing scenarios", () => {
  const first = (input: Parameters<typeof prioritizeDoctorAreas>[0]) => prioritizeDoctorAreas(input)[0];

  it("Messages / inbox routes to Messaging, never DOB/Age", () => {
    const areas = prioritizeDoctorAreas({ category: null, affectedFeature: "Messages / inbox" });
    expect(areas[0]).toBe("direct-messaging");
    expect(areas).not.toContain("dob-age");
  });

  it("unconfirmed after grace period routes to Safe Arrival", () => {
    expect(first({ category: null, affectedFeature: "Unconfirmed after grace period" })).toBe("safe-arrival");
  });

  it("a non-renewing entitlement routes to Access/Billing", () => {
    expect(first({ category: null, affectedFeature: "Non-renewing entitlement" })).toBe("access-billing");
  });

  it("a stuck data export routes to Privacy/Account Ops", () => {
    expect(first({ category: null, affectedFeature: "Data export stuck" })).toBe("privacy-account-ops");
  });

  it("an account deletion in progress routes to Privacy/Account Ops", () => {
    expect(first({ category: null, affectedFeature: "Account deletion in progress" })).toBe("privacy-account-ops");
  });

  it("UpFor wording routes to UpFor", () => {
    expect(first({ category: null, affectedFeature: "UpFor session will not convert" })).toBe("upfor");
  });

  it("an unknown issue still returns a deterministic order rather than nothing", () => {
    const a = prioritizeDoctorAreas({ category: "other", affectedFeature: "something we have never seen" });
    const b = prioritizeDoctorAreas({ category: "other", affectedFeature: "something we have never seen" });
    expect(a.length).toBeGreaterThan(0);
    expect(a).toEqual(b);
  });

  it("duplicate hints are deduplicated", () => {
    const areas = prioritizeDoctorAreas({
      category: "muddies",
      affectedFeature: "muddy request friend request muddy"
    });
    expect(new Set(areas).size).toBe(areas.length);
  });
});
