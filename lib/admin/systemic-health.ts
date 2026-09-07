export type SystemicHealthSeverity = "normal" | "watch" | "systemic";

export type SystemicHealthSignal = {
  id: string;
  area: string;
  label: string;
  /** All accounts observed by this predicate, including intentional refusals. */
  affectedAccounts: number;
  /**
   * Accounts whose state is correct because a product rule is refusing the
   * action (for example a live block or age gate). These are explanatory cases,
   * never defect evidence, and are subtracted before recurrence thresholds are
   * evaluated.
   */
  productRuleAccounts?: number;
  firstObservedAt: string | null;
  lastObservedAt: string | null;
  repairablePerAccount: boolean;
  engineeringEscalation: boolean;
};

export type SystemicHealthAssessment = SystemicHealthSignal & {
  severity: SystemicHealthSeverity;
  guidance: string;
  /** Accounts whose invariant is actually broken after product rules are removed. */
  actionableAffectedAccounts: number;
  productRuleAccounts: number;
};

/**
 * Support should not silently normalize repeated invariant failures into a pile
 * of one-off repairs. This deliberately uses deterministic thresholds rather
 * than opaque scoring so operators can understand why an incident is elevated.
 *
 * PRODUCT-RULE CASES ARE NOT DEFECTS. A blocked pair, an under-18 account, or a
 * lapsed entitlement can produce the same user-facing "I cannot do this" report
 * as drift while the product is behaving exactly as designed. Those cases are
 * counted for operator context but excluded from the recurrence threshold.
 */
export function assessSystemicHealth(signal: SystemicHealthSignal): SystemicHealthAssessment {
  const observed = Math.max(0, Math.trunc(signal.affectedAccounts));
  const productRule = Math.min(observed, Math.max(0, Math.trunc(signal.productRuleAccounts ?? 0)));
  const actionable = observed - productRule;

  if (actionable === 0 && productRule > 0) {
    return {
      ...signal,
      affectedAccounts: observed,
      productRuleAccounts: productRule,
      actionableAffectedAccounts: 0,
      severity: "normal",
      guidance:
        "Observed reports are explained by product rules, not broken invariants. Explain the rule to users and do not escalate or repair past it."
    };
  }

  if ((signal.engineeringEscalation && actionable > 0) || actionable >= 10) {
    return {
      ...signal,
      affectedAccounts: observed,
      productRuleAccounts: productRule,
      actionableAffectedAccounts: actionable,
      severity: "systemic",
      guidance:
        "Possible systemic defect. Keep per-account repair available for urgent support, but escalate the repeated invariant failure to engineering."
    };
  }

  if (actionable >= 3) {
    return {
      ...signal,
      affectedAccounts: observed,
      productRuleAccounts: productRule,
      actionableAffectedAccounts: actionable,
      severity: "watch",
      guidance:
        "Repeated account drift detected. Watch recurrence and compare recent support reports before treating this as isolated."
    };
  }

  return {
    ...signal,
    affectedAccounts: observed,
    productRuleAccounts: productRule,
    actionableAffectedAccounts: actionable,
    severity: "normal",
    guidance:
      actionable === 0
        ? "No broken account invariant is currently measured by this signal."
        : signal.repairablePerAccount
          ? "Looks isolated. Use the canonical per-account diagnostic and repair workflow when the user is affected."
          : "Looks isolated. Diagnose and explain the product rule or escalate if the account cannot be safely repaired."
  };
}

export function sortSystemicHealth(signals: readonly SystemicHealthSignal[]): SystemicHealthAssessment[] {
  const severityRank: Record<SystemicHealthSeverity, number> = { systemic: 0, watch: 1, normal: 2 };
  return signals
    .map(assessSystemicHealth)
    .sort(
      (left, right) =>
        severityRank[left.severity] - severityRank[right.severity] ||
        right.actionableAffectedAccounts - left.actionableAffectedAccounts ||
        left.area.localeCompare(right.area) ||
        left.id.localeCompare(right.id)
    );
}
