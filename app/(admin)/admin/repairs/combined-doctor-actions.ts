"use server";

import { z } from "zod";

import {
  diagnoseAccountAction,
  type AccountDoctorState
} from "@/app/(admin)/admin/repairs/doctor-actions";
import { requireAdminPermission } from "@/lib/admin/access";
import {
  combineAccountDoctorFindings,
  summarizeCombinedFindings,
  unavailableSupportOwnedFinding,
  type CombinedAccountDoctorFinding,
  type CombinedAccountDoctorSeverity,
  type CombinedAccountDoctorSummary
} from "@/lib/admin/combined-doctor";
import { loadSupportOwnedSnapshot } from "@/lib/admin/support-owned-diagnostics.server";
import { buildSupportOwnedDiagnostics } from "@/lib/admin/support-owned-diagnostics";
import { requireSafetyAdmin } from "@/lib/safety/admin";

export type { CombinedAccountDoctorFinding, CombinedAccountDoctorSeverity } from "@/lib/admin/combined-doctor";

export type CombinedAccountDoctorState = Omit<AccountDoctorState, "findings" | "summary"> & {
  findings: CombinedAccountDoctorFinding[];
  summary: CombinedAccountDoctorSummary;
};

const inputSchema = z.object({ userId: z.string().uuid() });

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

  const findings = ownedResult.ok
    ? combineAccountDoctorFindings(base.findings, buildSupportOwnedDiagnostics(ownedResult.snapshot))
    : [
        ...combineAccountDoctorFindings(base.findings, []),
        unavailableSupportOwnedFinding()
      ].sort((a, b) => combinedSeverityRank(a.severity) - combinedSeverityRank(b.severity) || a.area.localeCompare(b.area) || a.id.localeCompare(b.id));
  const summary = summarizeCombinedFindings(findings);

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

function combinedSeverityRank(severity: CombinedAccountDoctorSeverity): number {
  if (severity === "issue") return 0;
  if (severity === "attention") return 1;
  if (severity === "product_rule") return 2;
  if (severity === "info") return 3;
  return 4;
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
