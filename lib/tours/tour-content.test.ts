import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { FEATURE_GUIDES } from "@/lib/tours/registry";

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

describe("manual tour monetization convergence", () => {
  it("does not register the retired subscription guide", () => {
    expect(FEATURE_GUIDES.some((guide) => guide.slug === "subscription-guide")).toBe(false);
  });

  it("does not render a Free/Plus/Pro comparison in the consumer runner", () => {
    const runner = read("components/tours/tour-runner.tsx");
    expect(runner).not.toContain("planPrice(");
    expect(runner).not.toContain("cheapestPaidPrice(");
    expect(runner).not.toContain("Upgrade from as low as");
    expect(runner).not.toContain("Buddy Plus");
    expect(runner).not.toContain("Buddy Pro");
  });

  it("filters historical monetization-only steps instead of teaching them", () => {
    const model = read("lib/tours/model.ts");
    expect(model).toContain('"subscription-guide"');
    expect(model).toContain('"plans-and-pricing"');
    expect(model).toContain('"tiers"');
    expect(model).toContain("entitlementKeys: []");
  });

  it("keeps generic walkthrough infrastructure intact", () => {
    const service = read("lib/tours/service.ts");
    expect(service).toContain("recordTourProgress");
    expect(service).toContain("getReplayableTours");
    expect(service).toContain("getPublishedTourById");
  });
});
