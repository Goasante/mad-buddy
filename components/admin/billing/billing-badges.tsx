import { AdminStatus } from "@/components/admin/admin-ui";
import { planLabel, planTone, statusLabel, statusTone } from "@/lib/admin/billing-admin";

export function PlanBadge({ plan }: { plan: string }) {
  return <AdminStatus label={planLabel(plan)} tone={planTone(plan)} />;
}

export function SubscriptionStatusBadge({ status }: { status: string }) {
  return <AdminStatus label={statusLabel(status)} tone={statusTone(status)} />;
}
