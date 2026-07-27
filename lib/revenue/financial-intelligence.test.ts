import { describe, expect, it } from "vitest";
import {
  buildMonthlyRetention,
  buildUnitEconomics,
  calculateRetention,
  calculateSnapshotMovement,
  classifyR2Migration,
  evaluateBusinessAlerts,
  reconcileSnapshotMovement,
  verifiedPaymentAmounts
} from "@/lib/revenue/financial-intelligence";
import type { FinancialSnapshotRow, SnapshotMovement } from "@/lib/revenue/financial-intelligence";

const prices = [
  { plan: "buddy_plus" as const, amountMinor: 5000, currency: "GHS" },
  { plan: "buddy_pro" as const, amountMinor: 10000, currency: "GHS" },
  { plan: "buddy_plus" as const, amountMinor: 500, currency: "USD" }
];

describe("financial snapshots", () => {
  it("calculates new, expansion, contraction and churned MRR by currency", () => {
    const events = [
      { eventType: "subscription_activated", plan: "buddy_plus" as const, previousPlan: "free" as const },
      { eventType: "plan_upgraded", plan: "buddy_pro" as const, previousPlan: "buddy_plus" as const },
      { eventType: "plan_downgraded", plan: "buddy_plus" as const, previousPlan: "buddy_pro" as const },
      { eventType: "subscription_cancelled", plan: "buddy_pro" as const, previousPlan: "buddy_pro" as const }
    ];
    expect(calculateSnapshotMovement(events, prices, "GHS")).toEqual({
      newMrrMinor: 5000,
      expansionMrrMinor: 5000,
      reactivationMrrMinor: 0,
      contractionMrrMinor: 5000,
      churnedMrrMinor: 10000
    });
    expect(calculateSnapshotMovement(events, prices, "USD")).toEqual({
      newMrrMinor: 500,
      expansionMrrMinor: 0,
      reactivationMrrMinor: 0,
      contractionMrrMinor: 0,
      churnedMrrMinor: 0
    });
  });

  it("accepts perfectly reconciled movement, including reactivation", () => {
    const movement: SnapshotMovement = {
      newMrrMinor: 5000,
      expansionMrrMinor: 5000,
      reactivationMrrMinor: 10000,
      contractionMrrMinor: 0,
      churnedMrrMinor: 5000
    };
    expect(reconcileSnapshotMovement(10000, 25000, movement)).toEqual({
      status: "reconciled",
      reason: null,
      differenceMinor: 0,
      movement
    });
  });

  it("marks duplicate lifecycle events as reconciliation-required", () => {
    const movement = calculateSnapshotMovement(
      [
        { eventType: "subscription_activated", plan: "buddy_plus", previousPlan: "free" },
        { eventType: "subscription_activated", plan: "buddy_plus", previousPlan: "free" }
      ],
      prices,
      "GHS"
    );
    expect(reconcileSnapshotMovement(0, 5000, movement)).toEqual({
      status: "reconciliation_required",
      reason: "lifecycle_movements_do_not_match_trusted_mrr",
      differenceMinor: 5000,
      movement: null
    });
  });

  it("keeps trusted boundaries but withholds categories after failed reconciliation", () => {
    const movement: SnapshotMovement = {
      newMrrMinor: 0,
      expansionMrrMinor: 5000,
      reactivationMrrMinor: 0,
      contractionMrrMinor: 0,
      churnedMrrMinor: 0
    };
    const result = reconcileSnapshotMovement(10000, 10000, movement);
    expect(result.status).toBe("reconciliation_required");
    expect(result.movement).toBeNull();
    expect(result.differenceMinor).toBe(5000);
  });

  it("reconciles a zero-MRR period without inventing retention", () => {
    const movement = emptyMovement();
    expect(reconcileSnapshotMovement(0, 0, movement).status).toBe("reconciled");
    expect(
      calculateRetention({
        openingMrrMinor: 0,
        expansionMrrMinor: 0,
        reactivationMrrMinor: 0,
        contractionMrrMinor: 0,
        churnedMrrMinor: 0
      })
    ).toEqual({ grrPercent: null, nrrPercent: null });
  });

  it("reconciles each currency independently", () => {
    const movement = calculateSnapshotMovement(
      [{ eventType: "subscription_activated", plan: "buddy_plus", previousPlan: "free" }],
      prices,
      "GHS"
    );
    const usdMovement = calculateSnapshotMovement(
      [{ eventType: "subscription_activated", plan: "buddy_plus", previousPlan: "free" }],
      prices,
      "USD"
    );
    expect(reconcileSnapshotMovement(0, 5000, movement).status).toBe("reconciled");
    expect(reconcileSnapshotMovement(0, 500, usdMovement).status).toBe("reconciled");
    expect(reconcileSnapshotMovement(0, 5000, usdMovement).status).toBe("reconciliation_required");
  });

  it("returns Not enough data until an opening MRR exists", () => {
    expect(calculateRetention({ openingMrrMinor: null, expansionMrrMinor: 1, reactivationMrrMinor: 0, contractionMrrMinor: 1, churnedMrrMinor: 1 })).toEqual({ grrPercent: null, nrrPercent: null });
  });

  it("calculates GRR and NRR without counting new MRR", () => {
    expect(calculateRetention({ openingMrrMinor: 10000, expansionMrrMinor: 2000, reactivationMrrMinor: 500, contractionMrrMinor: 1000, churnedMrrMinor: 1500 })).toEqual({ grrPercent: 75, nrrPercent: 100 });
  });

  it("rolls daily movements into a monthly retention view", () => {
    const result = buildMonthlyRetention([
      snapshot({ snapshotDate: "2026-07-01", openingMrrMinor: 10000, newMrrMinor: 500, endingMrrMinor: 10500 }),
      snapshot({ snapshotDate: "2026-07-02", openingMrrMinor: 10500, expansionMrrMinor: 1000, contractionMrrMinor: 500, churnedMrrMinor: 1000, endingMrrMinor: 10000 })
    ]);
    expect(result[0]).toMatchObject({ newMrrMinor: 500, expansionMrrMinor: 1000, reactivationMrrMinor: 0, contractionMrrMinor: 500, churnedMrrMinor: 1000, grrPercent: 85, nrrPercent: 95, reconciliationStatus: "reconciled" });
  });

  it("withholds monthly movement and retention when any snapshot needs reconciliation", () => {
    const result = buildMonthlyRetention([
      snapshot({ snapshotDate: "2026-07-01", openingMrrMinor: 10000, endingMrrMinor: 10000 }),
      snapshot({
        snapshotDate: "2026-07-02",
        openingMrrMinor: 10000,
        endingMrrMinor: 15000,
        reconciliationStatus: "reconciliation_required",
        reconciliationReason: "lifecycle_movements_do_not_match_trusted_mrr",
        reconciliationDifferenceMinor: 5000,
        newMrrMinor: null,
        expansionMrrMinor: null,
        reactivationMrrMinor: null,
        contractionMrrMinor: null,
        churnedMrrMinor: null
      })
    ]);
    expect(result[0]).toMatchObject({
      reconciliationStatus: "reconciliation_required",
      newMrrMinor: null,
      grrPercent: null,
      nrrPercent: null
    });
  });
});

