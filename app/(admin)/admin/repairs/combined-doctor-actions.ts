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

  /* The lifecycle Doctor owns auth, permission and the admin.search rate limit.
   * It must finish first. Running our extra reads in parallel would still hit
   * the database on a rate-limited request even though the response was later
   * discarded. */
  const base = await diagnoseAccountAction(input);
  if (!base.ok) {
    return {
      ...base,
      findings: [],
      summary: { issue: 0, attention: 0, productRule: 0, info: 0, healthy: 0 }
    };
  }

  let ownedResult:
    | { ok: true; snapshot: Awaited<ReturnType<typeof loadSupportOwnedSnapshot>> }
    | { ok: false } = { ok: false };
  try {
    const auth = await requireSafetyAdmin();
    await requireAdminPermission(auth.admin, auth.context, "admin.support.manage");
    const snapshot = await loadSupportOwnedSnapshot(auth.admin, parsed.data.userId);
    ownedResult = { ok: true, snapshot };
  } catch {
    /* Fail closed below. A partial provider failure becomes an operator-visible
     * issue; no zero/healthy defaults are fabricated. */
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
