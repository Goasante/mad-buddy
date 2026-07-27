import { describe, expect, it } from "vitest";
import { estimateR2Scenario, R2_STANDARD_PRICING } from "@/lib/revenue/r2-assessment";

describe("R2 cost scenarios", () => {
  it("applies the documented Standard free tier and operation rounding", () => {
    expect(R2_STANDARD_PRICING.internetEgressUsdPerGb).toBe(0);
    expect(estimateR2Scenario(10_000)).toMatchObject({ storageGb: 62, estimatedMonthlyUsd: 0.78 });
    expect(estimateR2Scenario(100_000)).toMatchObject({ storageGb: 620, estimatedMonthlyUsd: 12.75 });
    expect(estimateR2Scenario(1_000_000)).toMatchObject({ storageGb: 6200, estimatedMonthlyUsd: 179.25 });
  });
});

