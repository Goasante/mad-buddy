import { Activity, Gauge, OctagonAlert, ShieldCheck } from "lucide-react";
import { AdminEmptyState, AdminMetricCard, AdminPageHeader, AdminQueryError, AdminSection, AdminStatus, formatAdminDate, humanizeAdminValue } from "@/components/admin/admin-ui";
import { Card } from "@/components/ui/card";
import { getReadinessReport } from "@/lib/health/readiness";
import { requireAdminPagePermission } from "@/lib/admin/access";

export default async function AdminSystemPage() {
  const { admin } = await requireAdminPagePermission("admin.security.events.view");
  const [readiness, rateLimitsResult, controlsResult, incidentsResult] = await Promise.all([
    getReadinessReport(),
    admin.from("rate_limits").select("action, count, window_end, updated_at").order("updated_at", { ascending: false }).limit(20),
    admin.from("emergency_controls").select("control_key, is_disabled, reason, disabled_at, updated_at").order("control_key"),
    admin.from("security_incidents").select("id, title, severity, status, incident_type, detected_at").order("detected_at", { ascending: false }).limit(20)
  ]);
  const controls = controlsResult.data ?? [];
  const disabled = controls.filter((item) => item.is_disabled);
  const openIncidents = (incidentsResult.data ?? []).filter((item) => item.status !== "closed");

  return (
    <div className="space-y-7">
      <AdminPageHeader title="System" description="Platform readiness, emergency controls, incidents, and rate-limit activity without raw identifiers or location payloads." meta={<AdminStatus label={readiness.ok ? "Ready" : "Needs attention"} tone={readiness.ok ? "success" : "warning"} />} />
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <AdminMetricCard icon={ShieldCheck} label="Passing checks" value={readiness.checks.filter((item) => item.ok).length} hint={`of ${readiness.checks.length} readiness checks`} tone={readiness.ok ? "success" : "warning"} />
        <AdminMetricCard icon={OctagonAlert} label="Disabled controls" value={disabled.length} hint="Emergency controls active" tone={disabled.length ? "danger" : "success"} />
        <AdminMetricCard icon={Activity} label="Open incidents" value={openIncidents.length} hint="Not yet closed" tone={openIncidents.length ? "warning" : "success"} />
        <AdminMetricCard icon={Gauge} label="Rate-limit windows" value={(rateLimitsResult.data ?? []).length} hint="Recent activity records" />
      </div>
      <div className="grid items-start gap-5 xl:grid-cols-2">
        <AdminSection title="Readiness checks" description={`Checked ${formatAdminDate(readiness.checkedAt, true)}`}>
          <Card className="divide-y divide-border/70 overflow-hidden p-0">{readiness.checks.map((check) => <div key={check.name} className="flex items-center justify-between gap-4 px-4 py-3.5"><div><p className="text-sm font-medium">{humanizeAdminValue(check.name)}</p><p className="mt-0.5 text-xs text-muted-foreground">{check.message}</p></div><AdminStatus label={check.ok ? "Passing" : "Review"} tone={check.ok ? "success" : "warning"} /></div>)}</Card>
        </AdminSection>
        <AdminSection title="Emergency controls" description="State is read live. Changes require the secured incident procedure.">
          {controlsResult.error ? <AdminQueryError /> : <Card className="divide-y divide-border/70 overflow-hidden p-0">{controls.map((control) => <div key={control.control_key} className="flex items-center justify-between gap-4 px-4 py-3.5"><div><p className="text-sm font-medium">{humanizeAdminValue(control.control_key)}</p><p className="mt-0.5 text-xs text-muted-foreground">{control.reason || "No incident restriction"}</p></div><AdminStatus label={control.is_disabled ? "Disabled" : "Available"} tone={control.is_disabled ? "danger" : "success"} /></div>)}</Card>}
        </AdminSection>
      </div>
      <AdminSection title="Security incidents" description="Operational metadata only.">
        {incidentsResult.error ? <AdminQueryError /> : null}
        {!incidentsResult.error && (incidentsResult.data ?? []).length === 0 ? <AdminEmptyState icon={ShieldCheck} title="No security incidents" description="Declared incidents will appear here." /> : null}
        <div className="grid gap-3 md:grid-cols-2">{(incidentsResult.data ?? []).map((incident) => <Card key={incident.id} className="p-4"><div className="flex items-start justify-between gap-3"><div><p className="text-sm font-semibold">{incident.title}</p><p className="mt-1 text-xs text-muted-foreground">{humanizeAdminValue(incident.incident_type)} · {formatAdminDate(incident.detected_at, true)}</p></div><AdminStatus label={`${humanizeAdminValue(incident.severity)} · ${humanizeAdminValue(incident.status)}`} tone={incident.severity === "sev_1" ? "danger" : "warning"} /></div></Card>)}</div>
      </AdminSection>
      <AdminSection title="Recent rate-limit windows" description="Counts only. No IP hashes or raw user identifiers are displayed.">
        {rateLimitsResult.error ? <AdminQueryError /> : null}
        {!rateLimitsResult.error && (rateLimitsResult.data ?? []).length === 0 ? <AdminEmptyState icon={Gauge} title="No rate-limit activity" description="Recent enforcement windows will appear here." /> : <Card className="divide-y divide-border/70 overflow-hidden p-0">{(rateLimitsResult.data ?? []).map((item, index) => <div key={`${item.action}-${item.window_end}-${index}`} className="flex items-center justify-between gap-4 px-4 py-3"><div><p className="text-sm font-medium">{humanizeAdminValue(item.action)}</p><p className="mt-0.5 text-xs text-muted-foreground">Resets {formatAdminDate(item.window_end, true)}</p></div><span className="text-sm font-semibold tabular-nums">{item.count}</span></div>)}</Card>}
      </AdminSection>
    </div>
  );
}