describe("unit economics", () => {
  it("accepts only internally consistent authoritative Paystack fees", () => {
    expect(verifiedPaymentAmounts(5000, 125)).toEqual({ providerFeeMinor: 125, netAmountMinor: 4875, feeStatus: "verified" });
    expect(verifiedPaymentAmounts(5000, null)).toEqual({ providerFeeMinor: null, netAmountMinor: null, feeStatus: "unavailable" });
    expect(verifiedPaymentAmounts(5000, 6000).feeStatus).toBe("unavailable");
  });

  it("uses authoritative fees and keeps currencies separate", () => {
    const result = buildUnitEconomics({
      payments: [
        { userId: "a", amountMinor: 5000, providerFeeMinor: 100, currency: "GHS" },
        { userId: "b", amountMinor: 10000, providerFeeMinor: 200, currency: "GHS" },
        { userId: "c", amountMinor: 1000, providerFeeMinor: 50, currency: "USD" }
      ],
      providerCosts: [{ amountMinor: 2000, currency: "GHS" }],
      activeUsers: 10
    });
    expect(result.find((row) => row.currency === "GHS")).toMatchObject({ grossCollectedMinor: 15000, paymentFeesMinor: 300, netCollectedMinor: 14700, infrastructureCostMinor: 2000, payingUsers: 2, recordedCostContributionMinor: 12700 });
    expect(result.find((row) => row.currency === "USD")).toMatchObject({ grossCollectedMinor: 1000, paymentFeesMinor: 50, infrastructureCostMinor: null, recordedCostContributionMinor: null });
  });

  it("does not pretend net revenue is known when one fee is unavailable", () => {
    const [result] = buildUnitEconomics({ payments: [{ userId: "a", amountMinor: 5000, providerFeeMinor: null, currency: "GHS" }], providerCosts: [], activeUsers: 1 });
    expect(result).toMatchObject({ feeUnavailableCount: 1, netCollectedMinor: null, recordedCostContributionMinor: null });
  });
});

