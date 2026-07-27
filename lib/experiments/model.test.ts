import { describe, expect, it } from "vitest";
import {
  buildExperimentMetricResults,
  buildExperimentRevenueResults,
  decideExperimentAssignment,
  nextExperimentStatus,
  shouldRecordFirstExposure,
  validateExperimentDefinition,
  type ExperimentDefinitionInput,
  type ExperimentExposure,
  type ExperimentOutcome
} from "@/lib/experiments/model";

const definition: ExperimentDefinitionInput = {
  key: "premium_cta_copy",
  name: "Premium CTA copy",
  description: "Compare two premium upgrade messages.",
  hypothesis: "Clear value wording increases verified paid conversion.",
  allocationPercentage: 50,
  audience: "all_eligible",
  platforms: ["web", "android", "ios"],
  plans: ["free"],
  conflictGroup: "premium_cta",
  startsAt: "2026-07-01T00:00:00.000Z",
  endsAt: "2026-08-01T00:00:00.000Z",
  primaryMetric: "paid_conversion",
  secondaryMetrics: ["checkout_started"],
  guardrailMetrics: ["support_issue"],
  variants: [
    { key: "control", name: "Control", description: "Current wording", weightBasisPoints: 5000, isControl: true },
    { key: "variant_a", name: "Variant A", description: "Value wording", weightBasisPoints: 5000, isControl: false }
  ]
};

describe("experiment definition", () => {
  it("accepts a weighted experiment with one control", () => {
    expect(validateExperimentDefinition(definition)).toEqual([]);
  });

  it("rejects invalid weights, duplicate metrics, and a missing control", () => {
    expect(
      validateExperimentDefinition({
        ...definition,
        primaryMetric: "checkout_started",
        secondaryMetrics: ["checkout_started"],
        variants: definition.variants.map((variant) => ({ ...variant, isControl: false, weightBasisPoints: 4000 }))
      })
    ).toEqual(expect.arrayContaining(["invalid_weights", "missing_control", "duplicate_metric"]));
  });
});

describe("assignment policy", () => {
  const assignment = {
    status: "running" as const,
    parentEnabled: true,
    platform: "web" as const,
    targetPlatforms: ["web", "android", "ios"] as const,
    plan: "free" as const,
    targetPlans: ["free"] as const,
    audience: "all_eligible" as const,
    selectedTester: false,
    hasConflict: false,
    allocationPercentage: 100,
    allocationBucket: 9999,
    variantBucket: 7000,
    variants: [
      { key: "control", weightBasisPoints: 2000 },
      { key: "variant_a", weightBasisPoints: 8000 }
    ]
  };

  it("uses uneven configured allocation", () => {
    expect(decideExperimentAssignment({ ...assignment, targetPlatforms: [...assignment.targetPlatforms], targetPlans: [...assignment.targetPlans] })).toEqual({
      eligible: true,
      variantKey: "variant_a",
      reused: false
    });
  });

  it("reuses a persisted variant across platforms", () => {
    expect(decideExperimentAssignment({
      ...assignment,
      platform: "android",
      targetPlatforms: [...assignment.targetPlatforms],
      targetPlans: [...assignment.targetPlans],
      existingVariantKey: "control",
      variantBucket: 9000
    })).toEqual({ eligible: true, variantKey: "control", reused: true });
  });

  it("fails closed when the parent is disabled or the experiment is paused", () => {
    expect(decideExperimentAssignment({
      ...assignment,
      parentEnabled: false,
      targetPlatforms: [...assignment.targetPlatforms],
      targetPlans: [...assignment.targetPlans]
    })).toEqual({ eligible: false, reason: "parent_disabled" });
    expect(decideExperimentAssignment({
      ...assignment,
      status: "paused",
      targetPlatforms: [...assignment.targetPlatforms],
      targetPlans: [...assignment.targetPlans]
    })).toEqual({ eligible: false, reason: "not_running" });
  });

  it("blocks conflicting experiments, excluded allocation, and unselected testers", () => {
    expect(decideExperimentAssignment({
      ...assignment,
      hasConflict: true,
      targetPlatforms: [...assignment.targetPlatforms],
      targetPlans: [...assignment.targetPlans]
    })).toEqual({ eligible: false, reason: "conflict" });
    expect(decideExperimentAssignment({
      ...assignment,
      allocationPercentage: 10,
      allocationBucket: 1000,
      targetPlatforms: [...assignment.targetPlatforms],
      targetPlans: [...assignment.targetPlans]
    })).toEqual({ eligible: false, reason: "allocation" });
    expect(decideExperimentAssignment({
      ...assignment,
      audience: "selected_testers",
      targetPlatforms: [...assignment.targetPlatforms],
      targetPlans: [...assignment.targetPlans]
    })).toEqual({ eligible: false, reason: "selected_testers" });
  });

  it("deduplicates actual exposure evidence", () => {
    expect(shouldRecordFirstExposure(false)).toBe(true);
    expect(shouldRecordFirstExposure(true)).toBe(false);
  });
});

