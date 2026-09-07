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

  it("falls back to category routing when no feature hint is present", () => {
    expect(prioritizeDoctorAreas({ category: "billing", affectedFeature: null })).toEqual(["access-billing"]);
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
