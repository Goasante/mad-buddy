import { UserPlus, UsersRound } from "lucide-react";
import { AdminAccessControl } from "@/components/admin/admin-access-control";
import { CreateAdminForm } from "@/components/admin/create-admin-form";
import { AdminEmptyState, AdminPageHeader, AdminQueryError, AdminSection, AdminStatus, formatAdminDate, humanizeAdminValue } from "@/components/admin/admin-ui";
import { Card } from "@/components/ui/card";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getSafetyAdminContext } from "@/lib/safety/admin";
import { getAdminAccess } from "@/lib/admin/access";
import { redirect } from "next/navigation";

export default async function AdminUsersManagementPage() {
  const admin = createSupabaseAdminClient();
  const [context, adminsResult] = await Promise.all([
    getSafetyAdminContext(),
    admin.from("admin_users").select("email, role, auth_user_id, disabled_at, created_at").order("created_at", { ascending: false })
  ]);
  const admins = adminsResult.data ?? [];
  if (!context.ok) redirect("/admin/login");
  const access = await getAdminAccess(admin, context);
  if (!access.permissions.has("admin.roles.manage")) redirect("/admin");

  return (
    <div className="space-y-7">
      <AdminPageHeader title="Admin team" description="Manage restricted staff access. Passwords remain in Supabase Auth and every access change is audited." meta={<AdminStatus label={`${admins.filter((item) => !item.disabled_at).length} active`} tone="success" />} />
      <div className="grid items-start gap-5 xl:grid-cols-[minmax(320px,0.72fr)_minmax(0,1.28fr)]">
        <AdminSection title="Add team member" description="Create a staff login and assign its governance role.">
          <Card className="p-5"><div className="mb-5 flex items-center gap-3"><span className="grid h-10 w-10 place-items-center rounded-xl bg-orange-500/10 text-orange-400"><UserPlus className="h-5 w-5" aria-hidden="true" /></span><div><p className="text-sm font-semibold">New admin account</p><p className="text-xs text-muted-foreground">Use a temporary password.</p></div></div><CreateAdminForm allowOwner={access.role === "owner"} /></Card>
        </AdminSection>
        <AdminSection title="Current access" description="Disable access immediately or restore a suspended staff account.">
          {adminsResult.error ? <AdminQueryError message="The admin access table could not be loaded." /> : null}
          {!adminsResult.error && admins.length === 0 ? <AdminEmptyState icon={UsersRound} title="No database admins" description="The environment bootstrap admin remains available." /> : null}
          <div className="grid gap-3">{admins.map((item) => <Card key={item.email} className="p-4"><div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><p className="truncate text-sm font-semibold">{item.email}</p>{context.ok && item.email === context.email ? <AdminStatus label="You" /> : null}</div><p className="mt-1 text-xs text-muted-foreground">{humanizeAdminValue(item.role)} · Added {formatAdminDate(item.created_at)}</p><div className="mt-2 flex flex-wrap gap-2"><AdminStatus label={item.disabled_at ? "Disabled" : "Active"} tone={item.disabled_at ? "warning" : "success"} /><AdminStatus label={item.auth_user_id ? "Auth linked" : "Email only"} /></div></div><AdminAccessControl email={item.email} disabled={Boolean(item.disabled_at)} isCurrent={Boolean(context.ok && item.email === context.email)} /></div></Card>)}</div>
        </AdminSection>
      </div>
    </div>
  );
}
