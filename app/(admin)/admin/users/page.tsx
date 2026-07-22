import Link from "next/link";
import type { Route } from "next";
import { Search, UsersRound } from "lucide-react";
import {
  AdminEmptyState,
  AdminPageHeader,
  AdminQueryError,
  AdminStatus,
  formatAdminDate,
  humanizeAdminValue
} from "@/components/admin/admin-ui";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { AdminUserControls } from "@/components/admin/admin-user-controls";
import { OrphanAccountRow } from "@/components/admin/orphan-account-row";
import { listOrphanAuthAccounts } from "@/lib/admin/orphan-accounts";
import { getAdminAccess } from "@/lib/admin/access";
import { getSafetyAdminContext } from "@/lib/safety/admin";
import { redirect } from "next/navigation";

type UserFilter = "all" | "active" | "new" | "deleted";
type AdminUsersPageProps = {
  searchParams: Promise<{ q?: string; status?: string; page?: string }>;
};

const pageSize = 25;
const adminProcessStartedAt = Date.now();
const filters: Array<{ id: UserFilter; label: string }> = [
  { id: "all", label: "All" },
  { id: "active", label: "Active" },
  { id: "new", label: "New" },
  { id: "deleted", label: "Deleted" }
];

export default async function AdminUsersPage({ searchParams }: AdminUsersPageProps) {
  const params = await searchParams;
  const search = sanitizeSearch(params.q);
  const filter = filters.some((item) => item.id === params.status) ? params.status as UserFilter : "active";
  const requestedPage = Number.parseInt(params.page ?? "1", 10);
  const page = Number.isFinite(requestedPage) && requestedPage > 0 ? requestedPage : 1;
  const admin = createSupabaseAdminClient();
  const context = await getSafetyAdminContext();
  if (!context.ok) redirect("/admin/login");
  const access = await getAdminAccess(admin, context);
  if (!access.permissions.has("admin.users.view_summary")) redirect("/admin");

  let profilesQuery = admin
    .from("profiles")
    .select("user_id, full_name, username, visibility_status, is_onboarded, deleted_at, created_at", { count: "exact" })
    .order("created_at", { ascending: false });

  if (search) profilesQuery = profilesQuery.or(`username.ilike.%${search}%,full_name.ilike.%${search}%`);
  if (filter === "active") profilesQuery = profilesQuery.is("deleted_at", null);
  if (filter === "new") profilesQuery = profilesQuery.is("deleted_at", null).eq("is_onboarded", false);
  if (filter === "deleted") profilesQuery = profilesQuery.not("deleted_at", "is", null);

  const profilesResult = await profilesQuery.range((page - 1) * pageSize, page * pageSize - 1);
  const profiles = profilesResult.data ?? [];
  const userIds = profiles.map((profile) => profile.user_id);
  const [subscriptionsResult, restrictionsResult] = userIds.length > 0
    ? await Promise.all([
        admin.from("subscriptions").select("user_id, plan, status").in("user_id", userIds),
        admin.from("user_restrictions").select("user_id, restriction_type, ends_at").in("user_id", userIds).is("lifted_at", null)
      ])
    : [{ data: [], error: null }, { data: [], error: null }];

  const subscriptionByUser = new Map((subscriptionsResult.data ?? []).map((item) => [item.user_id, item]));
  const restrictionCountByUser = new Map<string, number>();
  const suspendedUsers = new Set<string>();
  for (const restriction of restrictionsResult.data ?? []) {
    if (restriction.ends_at && Date.parse(restriction.ends_at) <= adminProcessStartedAt) continue;
    restrictionCountByUser.set(restriction.user_id, (restrictionCountByUser.get(restriction.user_id) ?? 0) + 1);
    if (restriction.restriction_type === "suspended_temporary" || restriction.restriction_type === "suspended_permanent") suspendedUsers.add(restriction.user_id);
  }

  const total = profilesResult.count ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  // Safeguard: surface auth accounts that have no profile row (e.g. an OAuth
  // sign-up whose profile bootstrap failed). Without this they never appear in
  // this list. Computed once on the first, unfiltered view since it's a global
  // alert rather than a per-page slice.
  const canRepairAccounts = access.permissions.has("admin.support.manage");
  const orphanAccounts = page === 1 && !search ? await listOrphanAuthAccounts(admin) : [];

  return (
    <div className="space-y-6">
      <AdminPageHeader
        title="Users"
        description="Search account summaries and review onboarding, subscription, visibility, and restriction states. Exact location and private content are excluded."
        meta={<AdminStatus label={`${total} ${total === 1 ? "result" : "results"}`} />}
      />

      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <nav className="no-scrollbar flex gap-1 overflow-x-auto" aria-label="User status filters">
          {filters.map((item) => (
            <Link
              key={item.id}
              href={usersHref({ search, filter: item.id, page: 1 })}
              aria-current={filter === item.id ? "page" : undefined}
              className={cn(
                "focus-ring safe-motion shrink-0 rounded-lg px-3 py-2 text-sm font-medium",
                filter === item.id ? "bg-secondary text-foreground" : "text-muted-foreground hover:bg-secondary/50"
              )}
            >
              {item.label}
            </Link>
          ))}
        </nav>

        <form className="flex w-full gap-2 lg:max-w-md">
          <input type="hidden" name="status" value={filter} />
          <label className="relative min-w-0 flex-1" htmlFor="admin-user-search">
            <span className="sr-only">Search users</span>
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
            <input
              id="admin-user-search"
              name="q"
              defaultValue={search}
              placeholder="Search name or username"
              className="focus-ring h-10 w-full rounded-xl border border-border bg-card/60 pl-9 pr-3 text-sm outline-none placeholder:text-muted-foreground"
            />
          </label>
          <Button type="submit" size="sm">Search</Button>
          {search ? <Button type="button" variant="ghost" size="sm" asChild><Link href={usersHref({ filter, page: 1 })}>Clear</Link></Button> : null}
        </form>
      </div>

      {profilesResult.error || subscriptionsResult.error || restrictionsResult.error ? <AdminQueryError /> : null}

      {orphanAccounts.length > 0 ? (
        <Card className="overflow-hidden border-amber-400/30 p-0">
          <div className="flex items-center justify-between gap-3 border-b border-amber-400/20 bg-amber-400/10 px-4 py-3">
            <div>
              <p className="text-sm font-semibold text-amber-100">
                {orphanAccounts.length} account{orphanAccounts.length === 1 ? "" : "s"} without a profile
              </p>
              <p className="mt-0.5 text-xs text-amber-100/80">
                These exist in auth but never got a profile row, so they don&rsquo;t show in the list below. Create the
                profile to restore them.
              </p>
            </div>
          </div>
          <div className="divide-y divide-border/70">
            {orphanAccounts.map((account) => (
              <OrphanAccountRow key={account.id} account={account} canRepair={canRepairAccounts} />
            ))}
          </div>
        </Card>
      ) : null}

      {!profilesResult.error && profiles.length === 0 ? (
        <AdminEmptyState icon={UsersRound} title="No users found" description={search ? "Try another name or username." : "No accounts match this filter."} />
      ) : (
        <Card className="overflow-hidden p-0">
          <div className="hidden grid-cols-[minmax(240px,1.4fr)_140px_130px_130px_110px] gap-4 border-b border-border/70 bg-secondary/25 px-4 py-3 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground md:grid">
            <span>User</span><span>Joined</span><span>Account</span><span>Plan</span><span>Restrictions</span>
          </div>
          <div className="divide-y divide-border/70">
            {profiles.map((profile) => {
              const subscription = subscriptionByUser.get(profile.user_id);
              const restrictions = restrictionCountByUser.get(profile.user_id) ?? 0;
              return (
                <div key={profile.user_id} className="grid gap-3 px-4 py-4 md:grid-cols-[minmax(240px,1.4fr)_140px_130px_130px_110px] md:items-center md:gap-4">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold">{profile.full_name}</p>
                    <p className="mt-0.5 truncate text-xs text-muted-foreground">@{profile.username}</p>
                  </div>
                  <p className="text-xs text-muted-foreground"><span className="mr-2 font-medium md:hidden">Joined</span>{formatAdminDate(profile.created_at)}</p>
                  <div>
                    {profile.deleted_at ? <AdminStatus label="Deleted" tone="warning" /> : profile.is_onboarded ? <AdminStatus label="Active" tone="success" /> : <AdminStatus label="New" />}
                  </div>
                  <div className="text-xs font-medium"><span className="mr-2 text-muted-foreground md:hidden">Plan</span>{humanizeAdminValue(subscription?.plan ?? "free")}</div>
                  <div>{restrictions > 0 ? <AdminStatus label={String(restrictions)} tone="danger" /> : <AdminStatus label="None" tone="success" />}</div>
                  <AdminUserControls userId={profile.user_id} disabled={suspendedUsers.has(profile.user_id)} canQuickFix={access.permissions.has("admin.support.manage")} />
                </div>
              );
            })}
          </div>
        </Card>
      )}

      {totalPages > 1 ? (
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs text-muted-foreground">Page {Math.min(page, totalPages)} of {totalPages}</p>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" disabled={page <= 1} asChild={page > 1}>
              {page > 1 ? <Link href={usersHref({ search, filter, page: page - 1 })}>Previous</Link> : <span>Previous</span>}
            </Button>
            <Button variant="outline" size="sm" disabled={page >= totalPages} asChild={page < totalPages}>
              {page < totalPages ? <Link href={usersHref({ search, filter, page: page + 1 })}>Next</Link> : <span>Next</span>}
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function sanitizeSearch(value: string | undefined) {
  return value?.trim().replace(/[,%()]/g, "").slice(0, 60) ?? "";
}

function usersHref({ search, filter, page }: { search?: string; filter: UserFilter; page: number }): Route {
  const query = new URLSearchParams();
  if (search) query.set("q", search);
  if (filter !== "active") query.set("status", filter);
  if (page > 1) query.set("page", String(page));
  const value = query.toString();
  return (value ? `/admin/users?${value}` : "/admin/users") as Route;
}
