import { UserPlus } from "lucide-react";
import { CreateAdminForm } from "@/components/admin/create-admin-form";
import { TeamAccessManager, type TeamMember } from "@/components/admin/team-access-manager";
import { AdminPageHeader, AdminQueryError, AdminSection, AdminStatus } from "@/components/admin/admin-ui";
import { Card } from "@/components/ui/card";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getSafetyAdminContext } from "@/lib/safety/admin";
import { getAdminAccess } from "@/lib/admin/access";
import type { StaffRole } from "@/lib/admin/governance";
import { redirect } from "next/navigation";

export default async function TeamAccessPage() {
  const context = await getSafetyAdminContext();
  if (!context.ok) redirect("/admin/login");

  const admin = createSupabaseAdminClient();
  const access = await getAdminAccess(admin, context);
  if (!access.permissions.has("admin.roles.manage")) redirect("/admin");

  const adminsResult = await admin
    .from("admin_users")
    .select("email, role, auth_user_id, disabled_at, created_at, invited_by_user_id")
    .order("created_at", { ascending: false });
  const rows = adminsResult.data ?? [];

  // Enrich the (small) staff list with display names/avatars from profiles.
  const linkedIds = [
    ...new Set(
      rows
        .flatMap((row) => [row.auth_user_id, row.invited_by_user_id])
        .filter((id): id is string => Boolean(id))
    )
  ];
  const profileById = new Map<string, { full_name: string; avatar_url: string | null }>();
  if (linkedIds.length > 0) {
    const { data: profiles } = await admin
      .from("profiles")
      .select("user_id, full_name, avatar_url")
      .in("user_id", linkedIds);
    for (const profile of profiles ?? []) {
      profileById.set(profile.user_id, { full_name: profile.full_name, avatar_url: profile.avatar_url });
    }
  }

  const team: TeamMember[] = rows.map((row) => {
    const profile = row.auth_user_id ? profileById.get(row.auth_user_id) : undefined;
    const inviter = row.invited_by_user_id ? profileById.get(row.invited_by_user_id) : undefined;
    return {
      userId: row.auth_user_id,
      email: row.email,
      displayName: profile?.full_name ?? row.email,
      avatarUrl: profile?.avatar_url ?? null,
      role: row.role as StaffRole,
      active: !row.disabled_at,
      addedBy: inviter?.full_name ?? null,
      addedOn: row.created_at,
      // No canonical "last active" timestamp exists; showing "—" rather than
      // inventing one (spec §4: do not show invented data).
      lastActive: null,
      isCurrentUser: row.email === context.email
    };
  });

  const activeCount = team.filter((member) => member.active).length;

  return (
    <div className="space-y-7">
      <AdminPageHeader
        title="Team access"
        description="Manage authorised Admin and Support accounts."
        meta={<AdminStatus label={`${activeCount} active`} tone="success" />}
      />

      {adminsResult.error ? <AdminQueryError message="The team could not be loaded." /> : null}

      <TeamAccessManager actorRole={access.role} team={team} />

      {access.role === "owner" ? (
        <AdminSection
          title="Create a new staff login"
          description="Advanced: provision a brand-new staff account with its own password. Prefer adding existing users above."
        >
          <Card className="p-5">
            <div className="mb-5 flex items-center gap-3">
              <span className="grid h-10 w-10 place-items-center rounded-xl bg-orange-500/10 text-orange-400">
                <UserPlus className="h-5 w-5" aria-hidden="true" />
              </span>
              <div>
                <p className="text-sm font-semibold">New staff account</p>
                <p className="text-xs text-muted-foreground">Use a temporary password. Passwords stay in Supabase Auth.</p>
              </div>
            </div>
            <CreateAdminForm allowOwner={access.role === "owner"} />
          </Card>
        </AdminSection>
      ) : null}
    </div>
  );
}
