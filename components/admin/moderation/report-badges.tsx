import { AdminStatus } from "@/components/admin/admin-ui";
import { categoryLabel, isHighSignalCategory, reportStatusLabel, reportStatusTone, type ReportKind } from "@/lib/admin/moderation";

export function ReportStatusBadge({ kind, status }: { kind: ReportKind; status: string }) {
  return <AdminStatus label={reportStatusLabel(kind, status)} tone={reportStatusTone(kind, status)} />;
}

/** Category badge; location/safety-critical categories get danger styling. */
export function ReportCategoryBadge({ category }: { category: string }) {
  return <AdminStatus label={categoryLabel(category)} tone={isHighSignalCategory(category) ? "danger" : "default"} />;
}
