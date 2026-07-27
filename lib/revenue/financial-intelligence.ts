import type { SubscriptionPlan } from "@/lib/supabase/database.types";

export type SnapshotMovementEvent = {
  eventType: string;
  plan: SubscriptionPlan;
  previousPlan: SubscriptionPlan | null;
};

export type SnapshotPrice = {
  plan: Exclude<SubscriptionPlan, "free">;
  amountMinor: number;
  currency: string;
};

export type SnapshotMovement = {
  newMrrMinor: number;
  expansionMrrMinor: number;
  reactivationMrrMinor: number;
  contractionMrrMinor: number;
  churnedMrrMinor: number;
};

export type SnapshotReconciliationStatus = "baseline" | "reconciled" | "reconciliation_required";

export type SnapshotReconciliation = {
  status: Exclude<SnapshotReconciliationStatus, "baseline">;
  reason: "lifecycle_movements_do_not_match_trusted_mrr" | null;
  differenceMinor: number;
  movement: SnapshotMovement | null;
};

export type RetentionResult = {
  grrPercent: number | null;
  nrrPercent: number | null;
};

export type FinancialPayment = {
  userId: string | null;
  amountMinor: number;
  providerFeeMinor: number | null;
  currency: string;
};

export type FinancialCost = {
  amountMinor: number;
  currency: string;
};

export type CurrencyUnitEconomics = {
  currency: string;
  grossCollectedMinor: number;
  paymentFeesMinor: number;
  feeTransactionCount: number;
  feeUnavailableCount: number;
  netCollectedMinor: number | null;
  infrastructureCostMinor: number | null;
  activeUsers: number;
  payingUsers: number;
  revenuePerActiveUserMinor: number | null;
  arppuMinor: number | null;
  infrastructureCostPerActiveUserMinor: number | null;
  infrastructureCostPerPayingUserMinor: number | null;
  recordedCostContributionMinor: number | null;
};

export type FinancialSnapshotRow = {
  snapshotDate: string;
  currency: string;
  openingMrrMinor: number | null;
  newMrrMinor: number | null;
  expansionMrrMinor: number | null;
  reactivationMrrMinor: number | null;
  contractionMrrMinor: number | null;
  churnedMrrMinor: number | null;
  endingMrrMinor: number;
  reconciliationStatus: SnapshotReconciliationStatus;
  reconciliationReason: "opening_snapshot_unavailable" | "lifecycle_movements_do_not_match_trusted_mrr" | null;
  reconciliationDifferenceMinor: number | null;
};

export type MonthlyRetention = RetentionResult & {
  month: string;
  currency: string;
  openingMrrMinor: number | null;
  endingMrrMinor: number;
  newMrrMinor: number | null;
  expansionMrrMinor: number | null;
  reactivationMrrMinor: number | null;
  contractionMrrMinor: number | null;
  churnedMrrMinor: number | null;
  reconciliationStatus: "reconciled" | "not_enough_data" | "reconciliation_required";
};

export type BusinessAlertRule = {
  ruleKey: "mrr_drop" | "cancellation_spike" | "payment_failure_spike" | "recovery_rate_drop" | "infrastructure_cost_spike";
  enabled: boolean;
  thresholdPercent: number;
};

export type BusinessAlert = {
  key: string;
  severity: "warning" | "critical";
  title: string;
  detail: string;
  currency: string | null;
};

export function verifiedPaymentAmounts(amountMinor: number, providerFeeMinor: number | null | undefined) {
  if (
    providerFeeMinor === null ||
    providerFeeMinor === undefined ||
    !Number.isInteger(providerFeeMinor) ||
    providerFeeMinor < 0 ||
    providerFeeMinor > amountMinor
  ) {
    return { providerFeeMinor: null, netAmountMinor: null, feeStatus: "unavailable" as const };
  }
  return {
    providerFeeMinor,
    netAmountMinor: amountMinor - providerFeeMinor,
    feeStatus: "verified" as const
  };
}

