import "server-only";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import type { ReportStatus } from "@/lib/supabase/database.types";
import type {
  SafetyDeletionAudit,
  SafetyMetric,
  SafetyReport
} from "@/components/safety/safety-dashboard";

const statusOrder: ReportStatus[] = ["open", "reviewing", "resolved", "dismissed"];

export type SafetyDashboardData = {
  reports: SafetyReport[];
  deletionAudits: SafetyDeletionAudit[];
  metrics: SafetyMetric[];
};

export async function getSafetyDashboardData(): Promise<SafetyDashboardData> {
  const admin = createSupabaseAdminClient();
  const [
    reportsResult,
    deletionAuditsResult,
    blockedUsersResult,
    profilesResult,
    activeUsersResult
  ] = await Promise.all([
    admin.from("reports").select("*").order("created_at", { ascending: false }).limit(50),
    admin
      .from("deletion_audit_logs")
      .select("*")
      .order("deleted_at", { ascending: false })
      .limit(12),
    admin.from("blocked_users").select("id", { count: "exact", head: true }),
    admin.from("profiles").select("user_id, full_name, username"),
    admin.from("profiles").select("id", { count: "exact", head: true }).is("deleted_at", null)
  ]);

  const reports = reportsResult.data ?? [];
  const profileLabels = new Map(
    (profilesResult.data ?? []).map((profile) => [
      profile.user_id,
      `${profile.full_name} (@${profile.username})`
    ])
  );
  const counts = statusOrder.reduce<Record<ReportStatus, number>>(
    (accumulator, status) => ({
      ...accumulator,
      [status]: reports.filter((report) => report.status === status).length
    }),
    { open: 0, reviewing: 0, resolved: 0, dismissed: 0 }
  );

  return {
    metrics: [
      { label: "Open reports", value: String(counts.open), tone: counts.open > 0 ? "danger" : "green" },
      { label: "Under review", value: String(counts.reviewing), tone: "warning" },
      { label: "Blocked pairs", value: String(blockedUsersResult.count ?? 0), tone: "blue" },
      { label: "Active accounts", value: String(activeUsersResult.count ?? 0), tone: "violet" }
    ],
    reports: reports.map((report) => ({
      id: report.id,
      reporterId: report.reporter_id,
      reporterLabel: report.reporter_id
        ? profileLabels.get(report.reporter_id) ?? "Unknown reporter"
        : "Deleted reporter",
      reportedUserId: report.reported_user_id,
      reportedUserLabel: report.reported_user_id
        ? profileLabels.get(report.reported_user_id) ?? report.reported_user_label
        : report.reported_user_label,
      reason: report.reason,
      description: report.description,
      status: report.status,
      createdAt: report.created_at,
      updatedAt: report.updated_at
    })),
    deletionAudits: (deletionAuditsResult.data ?? []).map((audit) => ({
      id: audit.id,
      deletedUserLabel: audit.deleted_user_label,
      deletionReason: audit.deletion_reason,
      retainedBillingReference: audit.retained_billing_reference,
      retainedReportReference: audit.retained_report_reference,
      deletedAt: audit.deleted_at
    }))
  };
}
