import Link from "next/link";
import type { Route } from "next";
import { Suspense } from "react";
import { Activity, ArrowRight, CreditCard, Headphones, ShieldAlert, UsersRound } from "lucide-react";
import {
  AdminEmptyState,
  AdminMetricCard,
  AdminPageHeader,
  AdminQueryError,
  AdminSection,
  AdminStatus,
  formatAdminDate,
  humanizeAdminValue
} from "@/components/admin/admin-ui";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { BarList } from "@/components/admin/overview/bar-list";
import { TrendChart } from "@/components/admin/overview/trend-chart";
import { getReadinessReport } from "@/lib/health/readiness";
import { bucketTotal, bucketsFromDailyCounts, planMixFromCounts } from "@/lib/admin/overview";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

const PLAN_COLORS: Record<string, string> = {
  free: "#77736f",
  buddy_plus: "#E88C2B",
  buddy_pro: "#b85f27"
};

export default function AdminOverviewPage() {
  return (
    <div className="space-y-8">
      <AdminPageHeader
        title="Command center"
        description="See what needs attention across accounts, safety, support, access, privacy, and platform health — without digging through every tool first."
      />
      <Suspense fallback={<AdminOverviewSkeleton />}>
        <AdminOverviewData />
      </Suspense>
    </div>
  );
}

