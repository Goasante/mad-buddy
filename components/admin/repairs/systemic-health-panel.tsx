import { Activity, AlertTriangle, CheckCircle2, Radar } from "lucide-react";
import { AdminMetricCard, AdminSection, AdminStatus, formatAdminDate } from "@/components/admin/admin-ui";
import { Card } from "@/components/ui/card";
import { sortSystemicHealth, type SystemicHealthSignal } from "@/lib/admin/systemic-health";

export function SystemicHealthPanel({ signals }: { signals: readonly SystemicHealthSignal[] }) {
  const assessments = sortSystemicHealth(signals);
  const systemicCount = assessments.filter((item) => item.severity === "systemic").length;
  const watchCount = assessments.filter((item) => item.severity === "watch").length;
  const brokenAccounts = assessments.reduce((total, item) => total + item.actionableAffectedAccounts, 0);
  const productRuleAccounts = assessments.reduce((total, item) => total + item.productRuleAccounts, 0);

  return (
    <AdminSection
      title="Systemic issue watch"
      description="Repeated Account Doctor invariant failures are surfaced here so Support does not normalize a product defect into dozens of unrelated manual repairs. Product-rule refusals are shown separately and never contribute to defect thresholds."
    >
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <AdminMetricCard icon={AlertTriangle} label="Possible systemic" value={systemicCount} hint="Signals needing engineering attention" tone={systemicCount > 0 ? "warning" : "success"} />
        <AdminMetricCard icon={Radar} label="Watch list" value={watchCount} hint="Repeated drift below systemic threshold" tone={watchCount > 0 ? "orange" : "default"} />
        <AdminMetricCard icon={Activity} label="Broken accounts" value={brokenAccounts} hint={`Across ${assessments.length} measured predicates`} tone="default" />
        <AdminMetricCard icon={CheckCircle2} label="Rule-correct cases" value={productRuleAccounts} hint="Intentional refusals excluded from incident counts" tone="success" />
      </div>

      {assessments.length > 0 ? (
        <div className="mt-4 grid gap-3 xl:grid-cols-2">
          {assessments.map((assessment) => (
            <Card key={assessment.id} className="rounded-[22px] border-white/[0.08] bg-[#111317]/88 p-4 shadow-[0_14px_38px_rgba(0,0,0,0.12)] sm:p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm font-semibold text-[#f1eee9]">{assessment.label}</p>
                    <AdminStatus label={assessment.area} />
                    <AdminStatus label={severityLabel(assessment.severity)} tone={severityTone(assessment.severity)} />
                  </div>
                  <p className="mt-2 text-xs leading-5 text-[#9c9690]">{assessment.guidance}</p>
                </div>
                <div className="grid shrink-0 grid-cols-2 gap-2 text-right">
                  <div className="rounded-[16px] border border-white/[0.08] bg-white/[0.035] px-3 py-2">
                    <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[#77736f]">Broken</p>
                    <p className="mt-1 text-2xl font-semibold tabular-nums text-white">{assessment.actionableAffectedAccounts}</p>
                  </div>
                  <div className="rounded-[16px] border border-emerald-400/10 bg-emerald-400/[0.035] px-3 py-2">
                    <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-emerald-300/70">Rule</p>
                    <p className="mt-1 text-2xl font-semibold tabular-nums text-emerald-200">{assessment.productRuleAccounts}</p>
                  </div>
                </div>
              </div>

              <div className="mt-4 grid gap-2 text-xs text-[#8f8a84] sm:grid-cols-2">
                <p>First observed: <span className="text-[#b8b2ab]">{formatAdminDate(assessment.firstObservedAt, true)}</span></p>
                <p>Last observed: <span className="text-[#b8b2ab]">{formatAdminDate(assessment.lastObservedAt, true)}</span></p>
              </div>

              <div className="mt-3 flex flex-wrap gap-2">
                <AdminStatus label={assessment.repairablePerAccount ? "Per-account repair available" : "Diagnostic / escalation only"} tone={assessment.repairablePerAccount ? "success" : "default"} />
                {assessment.engineeringEscalation && assessment.actionableAffectedAccounts > 0 ? <AdminStatus label="Engineering escalation" tone="danger" /> : null}
                {assessment.productRuleAccounts > 0 ? <AdminStatus label="Product rule cases excluded" tone="success" /> : null}
              </div>
            </Card>
          ))}
        </div>
      ) : (
        <div className="mt-4 rounded-[22px] border border-dashed border-white/[0.10] bg-white/[0.018] px-5 py-8 text-center">
          <p className="text-sm font-semibold text-[#e8e4df]">No systemic signals measured yet</p>
          <p className="mt-1.5 text-xs leading-5 text-[#89847e]">Once backend predicates are wired, repeated Account Doctor failures will appear here without exposing private user content.</p>
        </div>
      )}
    </AdminSection>
  );
}

function severityTone(severity: "normal" | "watch" | "systemic"): "success" | "warning" | "danger" {
  if (severity === "systemic") return "danger";
  if (severity === "watch") return "warning";
  return "success";
}

function severityLabel(severity: "normal" | "watch" | "systemic") {
  if (severity === "systemic") return "Possible systemic defect";
  if (severity === "watch") return "Watch";
  return "Isolated";
}
