import { Activity, Gauge, ListChecks, OctagonAlert, ShieldCheck } from "lucide-react";
import { AdminEmptyState, AdminMetricCard, AdminPageHeader, AdminQueryError, AdminSection, AdminStatus, formatAdminDate, humanizeAdminValue } from "@/components/admin/admin-ui";
import { EmergencyControlToggle } from "@/components/admin/health/emergency-control-toggle";
import { JobRetryButton } from "@/components/admin/health/job-retry-button";
import { Card } from "@/components/ui/card";
import { getReadinessReport } from "@/lib/health/readiness";
import { requireAdminPagePermission } from "@/lib/admin/access";
import { classifyJobHealth, EMERGENCY_CONTROL_META, EMERGENCY_CONTROL_ORDER, jobStatusLabel, jobStatusTone } from "@/lib/admin/app-health";

const STALE_PROCESSING_MS = 5 * 60 * 1000;

export default async function AdminAppHealthPage() {
  const { admin, access } = await requireAdminPagePermission("admin.security.events.view");
  const canManageControls = access.permissions.has("admin.emergency_controls.manage");
  const canRetryJobs = access.permissions.has("admin.security.incidents.manage");
  const staleBefore = new Date(new Date().getTime() - STALE_PROCESSING_MS).toISOString();

  const [
    readiness,
    controlsResult,
    incidentsResult,
    rateLimitsResult,
    queued,
    retrying,
    failed,
    deadLetter,
    stuck,
    completed,
    recentFailuresResult
  ] = await Promise.all([
    getReadinessReport(),
    admin.from("emergency_controls").select("control_key, is_disabled, reason").order("control_key"),
    admin.from("security_incidents").select("id, title, severity, status, incident_type, detected_at").order("detected_at", { ascending: false }).limit(12),
    admin.from("rate_limits").select("action, count, window_end").order("count", { ascending: false }).limit(12),
    admin.from("jobs").select("id", { count: "exact", head: true }).in("status", ["queued", "scheduled"]),
    admin.from("jobs").select("id", { count: "exact", head: true }).eq("status", "retrying"),
    admin.from("jobs").select("id", { count: "exact", head: true }).eq("status", "failed"),
    admin.from("jobs").select("id", { count: "exact", head: true }).eq("status", "dead_letter"),
    admin.from("jobs").select("id", { count: "exact", head: true }).eq("status", "processing").lt("locked_at", staleBefore),
    admin.from("jobs").select("id", { count: "exact", head: true }).eq("status", "completed"),
    admin.from("jobs").select("id, job_type, status, attempts, max_attempts, last_error_code, last_error_at").in("status", ["failed", "dead_letter"]).order("last_error_at", { ascending: false }).limit(15)
  ]);

  const counts = {
    queued: queued.count ?? 0,
    retrying: retrying.count ?? 0,
    failed: failed.count ?? 0,
    deadLetter: deadLetter.count ?? 0,
    stuck: stuck.count ?? 0
  };
  const jobHealth = classifyJobHealth(counts);
  const controls = controlsResult.data ?? [];
  const disabledControls = controls.filter((control) => control.is_disabled);
  const controlByKey = new Map(controls.map((control) => [control.control_key, control]));
  const openIncidents = (incidentsResult.data ?? []).filter((incident) => incident.status !== "closed");
  const recentFailures = recentFailuresResult.data ?? [];

  return (
    <div className="space-y-7">
      <AdminPageHeader
        title="App health"
        description="Readiness, the background job queue, emergency controls, incidents, and rate-limit pressure — operational signals only, no private data."
        meta={<AdminStatus label={readiness.ok && jobHealth.level === "healthy" ? "Healthy" : "Needs attention"} tone={readiness.ok && jobHealth.level === "healthy" ? "success" : "warning"} />}
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <AdminMetricCard icon={ShieldCheck} label="Passing checks" value={readiness.checks.filter((check) => check.ok).length} hint={`of ${readiness.checks.length} readiness checks`} tone={readiness.ok ? "success" : "warning"} />
        <AdminMetricCard icon={ListChecks} label="Job queue" value={jobHealth.label} hint={`${counts.queued} queued · ${counts.failed + counts.deadLetter} failing`} tone={jobHealth.tone} />
        <AdminMetricCard icon={OctagonAlert} label="Kill switches" value={disabledControls.length} hint="Features currently disabled" tone={disabledControls.length ? "danger" : "success"} />
        <AdminMetricCard icon={Activity} label="Open incidents" value={openIncidents.length} hint="Not yet closed" tone={openIncidents.length ? "warning" : "success"} />
      </div>

      <AdminSection title="Background jobs" description="Queue throughput and recent failures. Requeue sends a job back to the front of the queue.">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-6">
          {([["Queued", counts.queued, "default"], ["Retrying", counts.retrying, "warning"], ["Failed", counts.failed, "danger"], ["Dead letter", counts.deadLetter, "danger"], ["Stuck", counts.stuck, "danger"], ["Completed", completed.count ?? 0, "success"]] as const).map(([label, value, tone]) => (
            <Card key={label} className="p-3">
              <p className="text-xs text-muted-foreground">{label}</p>
              <p className="mt-1 text-xl font-semibold tabular-nums">{value}</p>
              <AdminStatus label={tone === "danger" && value > 0 ? "Attention" : "OK"} tone={value > 0 ? (tone === "success" ? "success" : tone === "default" ? "default" : tone) : "success"} />
            </Card>
          ))}
        </div>

        {recentFailuresResult.error ? <AdminQueryError /> : null}
        {!recentFailuresResult.error && recentFailures.length === 0 ? (
          <AdminEmptyState icon={ListChecks} title="No failing jobs" description="Failed and dead-letter jobs will appear here." />
        ) : recentFailures.length > 0 ? (
          <Card className="divide-y divide-border/70 overflow-hidden p-0">
            {recentFailures.map((job) => (
              <div key={job.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-medium">{humanizeAdminValue(job.job_type)}</p>
                    <AdminStatus label={jobStatusLabel(job.status)} tone={jobStatusTone(job.status)} />
                  </div>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {job.last_error_code ? `${job.last_error_code} · ` : ""}attempt {job.attempts}/{job.max_attempts}
                    {job.last_error_at ? ` · ${formatAdminDate(job.last_error_at, true)}` : ""}
                  </p>
                </div>
                {canRetryJobs ? <JobRetryButton jobId={job.id} /> : null}
              </div>
            ))}
          </Card>
        ) : null}
      </AdminSection>

      <div className="grid items-start gap-5 xl:grid-cols-2">
        <AdminSection title="Emergency controls" description={canManageControls ? "Flip a kill switch. Every change is audited." : "Live state. You don't have permission to change these."}>
          {controlsResult.error ? (
            <AdminQueryError />
          ) : (
            <Card className="divide-y divide-border/70 overflow-hidden p-0">
              {EMERGENCY_CONTROL_ORDER.map((key) => {
                const meta = EMERGENCY_CONTROL_META[key];
                const row = controlByKey.get(key);
                return (
                  <EmergencyControlToggle
                    key={key}
                    controlKey={key}
                    label={meta.label}
                    description={meta.description}
                    safetyCritical={meta.safetyCritical}
                    isDisabled={Boolean(row?.is_disabled)}
                    reason={row?.reason ?? null}
                    canManage={canManageControls}
                  />
                );
              })}
            </Card>
          )}
        </AdminSection>

        <AdminSection title="Readiness checks" description={`Checked ${formatAdminDate(readiness.checkedAt, true)}`}>
          <Card className="divide-y divide-border/70 overflow-hidden p-0">
            {readiness.checks.map((check) => (
              <div key={check.name} className="flex items-center justify-between gap-4 px-4 py-3.5">
                <div>
                  <p className="text-sm font-medium">{humanizeAdminValue(check.name)}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">{check.message}</p>
                </div>
                <AdminStatus label={check.ok ? "Passing" : "Review"} tone={check.ok ? "success" : "warning"} />
              </div>
            ))}
          </Card>
        </AdminSection>
      </div>

      <AdminSection title="Security incidents" description="Operational metadata only.">
        {incidentsResult.error ? <AdminQueryError /> : null}
        {!incidentsResult.error && (incidentsResult.data ?? []).length === 0 ? (
          <AdminEmptyState icon={ShieldCheck} title="No security incidents" description="Declared incidents will appear here." />
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            {(incidentsResult.data ?? []).map((incident) => (
              <Card key={incident.id} className="p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold">{incident.title}</p>
                    <p className="mt-1 text-xs text-muted-foreground">{humanizeAdminValue(incident.incident_type)} · {formatAdminDate(incident.detected_at, true)}</p>
                  </div>
                  <AdminStatus label={`${humanizeAdminValue(incident.severity)} · ${humanizeAdminValue(incident.status)}`} tone={incident.severity === "sev_1" ? "danger" : "warning"} />
                </div>
              </Card>
            ))}
          </div>
        )}
      </AdminSection>

      <AdminSection title="Rate-limit pressure" description="Highest recent windows by count. No IP hashes or raw identifiers are shown.">
        {rateLimitsResult.error ? <AdminQueryError /> : null}
        {!rateLimitsResult.error && (rateLimitsResult.data ?? []).length === 0 ? (
          <AdminEmptyState icon={Gauge} title="No rate-limit activity" description="Recent enforcement windows will appear here." />
        ) : (
          <Card className="divide-y divide-border/70 overflow-hidden p-0">
            {(rateLimitsResult.data ?? []).map((item, index) => (
              <div key={`${item.action}-${index}`} className="flex items-center justify-between gap-4 px-4 py-3">
                <div>
                  <p className="text-sm font-medium">{humanizeAdminValue(item.action)}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">Resets {formatAdminDate(item.window_end, true)}</p>
                </div>
                <span className="text-sm font-semibold tabular-nums">{item.count}</span>
              </div>
            ))}
          </Card>
        )}
      </AdminSection>
    </div>
  );
}
