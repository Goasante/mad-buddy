import { SafetyDashboard } from "@/components/safety/safety-dashboard";
import { getSafetyDashboardData } from "@/lib/admin/safety-dashboard-data";
import { getSafetyAdminContext } from "@/lib/safety/admin";
import { requireAdminPagePermission } from "@/lib/admin/access";

export default async function AdminReportsPage() {
  await requireAdminPagePermission("admin.reports.review");
  const [context, data] = await Promise.all([getSafetyAdminContext(), getSafetyDashboardData()]);

  return (
    <SafetyDashboard
      reports={data.reports}
      deletionAudits={data.deletionAudits}
      metrics={data.metrics}
      isDevelopmentFallback={context.ok ? context.isDevelopmentFallback : false}
    />
  );
}
