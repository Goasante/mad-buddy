import Link from "next/link";
import { Activity, CreditCard, ShieldAlert, UsersRound } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { getSafetyDashboardData } from "@/lib/admin/safety-dashboard-data";
import { getReadinessReport } from "@/lib/health/readiness";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export default async function AdminOverviewPage() {
  const admin = createSupabaseAdminClient();
  const [
    safety,
    readiness,
    usersResult,
    premiumResult,
    notificationsResult,
    pendingRequestsResult
  ] = await Promise.all([
    getSafetyDashboardData(),
    getReadinessReport(),
    admin.from("profiles").select("id", { count: "exact", head: true }).is("deleted_at", null),
    admin
      .from("subscriptions")
      .select("id", { count: "exact", head: true })
      .in("status", ["trialing", "active"]),
    admin.from("notifications").select("id", { count: "exact", head: true }).eq("is_read", false),
    admin.from("friend_requests").select("id", { count: "exact", head: true }).eq("status", "pending")
  ]);

  const openReports = safety.metrics.find((metric) => metric.label === "Open reports")?.value ?? "0";

  return (
    <div className="space-y-6">
      <section className="rounded-lg border border-white/10 bg-white/[0.04] p-5 sm:p-6">
        <Badge variant={readiness.ok ? "green" : "warning"}>
          <Activity className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
          {readiness.ok ? "Ready" : "Needs setup"}
        </Badge>
        <h1 className="mt-4 text-3xl font-semibold">Management overview</h1>
        <p className="mt-3 max-w-2xl text-sm leading-6 text-muted-foreground">
          High-level account, safety, billing, and backend health signals for operating Mad Buddy.
        </p>
      </section>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard icon={UsersRound} label="Active users" value={usersResult.count ?? 0} href="/admin/users" />
        <MetricCard icon={ShieldAlert} label="Open reports" value={openReports} href="/admin/reports" tone="danger" />
        <MetricCard icon={CreditCard} label="Premium users" value={premiumResult.count ?? 0} href="/admin/billing" tone="orange" />
        <MetricCard icon={Activity} label="Unread alerts" value={notificationsResult.count ?? 0} tone="warning" />
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <Card className="p-5">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-xl font-semibold">Backend readiness</h2>
            <Button variant="outline" size="sm" asChild>
              <Link href="/admin/system">System</Link>
            </Button>
          </div>
          <div className="mt-4 grid gap-3">
            {readiness.checks.slice(0, 5).map((check) => (
              <div key={check.name} className="flex items-center justify-between gap-3 rounded-md border border-white/10 p-3">
                <div>
                  <p className="text-sm font-medium">{check.name}</p>
                  <p className="mt-1 text-xs text-muted-foreground">{check.message}</p>
                </div>
                <Badge variant={check.ok ? "green" : "warning"}>{check.ok ? "OK" : "Check"}</Badge>
              </div>
            ))}
          </div>
        </Card>

        <Card className="p-5">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-xl font-semibold">Queue snapshot</h2>
            <Badge variant="orange">Live</Badge>
          </div>
          <div className="mt-4 grid gap-3">
            <QueueLine label="Pending friend requests" value={pendingRequestsResult.count ?? 0} />
            <QueueLine label="Recent report cards" value={safety.reports.length} />
            <QueueLine label="Deletion audits" value={safety.deletionAudits.length} />
          </div>
        </Card>
      </section>
    </div>
  );
}

type MetricCardProps = {
  icon: typeof UsersRound;
  label: string;
  value: number | string;
  href?: "/admin/users" | "/admin/reports" | "/admin/billing";
  tone?: "default" | "orange" | "danger" | "warning";
};

function MetricCard({ icon: Icon, label, value, href, tone = "default" }: MetricCardProps) {
  const content = (
    <Card className="safe-motion p-4 hover:bg-white/[0.06]">
      <Icon className="h-5 w-5 text-accent" aria-hidden="true" />
      <p className="mt-3 text-sm text-muted-foreground">{label}</p>
      <p className="mt-2 text-3xl font-semibold">{value}</p>
      <Badge variant={tone} className="mt-3">
        View
      </Badge>
    </Card>
  );

  return href ? <Link href={href}>{content}</Link> : content;
}

function QueueLine({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-md border border-white/10 p-3">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className="text-lg font-semibold">{value}</span>
    </div>
  );
}