export function calculateSnapshotMovement(
  events: SnapshotMovementEvent[],
  prices: SnapshotPrice[],
  currency: string
): SnapshotMovement {
  const normalizedCurrency = currency.toUpperCase();
  const price = (plan: SubscriptionPlan | null) => {
    if (!plan || plan === "free") return 0;
    const configured = prices.find((item) => item.plan === plan && item.currency.toUpperCase() === normalizedCurrency);
    return configured?.amountMinor ?? 0;
  };

  let newMrrMinor = 0;
  let expansionMrrMinor = 0;
  let reactivationMrrMinor = 0;
  let contractionMrrMinor = 0;
  let churnedMrrMinor = 0;

  for (const event of events) {
    if (event.eventType === "subscription_activated") {
      if (event.previousPlan && event.previousPlan !== "free") {
        reactivationMrrMinor += price(event.plan);
      } else {
        newMrrMinor += price(event.plan);
      }
      continue;
    }
    if (event.eventType === "subscription_reactivated") {
      reactivationMrrMinor += price(event.plan);
      continue;
    }
    if (event.eventType === "plan_upgraded") {
      expansionMrrMinor += Math.max(0, price(event.plan) - price(event.previousPlan));
      continue;
    }
    if (event.eventType === "plan_downgraded") {
      contractionMrrMinor += Math.max(0, price(event.previousPlan) - price(event.plan));
      continue;
    }
    if (event.eventType === "subscription_cancelled" || event.eventType === "subscription_expired") {
      churnedMrrMinor += price(event.previousPlan && event.previousPlan !== "free" ? event.previousPlan : event.plan);
    }
  }

  return { newMrrMinor, expansionMrrMinor, reactivationMrrMinor, contractionMrrMinor, churnedMrrMinor };
}

/**
 * Provider webhooks and applied admin changes can describe the same lifecycle
 * transition. Only publish movement labels when they reconcile exactly to the
 * trusted opening and ending subscription snapshots.
 */
export function reconcileSnapshotMovement(
  openingMrrMinor: number,
  endingMrrMinor: number,
  movement: SnapshotMovement
): SnapshotReconciliation {
  const calculatedEnding =
    openingMrrMinor +
    movement.newMrrMinor +
    movement.expansionMrrMinor +
    movement.reactivationMrrMinor -
    movement.contractionMrrMinor -
    movement.churnedMrrMinor;
  const differenceMinor = calculatedEnding - endingMrrMinor;
  return differenceMinor === 0
    ? { status: "reconciled", reason: null, differenceMinor: 0, movement }
    : {
        status: "reconciliation_required",
        reason: "lifecycle_movements_do_not_match_trusted_mrr",
        differenceMinor,
        movement: null
      };
}

export function calculateRetention(input: {
  openingMrrMinor: number | null;
  expansionMrrMinor: number | null;
  reactivationMrrMinor: number | null;
  contractionMrrMinor: number | null;
  churnedMrrMinor: number | null;
}): RetentionResult {
  if (input.openingMrrMinor === null || input.openingMrrMinor <= 0) {
    return { grrPercent: null, nrrPercent: null };
  }
  if (
    input.expansionMrrMinor === null ||
    input.reactivationMrrMinor === null ||
    input.contractionMrrMinor === null ||
    input.churnedMrrMinor === null
  ) {
    return { grrPercent: null, nrrPercent: null };
  }

  const opening = input.openingMrrMinor;
  const retained = Math.max(0, opening - input.contractionMrrMinor - input.churnedMrrMinor);
  return {
    grrPercent: roundPercent(Math.min(opening, retained), opening),
    nrrPercent: roundPercent(retained + input.expansionMrrMinor + input.reactivationMrrMinor, opening)
  };
}

