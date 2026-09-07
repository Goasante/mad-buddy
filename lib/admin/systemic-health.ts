export type SystemicHealthSeverity = "normal" | "watch" | "systemic";

export type SystemicHealthSignal = {
  id: string;
  area: string;
  label: string;
  affectedAccounts: number;
  firstObservedAt: string | null;
  lastObservedAt: string | null;
  repairablePerAccount: boolean;
  engineeringEscalation: boolean;
};

export type SystemicHealthAssessment = SystemicHealthSignal & {
  severity: SystemicHealthSeverity;
  guidance: string;
};

/**
 * Support should not silently normalize repeated invariant failures into a pile
 * of one-off repairs. This deliberately uses deterministic thresholds rather
 * than opaque scoring so operators can understand why an incident is elevated.
 */
export function assessSystemicHealth(signal: SystemicHealthSignal): SystemicHealthAssessment {
  const affected = Math.max(0, Math.trunc(signal.affectedAccounts));

  if (signal.engineeringEscalation || affected >= 10) {
    return {
      ...signal,
      affectedAccounts: affected,
      severity: "systemic",
      guidance:
        "Possible systemic defect. Keep per-account repair available for urgent support, but escalate the repeated invariant failure to engineering."
    };
  }

  if (affected >= 3) {
    return {
      ...signal,
      affectedAccounts: affected,
      severity: "watch",
      guidance:
        "Repeated account drift detected. Watch recurrence and compare recent support reports before treating this as isolated."
    };
  }

  return {
    ...signal,
    affectedAccounts: affected,
    severity: "normal",
    guidance:
      signal.repairablePerAccount
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
        right.affectedAccounts - left.affectedAccounts ||
        left.area.localeCompare(right.area) ||
        left.id.localeCompare(right.id)
    );
}
