import Link from "next/link";
import type { Route } from "next";
import { redirect } from "next/navigation";
import { ChevronLeft, ChevronRight, LifeBuoy } from "lucide-react";
import { AdminEmptyState, AdminPageHeader, AdminQueryError, AdminStatus, formatAdminDate } from "@/components/admin/admin-ui";
import { IssueStatusBadge, IssuePriorityBadge } from "@/components/admin/support/issue-badges";
import { IssueFilterBar } from "@/components/admin/support/issue-filter-bar";
import { Card } from "@/components/ui/card";
import { UserAvatar } from "@/components/ui/user-avatar";
import { getAdminAccess } from "@/lib/admin/access";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getSafetyAdminContext } from "@/lib/safety/admin";
import {
  categoryLabel,
  isStatusFilterKey,
  STATUS_FILTER_GROUPS,
  SUPPORT_PRIORITIES,
  type SupportPriority
} from "@/lib/admin/support";

const PAGE_SIZE = 20;
const PLATFORMS = ["ios", "android", "web"];

type SupportPageProps = {
  searchParams: Promise<Record<string, string | undefined>>;
};

// Keep search terms safe for a PostgREST .or() filter (commas and parentheses
// are delimiters there).
function sanitizeSearch(value: string | undefined) {
  return (value ?? "").replace(/[,()%]/g, " ").trim().slice(0, 80);
}

