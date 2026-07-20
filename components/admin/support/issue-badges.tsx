import { AdminStatus } from "@/components/admin/admin-ui";
import { priorityLabel, priorityTone, statusLabel, statusTone } from "@/lib/admin/support";

/** Status badge — friendly label + tone driven by the shared domain helpers. */
export function IssueStatusBadge({ status }: { status: string }) {
  return <AdminStatus label={statusLabel(status)} tone={statusTone(status as never)} />;
}

/** Priority badge — Critical (urgent) gets restrained danger styling. */
export function IssuePriorityBadge({ priority }: { priority: string }) {
  return <AdminStatus label={priorityLabel(priority)} tone={priorityTone(priority as never)} />;
}