async function AdminOverviewData() {
  const admin = createSupabaseAdminClient();
  const since = new Date(new Date().getTime() - 14 * 24 * 60 * 60 * 1000).toISOString();
  const [
    readiness,
    usersResult,
    reportsResult,
    premiumResult,
    supportResult,
    privacyResult,
    pendingRequestsResult,
    controlsResult,
    auditResult,
    signupsResult,
    planMixResult
  ] = await Promise.all([
    getReadinessReport(),
    admin.from("profiles").select("id", { count: "exact", head: true }).is("deleted_at", null),
    admin.from("reports").select("id", { count: "exact", head: true }).in("status", ["open", "reviewing"]),
    admin.from("subscriptions").select("id", { count: "exact", head: true }).in("status", ["trialing", "active"]),
    admin.from("support_tickets").select("id", { count: "exact", head: true }).not("status", "in", "(resolved,closed)"),
    admin.from("privacy_requests").select("id", { count: "exact", head: true }).not("status", "in", "(completed,rejected)"),
    admin.from("friend_requests").select("id", { count: "exact", head: true }).eq("status", "pending"),
    admin.from("emergency_controls").select("control_key, is_disabled").order("control_key"),
    admin.from("admin_audit_events").select("id, action, target_type, created_at").order("created_at", { ascending: false }).limit(6),
    admin.rpc("admin_daily_signup_counts", { p_since: since }),
    admin.rpc("admin_active_plan_mix")
  ]);

  const disabledControls = (controlsResult.data ?? []).filter((control) => control.is_disabled);
  const signupBuckets = bucketsFromDailyCounts(signupsResult.data ?? [], 14);
  const signupTotal = bucketTotal(signupBuckets);
  const planRows = planMixFromCounts(planMixResult.data ?? []).map((row) => ({
    label: row.label,
    value: row.count,
    color: PLAN_COLORS[row.plan] ?? "#E88C2B"
  }));
  const hasQueryError = [usersResult, reportsResult, premiumResult, supportResult, privacyResult].some((result) => result.error);
  const openWork = (reportsResult.count ?? 0) + (supportResult.count ?? 0) + (privacyResult.count ?? 0);

  return (
    <>
      <section className="grid gap-3 lg:grid-cols-[1.35fr_0.8fr_0.8fr]">
        <Card className="relative overflow-hidden rounded-[24px] border-white/[0.08] bg-[linear-gradient(135deg,rgba(232,140,43,0.09),rgba(255,255,255,0.025))] p-5 shadow-[0_18px_50px_rgba(0,0,0,0.14)]">
          <span aria-hidden="true" className="pointer-events-none absolute -right-16 -top-20 h-44 w-44 rounded-full bg-[#E88C2B]/10 blur-3xl" />
          <div className="relative flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.17em] text-[#d99b63]">Operational pulse</p>
              <p className="mt-2 text-xl font-semibold tracking-[-0.025em] text-white">
                {readiness.ok ? "Platform is ready" : "Platform needs attention"}
              </p>
              <p className="mt-1.5 max-w-lg text-xs leading-5 text-[#98938d]">
                Readiness checks and emergency controls are summarized here so urgent platform state is visible immediately.
              </p>
            </div>
            <AdminStatus label={readiness.ok ? "Systems ready" : "Review required"} tone={readiness.ok ? "success" : "warning"} />
          </div>
          <div className="relative mt-4 flex flex-wrap gap-2 border-t border-white/[0.07] pt-4">
            <span className="rounded-full border border-white/[0.08] bg-black/10 px-3 py-1.5 text-xs text-[#aaa59f]">
              <strong className="mr-1.5 font-semibold text-white">{disabledControls.length}</strong>
              disabled controls
            </span>
            <span className="rounded-full border border-white/[0.08] bg-black/10 px-3 py-1.5 text-xs text-[#aaa59f]">
              <strong className="mr-1.5 font-semibold text-white">{openWork}</strong>
              open work items
            </span>
          </div>
        </Card>

        <Card className="rounded-[24px] border-white/[0.08] bg-white/[0.025] p-5 shadow-[0_16px_45px_rgba(0,0,0,0.12)]">
          <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[#89847e]">14-day growth</p>
          <p className="mt-3 text-3xl font-semibold tabular-nums tracking-[-0.04em] text-white">{signupTotal}</p>
          <p className="mt-1.5 text-xs leading-5 text-[#89847e]">New accounts across the last two weeks.</p>
        </Card>

        <Card className="rounded-[24px] border-white/[0.08] bg-white/[0.025] p-5 shadow-[0_16px_45px_rgba(0,0,0,0.12)]">
          <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[#89847e]">Pending connections</p>
          <p className="mt-3 text-3xl font-semibold tabular-nums tracking-[-0.04em] text-white">{pendingRequestsResult.count ?? 0}</p>
          <p className="mt-1.5 text-xs leading-5 text-[#89847e]">Friend requests currently in progress.</p>
        </Card>
      </section>

      {hasQueryError ? <AdminQueryError message="Some overview metrics could not be loaded. Available data is still shown." /> : null}

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <AdminMetricCard icon={UsersRound} label="Total users" value={usersResult.count ?? 0} hint="Non-deleted profiles" href="/admin/users" />
        <AdminMetricCard icon={ShieldAlert} label="Safety queue" value={reportsResult.count ?? 0} hint="Open and reviewing reports" tone={(reportsResult.count ?? 0) > 0 ? "danger" : "success"} href="/admin/reports" />
        <AdminMetricCard icon={Headphones} label="Support queue" value={supportResult.count ?? 0} hint="Tickets awaiting resolution" tone={(supportResult.count ?? 0) > 0 ? "warning" : "success"} href="/admin/support" />
        <AdminMetricCard icon={CreditCard} label="Paid access" value={premiumResult.count ?? 0} hint="Active or trialing subscriptions" tone="orange" href="/admin/billing" />
      </section>

      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1.6fr)_minmax(300px,0.9fr)]">
        <AdminSection title="New accounts" description="Sign-ups per day over the last 14 days. Counts only.">
          <Card className="rounded-[24px] border-white/[0.08] bg-white/[0.025] p-5 shadow-[0_16px_45px_rgba(0,0,0,0.12)]">
            <div className="mb-3 flex items-baseline gap-2">
              <span className="text-2xl font-semibold tabular-nums tracking-[-0.03em] text-white">{signupTotal}</span>
              <span className="text-xs text-[#89847e]">in the last 14 days</span>
            </div>
            {signupsResult.error ? (
              <AdminQueryError message="The sign-up trend could not be loaded." />
            ) : (
              <TrendChart points={signupBuckets.map((bucket) => ({ label: bucket.label, value: bucket.count }))} unitLabel="sign-ups" ariaLabel="New accounts per day over the last 14 days" />
            )}
          </Card>
        </AdminSection>

        <AdminSection title="Access mix" description="Active and trialing subscriptions by plan.">
          <Card className="rounded-[24px] border-white/[0.08] bg-white/[0.025] p-5 shadow-[0_16px_45px_rgba(0,0,0,0.12)]">
            {planMixResult.error ? (
              <AdminQueryError message="The access mix could not be loaded." />
            ) : planRows.every((row) => row.value === 0) ? (
              <AdminEmptyState icon={CreditCard} title="No paid access yet" description="Active subscriptions will appear here." />
            ) : (
              <BarList rows={planRows} unitLabel="accounts" />
            )}
          </Card>
        </AdminSection>
      </div>

      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1.35fr)_minmax(320px,0.65fr)]">
        <AdminSection title="Operations queues" description="Current work that may require staff attention.">
          <Card className="divide-y divide-white/[0.07] overflow-hidden rounded-[24px] border-white/[0.08] bg-white/[0.025] p-0 shadow-[0_16px_45px_rgba(0,0,0,0.12)]">
            <QueueRow label="Friend requests in progress" value={pendingRequestsResult.count ?? 0} href="/admin/users" />
            <QueueRow label="Privacy requests" value={privacyResult.count ?? 0} href="/admin/privacy" />
            <QueueRow label="Support tickets" value={supportResult.count ?? 0} href="/admin/support" />
            <QueueRow label="Safety reports" value={reportsResult.count ?? 0} href="/admin/reports" />
          </Card>
        </AdminSection>

        <AdminSection
          title="Platform readiness"
          description="Environment checks and emergency-control state."
          action={
            <Button variant="ghost" size="sm" className="text-[#aaa59f] hover:bg-white/[0.05] hover:text-white" asChild>
              <Link href="/admin/system">Open system <ArrowRight className="h-4 w-4" aria-hidden="true" /></Link>
            </Button>
          }
        >
          <Card className="space-y-4 rounded-[24px] border-white/[0.08] bg-white/[0.025] p-5 shadow-[0_16px_45px_rgba(0,0,0,0.12)]">
            <div className="flex items-center justify-between gap-3">
              <span className="text-sm text-[#aaa59f]">Readiness checks</span>
              <AdminStatus label={readiness.ok ? "Passing" : "Review"} tone={readiness.ok ? "success" : "warning"} />
            </div>
            <div className="flex items-center justify-between gap-3 border-t border-white/[0.07] pt-4">
              <span className="text-sm text-[#aaa59f]">Disabled controls</span>
              <span className="text-sm font-semibold tabular-nums text-white">{disabledControls.length}</span>
            </div>
            {disabledControls.length > 0 ? (
              <div className="flex flex-wrap gap-2 border-t border-white/[0.07] pt-4">
                {disabledControls.map((control) => (
                  <AdminStatus key={control.control_key} label={humanizeAdminValue(control.control_key)} tone="danger" />
                ))}
              </div>
            ) : null}
          </Card>
        </AdminSection>
      </div>

      <AdminSection
        title="Recent admin activity"
        description="Append-only operational actions. Private content is not shown."
        action={
          <Button variant="ghost" size="sm" className="text-[#aaa59f] hover:bg-white/[0.05] hover:text-white" asChild>
            <Link href="/admin/audit">View audit log <ArrowRight className="h-4 w-4" aria-hidden="true" /></Link>
          </Button>
        }
      >
        {auditResult.error ? <AdminQueryError /> : null}
        {!auditResult.error && (auditResult.data ?? []).length === 0 ? (
          <AdminEmptyState icon={Activity} title="No admin activity yet" description="Audited staff actions will appear here." />
        ) : (
          <Card className="divide-y divide-white/[0.07] overflow-hidden rounded-[24px] border-white/[0.08] bg-white/[0.025] p-0 shadow-[0_16px_45px_rgba(0,0,0,0.12)]">
            {(auditResult.data ?? []).map((event) => (
              <div key={event.id} className="flex items-center justify-between gap-4 px-5 py-4 transition-colors hover:bg-white/[0.025]">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-[#eeeae5]">{humanizeAdminValue(event.action)}</p>
                  <p className="mt-1 text-xs text-[#89847e]">{event.target_type ? humanizeAdminValue(event.target_type) : "Platform"}</p>
                </div>
                <time className="shrink-0 text-xs text-[#77736f]">{formatAdminDate(event.created_at, true)}</time>
              </div>
            ))}
          </Card>
        )}
      </AdminSection>
    </>
  );
}