export default async function SupportIssuesPage({ searchParams }: SupportPageProps) {
  const params = await searchParams;
  const admin = createSupabaseAdminClient();
  const context = await getSafetyAdminContext();
  if (!context.ok) redirect("/admin/login");
  const access = await getAdminAccess(admin, context);
  if (!access.permissions.has("admin.support.manage")) redirect("/admin");

  const statusKey = params.status && isStatusFilterKey(params.status) ? params.status : "all";
  const q = sanitizeSearch(params.q);
  const category = params.category ?? "";
  const priority = SUPPORT_PRIORITIES.includes(params.priority as SupportPriority) ? (params.priority as string) : "";
  const assignee = params.assignee ?? "";
  const platform = PLATFORMS.includes(params.platform ?? "") ? (params.platform as string) : "";
  const from = params.from ?? "";
  const to = params.to ?? "";
  const requestedPage = Number.parseInt(params.page ?? "1", 10);
  const page = Number.isFinite(requestedPage) && requestedPage > 0 ? requestedPage : 1;

  // Load the active staff roster once — powers both the assignee filter and the
  // display of the assigned team member.
  const { data: staffRows } = await admin
    .from("admin_users")
    .select("auth_user_id, role, disabled_at")
    .is("disabled_at", null)
    .in("role", ["owner", "admin", "support"]);
  const staffIds = (staffRows ?? []).map((row) => row.auth_user_id).filter((id): id is string => Boolean(id));

  // Build the bounded, server-side filtered query.
  let query = admin
    .from("support_tickets")
    .select("id, user_id, subject, category, priority, status, assigned_to, created_at, updated_at, diagnostics", {
      count: "exact"
    });

  query = query.in("status", STATUS_FILTER_GROUPS[statusKey] as unknown as string[]);
  if (category) query = query.eq("category", category);
  if (priority) query = query.eq("priority", priority as SupportPriority);
  if (platform) query = query.eq("diagnostics->>platform", platform);
  if (assignee === "unassigned") query = query.is("assigned_to", null);
  else if (assignee) query = query.eq("assigned_to", assignee);
  if (from) query = query.gte("created_at", from);
  if (to) query = query.lte("created_at", `${to}T23:59:59.999Z`);

  if (q) {
    // Resolve users matching the term (bounded) so search spans issues AND users
    // without ever pulling the whole table into the browser.
    const { data: matchedUsers } = await admin
      .from("profiles")
      .select("user_id")
      .or(`full_name.ilike.%${q}%,username.ilike.%${q}%`)
      .limit(50);
    const ids = (matchedUsers ?? []).map((row) => row.user_id);
    const clauses = [`subject.ilike.%${q}%`, `description.ilike.%${q}%`];
    if (ids.length > 0) clauses.push(`user_id.in.(${ids.join(",")})`);
    query = query.or(clauses.join(","));
  }

  const sort = params.sort === "updated" ? "updated_at" : "created_at";
  const result = await query.order(sort, { ascending: false }).range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);
  const tickets = result.data ?? [];
  const total = result.count ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  // Enrich with display names/avatars (users + assignees) in one batched read.
  const relatedIds = [
    ...new Set([
      ...tickets.map((ticket) => ticket.user_id).filter((id): id is string => Boolean(id)),
      ...tickets.map((ticket) => ticket.assigned_to).filter((id): id is string => Boolean(id)),
      ...staffIds
    ])
  ];
  const profileById = new Map<string, { full_name: string; username: string; avatar_url: string | null }>();
  if (relatedIds.length > 0) {
    const { data: profiles } = await admin
      .from("profiles")
      .select("user_id, full_name, username, avatar_url")
      .in("user_id", relatedIds);
    for (const profile of profiles ?? []) profileById.set(profile.user_id, profile);
  }
  const nameFor = (id: string | null) => (id ? profileById.get(id)?.full_name ?? "Account unavailable" : "—");

  const assignees = staffIds
    .map((id) => ({ id, name: profileById.get(id)?.full_name ?? "Staff member" }))
    .sort((a, b) => a.name.localeCompare(b.name));

  const filters = { statusKey: params.status && isStatusFilterKey(params.status) ? params.status : "", q, category, priority, assignee, platform, from, to };

  function pageHref(nextPage: number): Route {
    const sp = new URLSearchParams();
    for (const [key, value] of Object.entries({ ...params, page: String(nextPage) })) {
      if (value) sp.set(key, value);
    }
    return `/admin/support?${sp.toString()}` as Route;
  }

  return (
    <div className="space-y-6">
      <AdminPageHeader
        title="Support and issues"
        description="Investigate user problems, respond clearly, and track resolution."
        meta={<AdminStatus label={`${total} ${total === 1 ? "issue" : "issues"}`} />}
      />

      <IssueFilterBar filters={filters} assignees={assignees} platforms={PLATFORMS} />

      {result.error ? <AdminQueryError message="Issues could not be loaded. Try again shortly." /> : null}

      {!result.error && tickets.length === 0 ? (
        <AdminEmptyState
          icon={LifeBuoy}
          title="No issues match these filters"
          description="Adjust the filters or search to widen the queue."
        />
      ) : null}

      {tickets.length > 0 ? (
        <>
          {/* Desktop table */}
          <div className="hidden overflow-x-auto rounded-2xl border border-border/60 lg:block">
            <table className="w-full text-sm">
              <thead className="border-b border-border/60 bg-secondary/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-4 py-2.5 font-medium">Issue</th>
                  <th className="px-4 py-2.5 font-medium">User</th>
                  <th className="px-4 py-2.5 font-medium">Category</th>
                  <th className="px-4 py-2.5 font-medium">Priority</th>
                  <th className="px-4 py-2.5 font-medium">Status</th>
                  <th className="px-4 py-2.5 font-medium">Assigned</th>
                  <th className="px-4 py-2.5 font-medium">Created</th>
                  <th className="px-4 py-2.5 font-medium">Updated</th>
                </tr>
              </thead>
              <tbody>
                {tickets.map((ticket) => (
                  <tr key={ticket.id} className="border-b border-border/40 last:border-0 hover:bg-secondary/20">
                    <td className="px-4 py-3">
                      <Link href={`/admin/support/${ticket.id}` as Route} className="focus-ring block max-w-xs truncate font-medium text-foreground hover:text-primary">
                        {ticket.subject}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">{nameFor(ticket.user_id)}</td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">{categoryLabel(ticket.category)}</td>
                    <td className="px-4 py-3"><IssuePriorityBadge priority={ticket.priority} /></td>
                    <td className="px-4 py-3"><IssueStatusBadge status={ticket.status} /></td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">{ticket.assigned_to ? nameFor(ticket.assigned_to) : "Unassigned"}</td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">{formatAdminDate(ticket.created_at)}</td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">{formatAdminDate(ticket.updated_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile cards */}
          <div className="grid gap-2 lg:hidden">
            {tickets.map((ticket) => (
              <Link key={ticket.id} href={`/admin/support/${ticket.id}` as Route} className="focus-ring block rounded-2xl">
                <Card className="p-3.5">
                  <div className="flex items-start justify-between gap-2">
                    <p className="min-w-0 flex-1 truncate text-sm font-semibold">{ticket.subject}</p>
                    <IssuePriorityBadge priority={ticket.priority} />
                  </div>
                  <div className="mt-2 flex items-center gap-2">
                    <UserAvatar src={profileById.get(ticket.user_id ?? "")?.avatar_url ?? null} name={nameFor(ticket.user_id)} size="xs" />
                    <span className="truncate text-xs text-muted-foreground">{nameFor(ticket.user_id)}</span>
                  </div>
                  <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
                    <IssueStatusBadge status={ticket.status} />
                    <span className="text-xs text-muted-foreground">{categoryLabel(ticket.category)}</span>
                  </div>
                  <p className="mt-2 text-xs text-muted-foreground">
                    {ticket.assigned_to ? `Assigned to ${nameFor(ticket.assigned_to)}` : "Unassigned"} · {formatAdminDate(ticket.created_at)}
                  </p>
                </Card>
              </Link>
            ))}
          </div>

          {/* Pagination */}
          {totalPages > 1 ? (
            <nav className="flex items-center justify-between gap-3 pt-1" aria-label="Pagination">
              <p className="text-xs text-muted-foreground">Page {page} of {totalPages}</p>
              <div className="flex gap-2">
                {page > 1 ? (
                  <Link href={pageHref(page - 1)} className="focus-ring inline-flex items-center gap-1 rounded-lg border border-border/70 px-3 py-2 text-sm hover:bg-secondary/40">
                    <ChevronLeft className="h-4 w-4" aria-hidden="true" /> Previous
                  </Link>
                ) : null}
                {page < totalPages ? (
                  <Link href={pageHref(page + 1)} className="focus-ring inline-flex items-center gap-1 rounded-lg border border-border/70 px-3 py-2 text-sm hover:bg-secondary/40">
                    Next <ChevronRight className="h-4 w-4" aria-hidden="true" />
                  </Link>
                ) : null}
              </div>
            </nav>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
