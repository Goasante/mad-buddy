import Link from "next/link";
import type { Route } from "next";
import { redirect } from "next/navigation";
import { AlertTriangle, ChevronLeft, ChevronRight, FileWarning, ShieldCheck, ShieldOff } from "lucide-react";
import { AdminEmptyState, AdminMetricCard, AdminPageHeader, AdminQueryError, AdminStatus, formatAdminDate, humanizeAdminValue } from "@/components/admin/admin-ui";
import { ReportCategoryBadge, ReportStatusBadge } from "@/components/admin/moderation/report-badges";
import { ReportFilterBar } from "@/components/admin/moderation/report-filter-bar";
import { Card } from "@/components/ui/card";
import { getAdminAccess } from "@/lib/admin/access";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getSafetyAdminContext } from "@/lib/safety/admin";
import { contentTypeLabel, type ReportKind } from "@/lib/admin/moderation";
import type { Database } from "@/lib/supabase/database.types";

type ContentCategory = NonNullable<Database["public"]["Tables"]["content_reports"]["Row"]["category"]>;
type ContentType = NonNullable<Database["public"]["Tables"]["content_reports"]["Row"]["content_type"]>;

const PAGE_SIZE = 20;

type ReportsPageProps = { searchParams: Promise<Record<string, string | undefined>> };

function sanitizeSearch(value: string | undefined) {
  return (value ?? "").replace(/[,()%]/g, " ").trim().slice(0, 80);
}