describe("business monitoring", () => {
  it("raises only threshold-backed alerts", () => {
    const alerts = evaluateBusinessAlerts({
      rules: [
        { ruleKey: "mrr_drop", enabled: true, thresholdPercent: 10 },
        { ruleKey: "cancellation_spike", enabled: true, thresholdPercent: 50 },
        { ruleKey: "payment_failure_spike", enabled: false, thresholdPercent: 10 },
        { ruleKey: "recovery_rate_drop", enabled: true, thresholdPercent: 20 },
        { ruleKey: "infrastructure_cost_spike", enabled: true, thresholdPercent: 25 }
      ],
      snapshots: [
        snapshot({ snapshotDate: "2026-07-26", openingMrrMinor: 1000, churnedMrrMinor: 200, endingMrrMinor: 800 }),
        snapshot({ snapshotDate: "2026-07-25", openingMrrMinor: 1000, endingMrrMinor: 1000 })
      ],
      current: { cancellations: 3, failedPayments: 99, recoveryRatePercent: 40 },
      previous: { cancellations: 2, failedPayments: 1, recoveryRatePercent: 70 },
      lifecycleMovementsTrusted: true,
      currentCosts: [{ amountMinor: 150, currency: "GHS" }],
      previousCosts: [{ amountMinor: 100, currency: "GHS" }]
    });
    expect(alerts.map((alert) => alert.key)).toEqual(expect.arrayContaining(["mrr_drop:GHS", "cancellation_spike", "recovery_rate_drop", "infrastructure_cost_spike:GHS"]));
    expect(alerts.map((alert) => alert.key)).not.toContain("payment_failure_spike");
  });

  it("suppresses lifecycle-derived cancellation alerts when snapshots are unreconciled", () => {
    const alerts = evaluateBusinessAlerts({
      rules: [{ ruleKey: "cancellation_spike", enabled: true, thresholdPercent: 10 }],
      snapshots: [],
      current: { cancellations: 10, failedPayments: 0, recoveryRatePercent: null },
      previous: { cancellations: 1, failedPayments: 0, recoveryRatePercent: null },
      lifecycleMovementsTrusted: false,
      currentCosts: [],
      previousCosts: []
    });
    expect(alerts).toEqual([]);
  });

  it("classifies the R2 review threshold from measured bytes", () => {
    expect(classifyR2Migration({ storedBytes: 50, reviewAtBytes: 100, recommendAtBytes: 1000 })).toBe("NOT NEEDED");
    expect(classifyR2Migration({ storedBytes: 500, reviewAtBytes: 100, recommendAtBytes: 1000 })).toBe("REVIEW");
    expect(classifyR2Migration({ storedBytes: 1000, reviewAtBytes: 100, recommendAtBytes: 1000 })).toBe("RECOMMENDED");
  });
});

function emptyMovement(): SnapshotMovement {
  return {
    newMrrMinor: 0,
    expansionMrrMinor: 0,
    reactivationMrrMinor: 0,
    contractionMrrMinor: 0,
    churnedMrrMinor: 0
  };
}

function snapshot(overrides: Partial<FinancialSnapshotRow>): FinancialSnapshotRow {
  return {
    snapshotDate: "2026-07-01",
    currency: "GHS",
    openingMrrMinor: 0,
    ...emptyMovement(),
    endingMrrMinor: 0,
    reconciliationStatus: "reconciled",
    reconciliationReason: null,
    reconciliationDifferenceMinor: 0,
    ...overrides
  };
}
