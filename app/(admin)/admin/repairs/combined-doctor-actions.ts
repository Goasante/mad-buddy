"use server";

import { z } from "zod";

import {
  diagnoseAccountAction,
  type AccountDoctorState
} from "@/app/(admin)/admin/repairs/doctor-actions";
import { requireAdminPermission } from "@/lib/admin/access";
import type {
  AccountDoctorFinding,
  AccountDoctorSeverity
} from "@/lib/admin/account-doctor";
import { loadSupportOwnedSnapshot } from "@/lib/admin/support-owned-diagnostics.server";
import {
  buildSupportOwnedDiagnostics,
  type SupportOwnedDiagnostic
} from "@/lib/admin/support-owned-diagnostics";
import type { DoctorAreaId } from "@/lib/admin/support-doctor-priority";
import { requireSafetyAdmin } from "@/lib/safety/admin";

export type CombinedAccountDoctorSeverity = AccountDoctorSeverity | "product_rule";

export type CombinedAccountDoctorFinding = Omit<AccountDoctorFinding, "area" | "severity"> & {
  area: string;
  severity: CombinedAccountDoctorSeverity;
  operatorAction?: SupportOwnedDiagnostic["operatorAction"];
};

export type CombinedAccountDoctorState = Omit<AccountDoctorState, "findings" | "summary"> & {
  findings: CombinedAccountDoctorFinding[];
  summary: {
    issue: number;
    attention: number;
    productRule: number;
    info: number;
    healthy: number;
  };
};

const inputSchema = z.object({ userId: z.string().uuid() });

/* These baseline findings are replaced by the richer privacy-minimised model
 * below. Keeping both would show the operator two different interpretations of
 * the same account fact. Lifecycle-heavy findings remain owned by the base
 * Account Doctor and are never reimplemented here. */
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

/**
 * The live Account Doctor used by Repair Centre.
 *
 * The existing lifecycle Doctor remains the authority for relationships,
 * messaging, Plans, UpFor, Events and Safe Arrival. This action adds the
 * parallel support-owned areas without duplicating those lifecycle rules.
 */
export async function diagnoseCombinedAccountAction(input: unknown): Promise<CombinedAccountDoctorState> {
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) return emptyCombined("Choose a valid account.");

  let admin: Awaited<ReturnType<typeof requireSafetyAdmin>>["admin"];
  try {
    const auth = await requireSafetyAdmin();
    admin = auth.admin;
    await requireAdminPermission(admin, auth.context, "admin.support.manage");
  } catch {
    return emptyCombined("Admin access is required.");
  }

  /* Run the established lifecycle diagnosis and the privacy-minimised parallel
   * snapshot together. The lifecycle action owns search rate-limiting; this
   * wrapper does not consume a second quota for the same operator click. */
  const [base, ownedResult] = await Promise.all([
    diagnoseAccountAction(input),
    loadSupportOwnedSnapshot(admin, parsed.data.userId)
      .then((snapshot) => ({ ok: true as const, snapshot }))
      .catch(() => ({ ok: false as const }))
  ]);

  if (!base.ok) {
    return {
      ...base,
      findings: [],
      summary: { issue: 0, attention: 0, productRule: 0, info: 0, healthy: 0 }
    };
  }

  const baseFindings: CombinedAccountDoctorFinding[] = base.findings
    .filter((finding) => !REPLACED_BASE_FINDING_IDS.has(finding.id))
    .map((finding) => ({ ...finding }));

  const ownedFindings: CombinedAccountDoctorFinding[] = ownedResult.ok
    ? buildSupportOwnedDiagnostics(ownedResult.snapshot).map(mapOwnedFinding)
    : [
        {
          id: "support-owned-diagnostics-unavailable",
          area: "Account / Auth",
          severity: "issue",
          title: "Part of Account Doctor could not complete",
          detail:
            "The privacy-minimised account, profile, age, Linkr, presence, push and journey checks did not all complete. Do not infer health from missing results; retry the diagnosis or escalate if it repeats.",
          operatorAction: "escalate"
        }
      ];

  const findings = [...baseFindings, ...ownedFindings].sort(
    (a, b) => severityRank[a.severity] - severityRank[b.severity] || a.area.localeCompare(b.area) || a.id.localeCompare(b.id)
  );
  const summary = summarize(findings);

  return {
    ok: true,
    message:
      summary.issue > 0 || summary.attention > 0
        ? "Account Doctor found items that may need attention."
        : summary.productRule > 0
          ? "Account Doctor found no obvious lifecycle mismatch; some states are intentional product rules."
          : "Account Doctor found no obvious lifecycle mismatch.",
    findings,
    summary,
    checkedAt: base.checkedAt
  };
}

function mapOwnedFinding(finding: SupportOwnedDiagnostic): CombinedAccountDoctorFinding {
  return {
    id: `owned:${finding.id}`,
    area: AREA_LABEL[finding.areaId],
    severity: finding.severity,
    title: finding.title,
    detail: finding.detail,
    operatorAction: finding.operatorAction,
    repairId: finding.operatorAction === "use_named_repair" ? finding.repairId : undefined
  };
}

function summarize(findings: readonly CombinedAccountDoctorFinding[]): CombinedAccountDoctorState["summary"] {
  return findings.reduce(
    (summary, finding) => {
      if (finding.severity === "product_rule") summary.productRule += 1;
      else summary[finding.severity] += 1;
      return summary;
    },
    { issue: 0, attention: 0, productRule: 0, info: 0, healthy: 0 }
  );
}

function emptyCombined(message: string): CombinedAccountDoctorState {
  return {
    ok: false,
    message,
    findings: [],
    summary: { issue: 0, attention: 0, productRule: 0, info: 0, healthy: 0 },
    checkedAt: null
  };
}