function QueueRow({ label, value, href }: { label: string; value: number; href: "/admin/users" | "/admin/privacy" | "/admin/support" | "/admin/reports" }) {
  return (
    <Link href={href as Route} className="focus-ring safe-motion group flex items-center justify-between gap-4 px-5 py-4 hover:bg-white/[0.03]">
      <span className="text-sm text-[#aaa59f] group-hover:text-[#ded9d3]">{label}</span>
      <span className="flex items-center gap-3 text-sm font-semibold tabular-nums text-white">
        {value}
        <ArrowRight className="h-4 w-4 text-[#6f6b66] transition-transform group-hover:translate-x-0.5 group-hover:text-[#E88C2B]" aria-hidden="true" />
      </span>
    </Link>
  );
}

function AdminOverviewSkeleton() {
  return (
    <div className="animate-pulse space-y-8" aria-hidden="true">
      <section className="grid gap-3 lg:grid-cols-[1.35fr_0.8fr_0.8fr]">
        <div className="h-44 rounded-[24px] bg-white/[0.035]" />
        <div className="h-44 rounded-[24px] bg-white/[0.035]" />
        <div className="h-44 rounded-[24px] bg-white/[0.035]" />
      </section>
      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, index) => (
          <div key={index} className="h-32 rounded-[24px] bg-white/[0.035]" />
        ))}
      </section>
      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1.6fr)_minmax(300px,0.9fr)]">
        <div className="h-72 rounded-[24px] bg-white/[0.035]" />
        <div className="h-72 rounded-[24px] bg-white/[0.035]" />
      </div>
      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1.35fr)_minmax(320px,0.65fr)]">
        <div className="h-52 rounded-[24px] bg-white/[0.035]" />
        <div className="h-52 rounded-[24px] bg-white/[0.035]" />
      </div>
      <div className="h-60 rounded-[24px] bg-white/[0.035]" />
    </div>
  );
}