export function buildMonthlyRetention(rows: FinancialSnapshotRow[]): MonthlyRetention[] {
  const groups = new Map<string, FinancialSnapshotRow[]>();
  for (const row of rows) {
    const key = `${row.snapshotDate.slice(0, 7)}:${row.currency.toUpperCase()}`;
    const group = groups.get(key) ?? [];
    group.push({ ...row, currency: row.currency.toUpperCase() });
    groups.set(key, group);
  }

  return [...groups.values()].map((group) => {
    group.sort((a, b) => a.snapshotDate.localeCompare(b.snapshotDate));
    const first = group[0];
    const last = group[group.length - 1];
    const reconciliationStatus: MonthlyRetention["reconciliationStatus"] = group.some(
      (row) => row.reconciliationStatus === "reconciliation_required"
    )
      ? "reconciliation_required"
      : group.every((row) => row.reconciliationStatus === "reconciled")
        ? "reconciled"
        : "not_enough_data";
    const complete =
      reconciliationStatus === "reconciled" &&
      group.every(
        (row) =>
          row.newMrrMinor !== null &&
          row.expansionMrrMinor !== null &&
          row.reactivationMrrMinor !== null &&
          row.contractionMrrMinor !== null &&
          row.churnedMrrMinor !== null
      );
    const values = complete
      ? {
          newMrrMinor: sumNullable(group.map((row) => row.newMrrMinor)),
          expansionMrrMinor: sumNullable(group.map((row) => row.expansionMrrMinor)),
          reactivationMrrMinor: sumNullable(group.map((row) => row.reactivationMrrMinor)),
          contractionMrrMinor: sumNullable(group.map((row) => row.contractionMrrMinor)),
          churnedMrrMinor: sumNullable(group.map((row) => row.churnedMrrMinor))
        }
      : {
          newMrrMinor: null,
          expansionMrrMinor: null,
          reactivationMrrMinor: null,
          contractionMrrMinor: null,
          churnedMrrMinor: null
        };
    const retention = calculateRetention({
      openingMrrMinor: first.openingMrrMinor,
      expansionMrrMinor: values.expansionMrrMinor,
      reactivationMrrMinor: values.reactivationMrrMinor,
      contractionMrrMinor: values.contractionMrrMinor,
      churnedMrrMinor: values.churnedMrrMinor
    });
    return {
      month: first.snapshotDate.slice(0, 7),
      currency: first.currency,
      openingMrrMinor: first.openingMrrMinor,
      endingMrrMinor: last.endingMrrMinor,
      reconciliationStatus,
      ...values,
      ...retention
    };
  }).sort((a, b) => b.month.localeCompare(a.month) || a.currency.localeCompare(b.currency));
}

export function buildUnitEconomics(input: {
  payments: FinancialPayment[];
  providerCosts: FinancialCost[];
  activeUsers: number;
}): CurrencyUnitEconomics[] {
  const currencies = [...new Set([
    ...input.payments.map((item) => item.currency.toUpperCase()),
    ...input.providerCosts.map((item) => item.currency.toUpperCase())
  ])].sort();

  return currencies.map((currency) => {
    const payments = input.payments.filter((item) => item.currency.toUpperCase() === currency);
    const costs = input.providerCosts.filter((item) => item.currency.toUpperCase() === currency);
    const gross = payments.reduce((sum, item) => sum + item.amountMinor, 0);
    const knownFees = payments.filter((item) => item.providerFeeMinor !== null);
    const paymentFees = knownFees.reduce((sum, item) => sum + (item.providerFeeMinor ?? 0), 0);
    const feeUnavailableCount = payments.length - knownFees.length;
    const net = payments.length > 0 && feeUnavailableCount === 0 ? gross - paymentFees : null;
    const infrastructure = costs.length > 0 ? costs.reduce((sum, item) => sum + item.amountMinor, 0) : null;
    const payers = new Set(payments.flatMap((item) => item.userId ? [item.userId] : [])).size;

    return {
      currency,
      grossCollectedMinor: gross,
      paymentFeesMinor: paymentFees,
      feeTransactionCount: knownFees.length,
      feeUnavailableCount,
      netCollectedMinor: net,
      infrastructureCostMinor: infrastructure,
      activeUsers: input.activeUsers,
      payingUsers: payers,
      revenuePerActiveUserMinor: divideMoney(gross, input.activeUsers),
      arppuMinor: divideMoney(gross, payers),
      infrastructureCostPerActiveUserMinor: infrastructure === null ? null : divideMoney(infrastructure, input.activeUsers),
      infrastructureCostPerPayingUserMinor: infrastructure === null ? null : divideMoney(infrastructure, payers),
      recordedCostContributionMinor: net === null || infrastructure === null ? null : net - infrastructure
    };
  });
}

