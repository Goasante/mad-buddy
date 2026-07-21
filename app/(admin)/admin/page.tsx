import Link from "next/link";
import type { Route } from "next";
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
import { bucketDailyCounts, bucketTotal, planMix } from "@/lib/admin/overview";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

// Validated reference palette — ordinal blue ramp for the plan tiers (dark surface).
const PLAN_COLORS: Record<string, string> = {
  free: "#86b6ef",
  buddy_plus: "#3987e5",
  buddy_pro: "#184f95"
};

export default async function AdminOverviewPage() {
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
    // Safe aggregates only — timestamps and plan labels, no identifiers.
    admin.from("profiles").select("created_at").is("deleted_at", null).gte("created_at", since).limit(10000),
    admin.from("subscriptions").select("plan").in("status", ["active", "trialing"]).neq("plan", "free").limit(10000)
  ]);

  const disabledControls = (controlsResult.data ?? []).filter((control) => control.is_disabled);
  const signupBuckets = bucketDailyCounts((signupsResult.data ?? []).map((row) => row.created_at), 14);
  const signupTotal = bucketTotal(signupBuckets);
  const planRows = planMix((planMixResult.data ?? []).map((row) => row.plan)).map((row) => ({
    label: row.label,
    value: row.count,
    color: PLAN_COLORS[row.plan] ?? "#3987e5"
  }));
  const hasQueryError = [usersResult, reportsResult, premiumResult, supportResult, privacyResult].some((result) => result.error);

  return (
    <div className="space-y-7">
      <AdminPageHeader
        title="Overview"
        description="A live operational summary of accounts, safety, support, billing, privacy, and platform readiness."
        meta={<AdminStatus label={readiness.ok ? "Systems ready" : "Needs attention"} tone={readiness.ok ? "success" : "warning"} />}
      />

      {hasQueryError ? <AdminQueryError message="Some overview metrics could not be loaded. Available data is still shown." /> : null}

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <AdminMetricCard icon={UsersRound} label="Total users" value={usersResult.count ?? 0} hint="Non-deleted profiles" href="/admin/users" />
        <AdminMetricCard icon={ShieldAlert} label="Safety queue" value={reportsResult.count ?? 0} hint="Open and reviewing reports" tone={(reportsResult.count ?? 0) > 0 ? "danger" : "success"} href="/admin/reports" />
        <AdminMetricCard icon={Headphones} label="Support queue" value={supportResult.count ?? 0} hint="Tickets awaiting resolution" tone={(supportResult.count ?? 0) > 0 ? "warning" : "success"} href="/admin/support" />
        <AdminMetricCard icon={CreditCard} label="Premium accounts" value={premiumResult.count ?? 0} hint="Active or trialing" tone="orange" href="/admin/billing" />
      </section>

      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1.6fr)_minmax(300px,0.9fr)]">
        <AdminSection title="New accounts" description="Sign-ups per day over the last 14 days. Counts only.">
          <Card className="p-4">
            <div className="mb-2 flex items-baseline gap-2">
              <span className="text-2xl font-semibold tabular-nums">{signupTotal}</span>
              <span className="text-xs text-muted-foreground">in the last 14 days</span>
            </div>
            {signupsResult.error ? (
              <AdminQueryError message="The sign-up trend could not be loaded." />
            ) : (
              <TrendChart points={signupBuckets.map((bucket) => ({ label: bucket.label, value: bucket.count }))} unitLabel="sign-ups" ariaLabel="New accounts per day over the last 14 days" />
            )}
          </Card>
        </AdminSection>

        <AdminSection title="Premium plan mix" description="Active and trialing paid subscriptions.">
          <Card className="p-4">
            {planMixResult.error ? (
              <AdminQueryError message="The plan mix could not be loaded." />
            ) : planRows.every((row) => row.value === 0) ? (
              <AdminEmptyState icon={CreditCard} title="No paid subscriptions yet" description="Active plans will appear here." />
            ) : (
              <BarList rows={planRows} unitLabel="accounts" />
            )}
          </Card>
        </AdminSection>
      </div>

      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1.35fr)_minmax(320px,0.65fr)]">
        <AdminSection title="Operations queues" description="Current work that may require staff attention.">
          <Card className="divide-y divide-border/70 overflow-hidden p-0">
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
            <Button variant="ghost" size="sm" asChild>
              <Link href="/admin/system">Open system <ArrowRight className="h-4 w-4" aria-hidden="true" /></Link>
            </Button>
          }
        >
          <Card className="space-y-3 p-4">
            <div className="flex items-center justify-between gap-3">
              <span className="text-sm text-muted-foreground">Readiness checks</span>
              <AdminStatus label={readiness.ok ? "Passing" : "Review"} tone={readiness.ok ? "success" : "warning"} />
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="text-sm text-muted-foreground">Disabled controls</span>
              <span className="text-sm font-semibold tabular-nums">{disabledControls.length}</span>
            </div>
            {disabledControls.length > 0 ? (
              <div className="flex flex-wrap gap-2 border-t border-border/70 pt-3">
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
          <Button variant="ghost" size="sm" asChild>
            <Link href="/admin/audit">View audit log <ArrowRight className="h-4 w-4" aria-hidden="true" /></Link>
          </Button>
        }
      >
        {auditResult.error ? <AdminQueryError /> : null}
        {!auditResult.error && (auditResult.data ?? []).length === 0 ? (
          <AdminEmptyState icon={Activity} title="No admin activity yet" description="Audited staff actions will appear here." />
        ) : (
          <Card className="divide-y divide-border/70 overflow-hidden p-0">
            {(auditResult.data ?? []).map((event) => (
              <div key={event.id} className="flex items-center justify-between gap-4 px-4 py-3.5">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{humanizeAdminValue(event.action)}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">{event.target_type ? humanizeAdminValue(event.target_type) : "Platform"}</p>
                </div>
                <time className="shrink-0 text-xs text-muted-foreground">{formatAdminDate(event.created_at, true)}</time>
              </div>
            ))}
          </Card>
        )}
      </AdminSection>
    </div>
  );
}

function QueueRow({ label, value, href }: { label: string; value: number; href: "/admin/users" | "/admin/privacy" | "/admin/support" | "/admin/reports" }) {
  return (
    <Link href={href as Route} className="focus-ring safe-motion flex items-center justify-between gap-4 px-4 py-3.5 hover:bg-secondary/35">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className="flex items-center gap-3 text-sm font-semibold tabular-nums">
        {value}
        <ArrowRight className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
      </span>
    </Link>
  );
}
