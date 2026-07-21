import Link from "next/link";
import type { Route } from "next";
import { CircleDollarSign, CreditCard, ChevronLeft, ChevronRight, UserRoundCheck, WalletCards } from "lucide-react";
import { AdminEmptyState, AdminMetricCard, AdminPageHeader, AdminQueryError, AdminSection, formatAdminDate } from "@/components/admin/admin-ui";
import { PlanBadge, SubscriptionStatusBadge } from "@/components/admin/billing/billing-badges";
import { BillingFilterBar } from "@/components/admin/billing/billing-filter-bar";
import { Card } from "@/components/ui/card";
import { requireAdminPagePermission } from "@/lib/admin/access";
import { isSubscriptionPlan, isSubscriptionStatus } from "@/lib/admin/billing-admin";
import type { SubscriptionPlan, SubscriptionStatus } from "@/lib/supabase/database.types";

const PAGE_SIZE = 25;
type BillingPageProps = { searchParams: Promise<Record<string, string | undefined>> };

function sanitizeSearch(value: string | undefined) {
  return (value ?? "").replace(/[,()%]/g, " ").trim().slice(0, 80);
}

export default async function AdminBillingPage({ searchParams }: BillingPageProps) {
  const params = await searchParams;
  const { admin } = await requireAdminPagePermission("admin.billing.view");

  const plan = params.plan && isSubscriptionPlan(params.plan) ? params.plan : "";
  const status = params.status && isSubscriptionStatus(params.status) ? params.status : "";
  const q = sanitizeSearch(params.q);
  const requestedPage = Number.parseInt(params.page ?? "1", 10);
  const page = Number.isFinite(requestedPage) && requestedPage > 0 ? requestedPage : 1;

  const [activePremium, plusCount, proCount, pastDue] = await Promise.all([
    admin.from("subscriptions").select("id", { count: "exact", head: true }).in("status", ["active", "trialing"]).neq("plan", "free"),
    admin.from("subscriptions").select("id", { count: "exact", head: true }).eq("plan", "buddy_plus").in("status", ["active", "trialing"]),
    admin.from("subscriptions").select("id", { count: "exact", head: true }).eq("plan", "buddy_pro").in("status", ["active", "trialing"]),
    admin.from("subscriptions").select("id", { count: "exact", head: true }).in("status", ["past_due", "attention"])
  ]);

  let matchedIds: string[] = [];
  if (q) {
    const { data } = await admin.from("profiles").select("user_id").or(`full_name.ilike.%${q}%,username.ilike.%${q}%`).limit(50);
    matchedIds = (data ?? []).map((row) => row.user_id);
  }

  let query = admin
    .from("subscriptions")
    .select("user_id, plan, status, provider, current_period_end, cancel_at_period_end, updated_at", { count: "exact" });
  if (plan) query = query.eq("plan", plan as SubscriptionPlan);
  if (status) query = query.eq("status", status as SubscriptionStatus);
  if (q) {
    if (matchedIds.length > 0) query = query.in("user_id", matchedIds);
    else query = query.eq("user_id", "00000000-0000-0000-0000-000000000000");
  }
  const result = await query.order("updated_at", { ascending: false }).range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);
  const rows = result.data ?? [];
  const total = result.count ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const ids = rows.map((row) => row.user_id).filter((id): id is string => Boolean(id));
  const nameById = new Map<string, string>();
  if (ids.length > 0) {
    const { data: profiles } = await admin.from("profiles").select("user_id, full_name, username").in("user_id", ids);
    for (const profile of profiles ?? []) nameById.set(profile.user_id, `${profile.full_name} (@${profile.username})`);
  }

  function pageHref(nextPage: number): Route {
    const sp = new URLSearchParams();
    for (const [key, value] of Object.entries({ ...params, page: String(nextPage) })) if (value) sp.set(key, value);
    return `/admin/billing?${sp.toString()}` as Route;
  }

  return (
    <div className="space-y-6">
      <AdminPageHeader
        title="Subscriptions & billing"
        description="Verify subscription state against Paystack and manage entitlements. Payment credentials and raw transactions are never exposed."
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <AdminMetricCard icon={UserRoundCheck} label="Active premium" value={activePremium.count ?? 0} tone="success" />
        <AdminMetricCard icon={WalletCards} label="Buddy Plus" value={plusCount.count ?? 0} tone="orange" />
        <AdminMetricCard icon={CircleDollarSign} label="Buddy Pro" value={proCount.count ?? 0} tone="orange" />
        <AdminMetricCard icon={CreditCard} label="Needs attention" value={pastDue.count ?? 0} tone={(pastDue.count ?? 0) > 0 ? "warning" : "success"} />
      </div>

      <BillingFilterBar filters={{ plan, status, q }} />

      <AdminSection title="Subscriptions" description="Server-verified plan and lifecycle state. Open an account to reconcile or manage entitlements.">
        {result.error ? <AdminQueryError /> : null}
        {!result.error && rows.length === 0 ? <AdminEmptyState icon={CreditCard} title="No subscriptions match" description="Adjust the filters or search to widen results." /> : null}

        {rows.length > 0 ? (
          <>
            <Card className="hidden overflow-x-auto p-0 lg:block">
              <table className="w-full text-left text-sm">
                <thead className="border-b border-border/70 text-xs text-muted-foreground">
                  <tr>
                    <th className="px-4 py-3 font-medium">Account</th>
                    <th className="px-4 py-3 font-medium">Plan</th>
                    <th className="px-4 py-3 font-medium">Status</th>
                    <th className="px-4 py-3 font-medium">Renews / ends</th>
                    <th className="px-4 py-3 font-medium">Updated</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/70">
                  {rows.map((row) => (
                    <tr key={row.user_id} className="hover:bg-secondary/20">
                      <td className="max-w-64 truncate px-4 py-3.5 font-medium">
                        <Link href={`/admin/billing/${row.user_id}` as Route} className="focus-ring hover:text-primary">
                          {nameById.get(row.user_id ?? "") ?? "Account unavailable"}
                        </Link>
                      </td>
                      <td className="px-4 py-3.5"><PlanBadge plan={row.plan} /></td>
                      <td className="px-4 py-3.5"><SubscriptionStatusBadge status={row.status} /></td>
                      <td className="px-4 py-3.5 text-muted-foreground">
                        {formatAdminDate(row.current_period_end)}{row.cancel_at_period_end ? " · cancels" : ""}
                      </td>
                      <td className="px-4 py-3.5 text-muted-foreground">{formatAdminDate(row.updated_at, true)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>

            <div className="grid gap-2 lg:hidden">
              {rows.map((row) => (
                <Link key={row.user_id} href={`/admin/billing/${row.user_id}` as Route} className="focus-ring block rounded-2xl">
                  <Card className="p-3.5">
                    <div className="flex items-start justify-between gap-2">
                      <p className="min-w-0 flex-1 truncate text-sm font-semibold">{nameById.get(row.user_id ?? "") ?? "Account unavailable"}</p>
                      <PlanBadge plan={row.plan} />
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-1.5">
                      <SubscriptionStatusBadge status={row.status} />
                      <span className="text-xs text-muted-foreground">{formatAdminDate(row.current_period_end)}</span>
                    </div>
                  </Card>
                </Link>
              ))}
            </div>

            {totalPages > 1 ? (
              <nav className="flex items-center justify-between gap-3 pt-1" aria-label="Pagination">
                <p className="text-xs text-muted-foreground">Page {page} of {totalPages}</p>
                <div className="flex gap-2">
                  {page > 1 ? <Link href={pageHref(page - 1)} className="focus-ring inline-flex items-center gap-1 rounded-lg border border-border/70 px-3 py-2 text-sm hover:bg-secondary/40"><ChevronLeft className="h-4 w-4" aria-hidden="true" /> Previous</Link> : null}
                  {page < totalPages ? <Link href={pageHref(page + 1)} className="focus-ring inline-flex items-center gap-1 rounded-lg border border-border/70 px-3 py-2 text-sm hover:bg-secondary/40">Next <ChevronRight className="h-4 w-4" aria-hidden="true" /></Link> : null}
                </div>
              </nav>
            ) : null}
          </>
        ) : null}
      </AdminSection>
    </div>
  );
}
