import type { RepairOutcome, RepairVerification } from "@/lib/admin/repair-verification";
import type { SystemicHealthSignal, SystemicRecurrenceAuthority } from "@/lib/admin/systemic-health";

export type SystemicVerificationSignalInput = {
  id: string;
  area: string;
  label: string;
  verifications: readonly Pick<RepairVerification, "outcome">[];
  firstObservedAt: string | null;
  lastObservedAt: string | null;
  repairablePerAccount: boolean;
  engineeringEscalation?: boolean;
  recurrenceAuthority?: SystemicRecurrenceAuthority;
};

/**
 * Turns Account Doctor verification outcomes into systemic-health counts.
 *
 * This is deliberately the bridge between the two subsystems so callers do not
 * hand-classify the same refusal differently in two places. Only a verifier
 * that says `still_broken` is defect evidence. A product-rule refusal is useful
 * support context but never recurrence evidence; `fixed` and `not_applicable`
 * are not affected accounts at all.
 */
export function systemicSignalFromVerifications(input: SystemicVerificationSignalInput): SystemicHealthSignal {
  const counts = countOutcomes(input.verifications.map((item) => item.outcome));

  return {
    id: input.id,
    area: input.area,
    label: input.label,
    affectedAccounts: counts.still_broken + counts.blocked_by_product_rule,
    productRuleAccounts: counts.blocked_by_product_rule,
    recurrenceAuthority: input.recurrenceAuthority ?? "recurring",
    firstObservedAt: input.firstObservedAt,
    lastObservedAt: input.lastObservedAt,
    repairablePerAccount: input.repairablePerAccount,
    engineeringEscalation: input.engineeringEscalation ?? false
  };
}

export function countOutcomes(outcomes: readonly RepairOutcome[]): Record<RepairOutcome, number> {
  const counts: Record<RepairOutcome, number> = {
    fixed: 0,
    still_broken: 0,
    not_applicable: 0,
    blocked_by_product_rule: 0
  };

  for (const outcome of outcomes) counts[outcome] += 1;
  return counts;
}
