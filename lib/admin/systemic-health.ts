export type SystemicHealthSeverity = "normal" | "watch" | "systemic";
export type SystemicRecurrenceAuthority = "recurring" | "legacy_only";

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
  /**
   * Whether the broken state can still be CREATED under the current schema.
   *
   * `legacy_only` is for historical drift whose current database authority now
   * prevents new occurrences. Its population may still need per-account cleanup,
   * but the count is backlog, not recurrence evidence. A later increase means
   * the measurement/predicate is wrong or an invariant regressed; it must not be
   * labelled a systemic product defect from count alone.
   */
  recurrenceAuthority?: SystemicRecurrenceAuthority;
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
  recurrenceAuthority: SystemicRecurrenceAuthority;
  /** Whether raw account count is valid evidence of a currently recurring defect. */
  recurrenceEvidenceEligible: boolean;
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
 *
 * LEGACY-ONLY DRIFT IS NOT RECURRENCE EVIDENCE. If the current database rejects
 * creation of a state, ten historical rows do not mean the defect happened ten
 * times under today's product. They are a cleanup backlog. A rising count would
 * contradict the database authority and should trigger an audit of the
 * predicate/invariant, not an automatic "systemic product defect" label.
 */
export function assessSystemicHealth(signal: SystemicHealthSignal): SystemicHealthAssessment {
  const observed = Math.max(0, Math.trunc(signal.affectedAccounts));
  const productRule = Math.min(observed, Math.max(0, Math.trunc(signal.productRuleAccounts ?? 0)));
  const actionable = observed - productRule;
  const recurrenceAuthority = signal.recurrenceAuthority ?? "recurring";
  const recurrenceEvidenceEligible = recurrenceAuthority === "recurring";

  if (actionable === 0 && productRule > 0) {
    return {
      ...signal,
      affectedAccounts: observed,
      productRuleAccounts: productRule,
      actionableAffectedAccounts: 0,
      recurrenceAuthority,
      recurrenceEvidenceEligible,
      severity: "normal",
      guidance:
        "Observed reports are explained by product rules, not broken invariants. Explain the rule to users and do not escalate or repair past it."
    };
  }

  if (!recurrenceEvidenceEligible && actionable > 0) {
    return {
      ...signal,
      affectedAccounts: observed,
      productRuleAccounts: productRule,
      actionableAffectedAccounts: actionable,
      recurrenceAuthority,
      recurrenceEvidenceEligible: false,
      severity: "normal",
      guidance:
        "Legacy-only drift. The current database prevents new occurrences of this state, so the count is cleanup backlog rather than recurrence evidence. If this count rises, audit the predicate/database invariant instead of classifying it as a systemic product defect."
    };
  }

  if ((signal.engineeringEscalation && actionable > 0) || actionable >= 10) {
    return {
      ...signal,
      affectedAccounts: observed,
      productRuleAccounts: productRule,
      actionableAffectedAccounts: actionable,
      recurrenceAuthority,
      recurrenceEvidenceEligible,
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
      recurrenceAuthority,
      recurrenceEvidenceEligible,
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
    recurrenceAuthority,
    recurrenceEvidenceEligible,
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
        Number(right.recurrenceEvidenceEligible) - Number(left.recurrenceEvidenceEligible) ||
        right.actionableAffectedAccounts - left.actionableAffectedAccounts ||
        left.area.localeCompare(right.area) ||
        left.id.localeCompare(right.id)
    );
}
