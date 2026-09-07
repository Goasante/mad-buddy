import type {
  AccountDoctorFinding,
  AccountDoctorSeverity
} from "@/lib/admin/account-doctor";
import type { SupportOwnedDiagnostic } from "@/lib/admin/support-owned-diagnostics";
import type { DoctorAreaId } from "@/lib/admin/support-doctor-priority";

export type CombinedAccountDoctorSeverity = AccountDoctorSeverity | "product_rule";

export type CombinedAccountDoctorFinding = Omit<AccountDoctorFinding, "area" | "severity"> & {
  area: string;
  severity: CombinedAccountDoctorSeverity;
  operatorAction?: SupportOwnedDiagnostic["operatorAction"];
};

export type CombinedAccountDoctorSummary = {
  issue: number;
  attention: number;
  productRule: number;
  info: number;
  healthy: number;
};

/* These baseline findings are replaced by the richer privacy-minimised model.
 * Keeping both would show the operator two interpretations of the same fact.
 * Lifecycle-heavy findings remain owned by the base Account Doctor. */
const REPLACED_BASE_FINDING_IDS = new Set([
  "account-setup",
  "stale-status",
  "presence-signal",
  "active-rate-limits",
  "notification-summary"
]);

const AREA_LABEL: Record<DoctorAreaId, string> = {
  "account-auth": "Account / Auth",
  "onboarding-activation": "Onboarding",
  "profile-media": "Profile / Media",
  "dob-age": "DOB / Age",
  "muddies-requests": "Relationships",
  "blocks-refriend": "Relationships",
  "direct-messaging": "Messaging",
  "plan-chat": "Plans",
  plans: "Plans",
  upfor: "UpFor",
  linkr: "Linkr",
  presence: "Presence",
  notifications: "Notifications",
  push: "Push",
  events: "Events",
  "safe-arrival": "Safe Arrival",
  "access-billing": "Access / Billing",
  "features-tours": "Features / Limits",
  journey: "Journey",
  "privacy-account-ops": "Privacy / Account"
};

const severityRank: Record<CombinedAccountDoctorSeverity, number> = {
  issue: 0,
  attention: 1,
  product_rule: 2,
  info: 3,
  healthy: 4
};

export function combineAccountDoctorFindings(
  base: readonly AccountDoctorFinding[],
  owned: readonly SupportOwnedDiagnostic[]
): CombinedAccountDoctorFinding[] {
  const baseFindings: CombinedAccountDoctorFinding[] = base
    .filter((finding) => !REPLACED_BASE_FINDING_IDS.has(finding.id))
    .map((finding) => ({ ...finding }));

  const ownedFindings = owned.map(mapOwnedFinding);

  return [...baseFindings, ...ownedFindings].sort(
    (a, b) => severityRank[a.severity] - severityRank[b.severity] || a.area.localeCompare(b.area) || a.id.localeCompare(b.id)
  );
}

export function unavailableSupportOwnedFinding(): CombinedAccountDoctorFinding {
  return {
    id: "support-owned-diagnostics-unavailable",
    area: "Account / Auth",
    severity: "issue",
    title: "Part of Account Doctor could not complete",
    detail:
      "The privacy-minimised account, profile, age, Linkr, presence, push and journey checks did not all complete. Do not infer health from missing results; retry the diagnosis or escalate if it repeats.",
    operatorAction: "escalate"
  };
}

export function summarizeCombinedFindings(
  findings: readonly CombinedAccountDoctorFinding[]
): CombinedAccountDoctorSummary {
  return findings.reduce(
    (summary, finding) => {
      if (finding.severity === "product_rule") summary.productRule += 1;
      else summary[finding.severity] += 1;
      return summary;
    },
    { issue: 0, attention: 0, productRule: 0, info: 0, healthy: 0 }
  );
}

function mapOwnedFinding(finding: SupportOwnedDiagnostic): CombinedAccountDoctorFinding {
  return {
    id: `owned:${finding.id}`,
    area: AREA_LABEL[finding.areaId],
    severity: finding.severity,
    title: finding.title,
    detail: finding.detail,
    operatorAction: finding.operatorAction,
    // A recipe id alone is never permission to render a repair. The diagnostic
    // must explicitly say the next action is the named canonical repair.
    repairId: finding.operatorAction === "use_named_repair" ? finding.repairId : undefined
  };
}
