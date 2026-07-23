import { redirect } from "next/navigation";
import { AdminPageHeader } from "@/components/admin/admin-ui";
import { MaintenanceModePanel } from "@/components/admin/maintenance-mode-panel";
import { getAdminAccess } from "@/lib/admin/access";
import { maintenanceMessageOrDefault } from "@/lib/maintenance/state";
import { getSafetyAdminContext } from "@/lib/safety/admin";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

export default async function AdminMaintenancePage() {
  const admin = createSupabaseAdminClient();
  const context = await getSafetyAdminContext();
  if (!context.ok) redirect("/admin/login");
  const access = await getAdminAccess(admin, context);
  if (!access.permissions.has("admin.maintenance.manage")) redirect("/admin");

  const { data } = await admin
    .from("maintenance_mode")
    .select("is_active, message, activated_at")
    .eq("id", true)
    .maybeSingle();

  return (
    <div className="space-y-6">
      <AdminPageHeader
        title="Maintenance"
        description="Pause the app for everyone while you work. Staff keep full access so you can verify the fix before reopening."
      />
      <MaintenanceModePanel
        isActive={Boolean(data?.is_active)}
        message={maintenanceMessageOrDefault(data?.message)}
        activatedAt={data?.activated_at ?? null}
      />
    </div>
  );
}
