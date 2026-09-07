import { redirect } from "next/navigation";
import { AdminPageHeader } from "@/components/admin/admin-ui";
import { RepairCentre } from "@/components/admin/repairs/repair-centre";
import { getAdminAccess } from "@/lib/admin/access";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getSafetyAdminContext } from "@/lib/safety/admin";
import { allowedRepairs } from "@/lib/admin/repairs";

export default async function RepairsPage() {
  const admin = createSupabaseAdminClient();
  const context = await getSafetyAdminContext();
  if (!context.ok) redirect("/admin/login");
  const access = await getAdminAccess(admin, context);
  if (!access.permissions.has("admin.support.manage")) redirect("/admin");

  // Only offer repairs this actor is actually allowed to run.
  const allowedIds = allowedRepairs([...access.permissions]).map((repair) => repair.id);

  return (
    <div className="space-y-6">
      <AdminPageHeader
        title="Account Doctor & repairs"
        description="Diagnose safe account lifecycle state first, then run narrow audited repairs only when the account actually needs them."
      />
      <RepairCentre allowedRepairIds={allowedIds} />
    </div>
  );
}