export default async function AdminReportsPage({ searchParams }: ReportsPageProps) {
  const params = await searchParams;
  const admin = createSupabaseAdminClient();
  const context = await getSafetyAdminContext();
  if (!context.ok) redirect("/admin/login");
  const access = await getAdminAccess(admin, context);
  if (!access.permissions.has("admin.reports.review")) redirect("/admin");

  const source: ReportKind = params.source === "content" ? "content" : "user";
  const status = params.status ?? "";
  const category = params.category ?? "";
  const type = params.type ?? "";
  const q = sanitizeSearch(params.q);
  const from = params.from ?? "";
  const to = params.to ?? "";
  const requestedPage = Number.parseInt(params.page ?? "1", 10);
  const page = Number.isFinite(requestedPage) && requestedPage > 0 ? requestedPage : 1;

  // Headline metrics (cheap head counts, independent of the current source).
  const [openUserReports, openContentReports, activeRestrictionsCount, blockedPairs] = await Promise.all([
    admin.from("reports").select("id", { count: "exact", head: true }).eq("status", "open"),
    admin.from("content_reports").select("id", { count: "exact", head: true }).in("status", ["received", "under_review"]),
    admin.from("user_restrictions").select("id", { count: "exact", head: true }).is("lifted_at", null),
    admin.from("blocked_users").select("id", { count: "exact", head: true })
  ]);

  // Resolve user matches for search (bounded) so search spans reports AND users.
  let matchedUserIds: string[] = [];
  if (q) {
    const { data: matched } = await admin
      .from("profiles")
      .select("user_id")
      .or(`full_name.ilike.%${q}%,username.ilike.%${q}%`)
      .limit(50);
    matchedUserIds = (matched ?? []).map((row) => row.user_id);
  }

  type Row = {
    id: string;
    reportedUserId: string | null;
    reportedLabel: string;
    reporterId: string | null;
    primary: string; // reason (user) or category (content)
    secondary: string | null; // description (user) or content type (content)
    category: string | null;
    status: string;
    createdAt: string;
  };

  let rows: Row[] = [];
  let total = 0;
  let queryError = false;

  if (source === "user") {
    let query = admin
      .from("reports")
      .select("id, reporter_id, reported_user_id, reported_user_label, reason, description, status, created_at", { count: "exact" });
    if (status) query = query.eq("status", status as "open" | "reviewing" | "resolved" | "dismissed");
    if (from) query = query.gte("created_at", from);
    if (to) query = query.lte("created_at", `${to}T23:59:59.999Z`);
    if (q) {
      const clauses = [`reported_user_label.ilike.%${q}%`, `reason.ilike.%${q}%`];
      if (matchedUserIds.length > 0) clauses.push(`reported_user_id.in.(${matchedUserIds.join(",")})`);
      query = query.or(clauses.join(","));
    }
    const result = await query.order("created_at", { ascending: false }).range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);
    queryError = Boolean(result.error);
    total = result.count ?? 0;
    rows = (result.data ?? []).map((report) => ({
      id: report.id,
      reportedUserId: report.reported_user_id,
      reportedLabel: report.reported_user_label,
      reporterId: report.reporter_id,
      primary: report.reason,
      secondary: report.description,
      category: null,
      status: report.status,
      createdAt: report.created_at
    }));
  } else {
    let query = admin
      .from("content_reports")
      .select("id, reporter_id, reported_user_id, content_type, content_id, category, status, created_at", { count: "exact" });
    if (status) query = query.eq("status", status as "received" | "under_review" | "actioned" | "dismissed");
    if (category) query = query.eq("category", category as ContentCategory);
    if (type) query = query.eq("content_type", type as ContentType);
    if (from) query = query.gte("created_at", from);
    if (to) query = query.lte("created_at", `${to}T23:59:59.999Z`);
    if (q) {
      // Content reports have no free-text label; search narrows to matched users.
      if (matchedUserIds.length > 0) query = query.in("reported_user_id", matchedUserIds);
      else query = query.eq("id", "00000000-0000-0000-0000-000000000000"); // no matches
    }
    const result = await query.order("created_at", { ascending: false }).range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);
    queryError = Boolean(result.error);
    total = result.count ?? 0;
    rows = (result.data ?? []).map((report) => ({
      id: report.id,
      reportedUserId: report.reported_user_id,
      reportedLabel: "",
      reporterId: report.reporter_id,
      primary: report.category,
      secondary: contentTypeLabel(report.content_type),
      category: report.category,
      status: report.status,
      createdAt: report.created_at
    }));
  }

  // Batched name resolution for reported/reporter accounts.
  const ids = [...new Set(rows.flatMap((row) => [row.reportedUserId, row.reporterId]).filter((id): id is string => Boolean(id)))];
  const nameById = new Map<string, string>();
  if (ids.length > 0) {
    const { data: profiles } = await admin.from("profiles").select("user_id, full_name, username").in("user_id", ids);
    for (const profile of profiles ?? []) nameById.set(profile.user_id, `${profile.full_name} (@${profile.username})`);
  }
  const reportedName = (row: Row) =>
    row.reportedUserId ? (nameById.get(row.reportedUserId) ?? row.reportedLabel) || "Account unavailable" : row.reportedLabel || "Deleted account";
  const reporterName = (row: Row) => (row.reporterId ? nameById.get(row.reporterId) ?? "Unknown reporter" : "Deleted reporter");

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const filters = { source, status, category, type, q, from, to };

  function pageHref(nextPage: number): Route {
    const sp = new URLSearchParams();
    for (const [key, value] of Object.entries({ ...params, page: String(nextPage) })) if (value) sp.set(key, value);
    return `/admin/reports?${sp.toString()}` as Route;
  }

  return (
    <div className="space-y-6">
      <AdminPageHeader
        title="Reports and moderation"
        description="Review reports, act with the least severe effective action, and keep a clear audit trail. Private content and exact location are never exposed."
        meta={<AdminStatus label={`${total} in view`} />}
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <AdminMetricCard icon={AlertTriangle} label="Open user reports" value={openUserReports.count ?? 0} tone={(openUserReports.count ?? 0) > 0 ? "danger" : "success"} />
        <AdminMetricCard icon={FileWarning} label="Open content reports" value={openContentReports.count ?? 0} tone={(openContentReports.count ?? 0) > 0 ? "warning" : "success"} />
        <AdminMetricCard icon={ShieldOff} label="Active restrictions" value={activeRestrictionsCount.count ?? 0} />
        <AdminMetricCard icon={ShieldCheck} label="Blocked pairs" value={blockedPairs.count ?? 0} />
      </div>

      <ReportFilterBar filters={filters} />

      {queryError ? <AdminQueryError message="Reports could not be loaded. Try again shortly." /> : null}

      {!queryError && rows.length === 0 ? (
        <AdminEmptyState icon={ShieldCheck} title="No reports match these filters" description="Adjust the filters or switch source to widen the queue." />
      ) : null}

      {rows.length > 0 ? (
        <>
          {/* Desktop table */}
          <div className="hidden overflow-x-auto rounded-2xl border border-border/60 lg:block">
            <table className="w-full text-sm">
              <thead className="border-b border-border/60 bg-secondary/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-4 py-2.5 font-medium">{source === "content" ? "Category" : "Reason"}</th>
                  <th className="px-4 py-2.5 font-medium">Reported account</th>
                  <th className="px-4 py-2.5 font-medium">Reporter</th>
                  <th className="px-4 py-2.5 font-medium">{source === "content" ? "Content" : "Detail"}</th>
                  <th className="px-4 py-2.5 font-medium">Status</th>
                  <th className="px-4 py-2.5 font-medium">Reported</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id} className="border-b border-border/40 last:border-0 hover:bg-secondary/20">
                    <td className="px-4 py-3">
                      <Link href={`/admin/reports/${source}/${row.id}` as Route} className="focus-ring font-medium text-foreground hover:text-primary">
                        {source === "content" ? <ReportCategoryBadge category={row.primary} /> : humanizeAdminValue(row.primary)}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">{reportedName(row)}</td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">{reporterName(row)}</td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">
                      {source === "content" ? row.secondary : row.secondary ? <span className="line-clamp-1 max-w-xs">{row.secondary}</span> : "—"}
                    </td>
                    <td className="px-4 py-3"><ReportStatusBadge kind={source} status={row.status} /></td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">{formatAdminDate(row.createdAt, true)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile cards */}
          <div className="grid gap-2 lg:hidden">
            {rows.map((row) => (
              <Link key={row.id} href={`/admin/reports/${source}/${row.id}` as Route} className="focus-ring block rounded-2xl">
                <Card className="p-3.5">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      {source === "content" ? <ReportCategoryBadge category={row.primary} /> : <p className="text-sm font-semibold">{humanizeAdminValue(row.primary)}</p>}
                      <p className="mt-1.5 truncate text-xs text-muted-foreground">Against {reportedName(row)}</p>
                    </div>
                    <ReportStatusBadge kind={source} status={row.status} />
                  </div>
                  <p className="mt-2 text-xs text-muted-foreground">
                    {source === "content" ? row.secondary : "Reporter"}: {reporterName(row)} · {formatAdminDate(row.createdAt)}
                  </p>
                </Card>
              </Link>
            ))}
          </div>

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
