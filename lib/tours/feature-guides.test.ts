import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { FEATURE_GUIDES, FEATURE_GUIDE_GROUPS, findTarget, isKnownRoute } from "@/lib/tours/registry";

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

describe("feature guide catalogue after monetization reset", () => {
  it("keeps current product guides but retires Plan and billing education", () => {
    expect(FEATURE_GUIDES).toHaveLength(18);
    expect(FEATURE_GUIDES.some((guide) => guide.slug === "subscription-guide")).toBe(false);
    expect(new Set(FEATURE_GUIDES.map((guide) => guide.slug)).size).toBe(FEATURE_GUIDES.length);
    for (const guide of FEATURE_GUIDES) {
      expect(FEATURE_GUIDE_GROUPS.some((group) => group.id === guide.group)).toBe(true);
      expect(isKnownRoute(guide.entryRoute)).toBe(true);
    }
  });

  it("keeps registered feature targets real", () => {
    const migration = read("supabase/migrations/20260801120000_feature_walkthroughs.sql");
    expect(migration).toContain("home-guide");
    expect(findTarget("moments-air-tab")).toBeDefined();
  });

  it("does not expose billing targets/routes for new authoring", () => {
    const registry = read("lib/tours/registry.ts");
    expect(registry).not.toContain('path: "/upgrade"');
    expect(registry).not.toContain('slug: "subscription-guide"');
    expect(registry).not.toContain("BILLING_PLANS");
  });
});