describe("experiment lifecycle", () => {
  it("supports deliberate scheduling, pause, resume, completion, and emergency stop", () => {
    expect(nextExperimentStatus("draft", "schedule")).toBe("scheduled");
    expect(nextExperimentStatus("scheduled", "start")).toBe("running");
    expect(nextExperimentStatus("running", "pause")).toBe("paused");
    expect(nextExperimentStatus("paused", "resume")).toBe("running");
    expect(nextExperimentStatus("running", "emergency_stop")).toBe("paused");
    expect(nextExperimentStatus("paused", "stop")).toBe("completed");
  });

  it("keeps terminal experiments terminal", () => {
    expect(nextExperimentStatus("completed", "resume")).toBeNull();
    expect(nextExperimentStatus("cancelled", "start")).toBeNull();
  });
});

function exposures(controlCount: number, variantCount: number): ExperimentExposure[] {
  return [
    ...Array.from({ length: controlCount }, (_, index) => ({
      userId: `control-${index}`,
      variantKey: "control",
      isControl: true,
      exposedAt: "2026-07-01T00:00:00.000Z"
    })),
    ...Array.from({ length: variantCount }, (_, index) => ({
      userId: `variant-${index}`,
      variantKey: "variant_a",
      isControl: false,
      exposedAt: "2026-07-01T00:00:00.000Z"
    }))
  ];
}

function outcomes(users: string[], metricKey: "paid_conversion" | "d7_retention" = "paid_conversion"): ExperimentOutcome[] {
  return users.map((userId) => ({ userId, metricKey, occurredAt: "2026-07-09T00:00:00.000Z" }));
}

describe("experiment results", () => {
  it("does not declare a winner for a small sample", () => {
    const results = buildExperimentMetricResults({
      metricKey: "paid_conversion",
      exposures: exposures(10, 10),
      outcomes: outcomes(["control-0", "variant-0", "variant-1"]),
      now: new Date("2026-07-10T00:00:00.000Z"),
      startedAt: "2026-07-01T00:00:00.000Z"
    });
    expect(results.find((result) => result.variantKey === "variant_a")?.interpretation).toBe("insufficient_data");
  });

  it("does not claim a result when both variants have zero events", () => {
    const results = buildExperimentMetricResults({
      metricKey: "paid_conversion",
      exposures: exposures(100, 75),
      outcomes: [],
      now: new Date("2026-07-20T00:00:00.000Z"),
      startedAt: "2026-07-01T00:00:00.000Z"
    });
    expect(results.find((result) => result.variantKey === "variant_a")?.interpretation).toBe("insufficient_data");
  });

  it("reports a statistically clear result only after maturity", () => {
    const results = buildExperimentMetricResults({
      metricKey: "paid_conversion",
      exposures: exposures(200, 200),
      outcomes: outcomes([
        ...Array.from({ length: 20 }, (_, index) => `control-${index}`),
        ...Array.from({ length: 60 }, (_, index) => `variant-${index}`)
      ]),
      now: new Date("2026-07-15T00:00:00.000Z"),
      startedAt: "2026-07-01T00:00:00.000Z"
    });
    const variant = results.find((result) => result.variantKey === "variant_a");
    expect(variant?.interpretation).toBe("higher");
    expect(variant?.confidencePercent).toBeGreaterThanOrEqual(95);
    expect(variant?.absoluteDifferencePoints).toBe(20);
  });

  it("excludes immature D30 cohorts instead of reporting false zero retention", () => {
    const results = buildExperimentMetricResults({
      metricKey: "d30_retention",
      exposures: [
        { userId: "old", variantKey: "control", isControl: true, exposedAt: "2026-06-01T00:00:00.000Z" },
        { userId: "new", variantKey: "variant_a", isControl: false, exposedAt: "2026-07-20T00:00:00.000Z" }
      ],
      outcomes: outcomes(["old"], "d7_retention"),
      now: new Date("2026-07-27T00:00:00.000Z"),
      startedAt: "2026-06-01T00:00:00.000Z",
      matureAfterDays: 30
    });
    expect(results).toHaveLength(1);
    expect(results[0]?.sampleSize).toBe(1);
  });

  it("keeps trusted revenue separated by currency and ignores pre-exposure payments", () => {
    const result = buildExperimentRevenueResults({
      exposures: exposures(1, 1),
      revenue: [
        { userId: "control-0", currency: "GHS", amountMinor: 5000, occurredAt: "2026-07-02T00:00:00.000Z" },
        { userId: "variant-0", currency: "USD", amountMinor: 1000, occurredAt: "2026-07-02T00:00:00.000Z" },
        { userId: "variant-0", currency: "USD", amountMinor: 9000, occurredAt: "2026-06-20T00:00:00.000Z" }
      ]
    });
    expect(result).toEqual([
      { currency: "GHS", variantKey: "control", exposedUsers: 1, payingUsers: 1, amountMinor: 5000, amountPerExposedUserMinor: 5000 },
      { currency: "USD", variantKey: "variant_a", exposedUsers: 1, payingUsers: 1, amountMinor: 1000, amountPerExposedUserMinor: 1000 }
    ]);
  });
});