export function evaluateBusinessAlerts(input: {
  rules: BusinessAlertRule[];
  snapshots: FinancialSnapshotRow[];
  current: { cancellations: number; failedPayments: number; recoveryRatePercent: number | null };
  previous: { cancellations: number; failedPayments: number; recoveryRatePercent: number | null };
  lifecycleMovementsTrusted: boolean;
  currentCosts: FinancialCost[];
  previousCosts: FinancialCost[];
}): BusinessAlert[] {
  const rules = new Map(input.rules.filter((rule) => rule.enabled).map((rule) => [rule.ruleKey, rule.thresholdPercent]));
  const alerts: BusinessAlert[] = [];
  const latestByCurrency = new Map<string, FinancialSnapshotRow[]>();
  for (const row of input.snapshots) {
    const currency = row.currency.toUpperCase();
    const values = latestByCurrency.get(currency) ?? [];
    values.push(row);
    latestByCurrency.set(currency, values);
  }
  const mrrThreshold = rules.get("mrr_drop");
  if (mrrThreshold !== undefined) {
    for (const [currency, rows] of latestByCurrency) {
      rows.sort((a, b) => b.snapshotDate.localeCompare(a.snapshotDate));
      if (rows.length < 2 || rows[1].endingMrrMinor <= 0) continue;
      const drop = percentChange(rows[1].endingMrrMinor, rows[0].endingMrrMinor, "drop");
      if (drop >= mrrThreshold) alerts.push({ key: `mrr_drop:${currency}`, severity: drop >= mrrThreshold * 2 ? "critical" : "warning", title: `${currency} MRR decreased`, detail: `MRR is ${drop}% below the previous snapshot.`, currency });
    }
  }

  if (input.lifecycleMovementsTrusted) {
    addSpikeAlert(
      alerts,
      rules.get("cancellation_spike"),
      input.previous.cancellations,
      input.current.cancellations,
      "cancellation_spike",
      "Cancellations increased"
    );
  }
  addSpikeAlert(alerts, rules.get("payment_failure_spike"), input.previous.failedPayments, input.current.failedPayments, "payment_failure_spike", "Payment failures increased");

  const recoveryThreshold = rules.get("recovery_rate_drop");
  if (recoveryThreshold !== undefined && input.current.recoveryRatePercent !== null && input.previous.recoveryRatePercent !== null) {
    const drop = input.previous.recoveryRatePercent - input.current.recoveryRatePercent;
    if (drop >= recoveryThreshold) alerts.push({ key: "recovery_rate_drop", severity: drop >= recoveryThreshold * 2 ? "critical" : "warning", title: "Recovery rate decreased", detail: `Recovery is down ${round(drop)} percentage points from the previous period.`, currency: null });
  }

  const infrastructureThreshold = rules.get("infrastructure_cost_spike");
  if (infrastructureThreshold !== undefined) {
    const currencies = new Set([...input.currentCosts, ...input.previousCosts].map((item) => item.currency.toUpperCase()));
    for (const currency of currencies) {
      const current = sumCurrency(input.currentCosts, currency);
      const previous = sumCurrency(input.previousCosts, currency);
      if (previous <= 0) continue;
      const increase = percentChange(previous, current, "increase");
      if (increase >= infrastructureThreshold) alerts.push({ key: `infrastructure_cost_spike:${currency}`, severity: increase >= infrastructureThreshold * 2 ? "critical" : "warning", title: `${currency} infrastructure cost increased`, detail: `Recorded provider costs are ${increase}% above the previous period.`, currency });
    }
  }
  return alerts;
}

export function classifyR2Migration(input: {
  storedBytes: number;
  reviewAtBytes: number;
  recommendAtBytes: number;
}): "NOT NEEDED" | "REVIEW" | "RECOMMENDED" {
  if (input.storedBytes >= input.recommendAtBytes) return "RECOMMENDED";
  if (input.storedBytes >= input.reviewAtBytes) return "REVIEW";
  return "NOT NEEDED";
}

function sumNullable(values: Array<number | null>) {
  return values.some((value) => value === null) ? null : values.reduce<number>((sum, value) => sum + (value ?? 0), 0);
}

function divideMoney(amount: number, users: number) {
  return users > 0 ? Math.round(amount / users) : null;
}

function roundPercent(numerator: number, denominator: number) {
  return denominator > 0 ? round((numerator / denominator) * 100) : null;
}

function percentChange(previous: number, current: number, direction: "drop" | "increase") {
  if (previous <= 0) return 0;
  const delta = direction === "drop" ? previous - current : current - previous;
  return Math.max(0, round((delta / previous) * 100));
}

function addSpikeAlert(alerts: BusinessAlert[], threshold: number | undefined, previous: number, current: number, key: string, title: string) {
  if (threshold === undefined || previous <= 0) return;
  const increase = percentChange(previous, current, "increase");
  if (increase >= threshold) alerts.push({ key, severity: increase >= threshold * 2 ? "critical" : "warning", title, detail: `${current} in this period versus ${previous} previously, an increase of ${increase}%.`, currency: null });
}

function sumCurrency(items: FinancialCost[], currency: string) {
  return items.filter((item) => item.currency.toUpperCase() === currency).reduce((sum, item) => sum + item.amountMinor, 0);
}

function round(value: number) {
  return Math.round(value * 10) / 10;
}
