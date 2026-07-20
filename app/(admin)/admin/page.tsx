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
import { getReadinessReport } from "@/lib/health/readiness";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export default async function AdminOverviewPage() {
  const admin = createSupabaseAdminClient();
  const [
    readiness,
    usersResult,
    reportsResult,
    premiumResult,
    supportResult,
    privacyResult,
    pendingRequestsResult,
    controlsResult,
    auditResult
  ] = await Promise.all([
    getReadinessReport(),
    admin.from("profiles").select("id", { count: "exact", head: true }).is("deleted_at", null),
    admin.from("reports").select("id", { count: "exact", head: true }).in("status", ["open", "reviewing"]),
    admin.from("subscriptions").select("id", { count: "exact", head: true }).in("status", ["trialing", "active"]),
    admin.from("support_tickets").select("id", { count: "exact", head: true }).not("status", "in", "(resolved,closed)"),
    admin.from("privacy_requests").select("id", { count: "exact", head: true }).not("status", "in", "(completed,rejected)"),
    admin.from("friend_requests").select("id", { count: "exact", head: true }).eq("status", "pending"),
    admin.from("emergency_controls").select("control_key, is_disabled").order("control_key"),
    admin.from("admin_audit_events").select("id, action, target_type, created_at").order("created_at", { ascending: false }).limit(6)
  ]);

  const disabledControls = (controlsResult.data ?? []).filter((control) => control.is_disabled);
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
