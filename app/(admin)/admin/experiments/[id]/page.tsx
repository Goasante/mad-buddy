import Link from "next/link";
import type { Route } from "next";
import { notFound } from "next/navigation";
import { AlertTriangle, ArrowLeft, Banknote, FlaskConical, ShieldAlert, UsersRound } from "lucide-react";
import {
  AdminMetricCard,
  AdminPageHeader,
  AdminQueryError,
  AdminSection,
  AdminStatus,
  formatAdminDate,
  humanizeAdminValue
} from "@/components/admin/admin-ui";
import { ExperimentLifecycleForm, ExperimentTesterForm } from "@/components/admin/experiment-controls";
import { Card } from "@/components/ui/card";
import { requireAdminPagePermission } from "@/lib/admin/access";
import { EXPERIMENT_METRICS, type ExperimentStatus } from "@/lib/experiments/model";
import { getExperimentResults } from "@/lib/experiments/results";

export const dynamic = "force-dynamic";

export default async function ExperimentDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { admin, access } = await requireAdminPagePermission("admin.experiments.manage");
  if (access.role !== "owner") return <AdminQueryError message="Only the Owner can manage experiments." />;
  await admin.rpc("process_experiment_schedules");
  const id = (await params).id;
  const [experimentResult, variantsResult, testersResult] = await Promise.all([
    admin.from("experiments").select("*").eq("id", id).maybeSingle(),
    admin.from("experiment_variants").select("*").eq("experiment_id", id).order("key"),
    admin.from("experiment_testers").select("user_id, created_at").eq("experiment_id", id).order("created_at")
  ]);
  if (experimentResult.error || variantsResult.error || testersResult.error) {
    return <AdminQueryError message="The experiment could not be loaded." />;
  }
  if (!experimentResult.data) notFound();
  const experiment = experimentResult.data;
  const testerIds = (testersResult.data ?? []).map((tester) => tester.user_id).filter((userId): userId is string => Boolean(userId));
  const { data: profiles } = testerIds.length
    ? await admin.from("profiles").select("user_id, username").in("user_id", testerIds)
    : { data: [] };
  const usernames = new Map((profiles ?? []).map((profile) => [profile.user_id, profile.username]));
  let report = null;
  try {
    report = await getExperimentResults(admin, experiment.id);
  } catch {
    report = null;
  }
  const actions = lifecycleActions(experiment.status);
  const flag = experiment.parent_feature_flag_id
    ? await admin.from("feature_flags").select("key, status, default_value").eq("id", experiment.parent_feature_flag_id).maybeSingle()
    : null;

  return (
    <div className="space-y-8">
      <Link href={"/admin/experiments" as Route} className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" aria-hidden="true" /> Experiments
      </Link>
      <AdminPageHeader
        title={experiment.name}
        description={experiment.description}
        meta={<AdminStatus label={experiment.status} tone={experiment.status === "running" ? "success" : experiment.status === "paused" ? "warning" : "default"} />}
      />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <AdminMetricCard icon={UsersRound} label="Assignments" value={report?.assignmentCount ?? "Unavailable"} />
        <AdminMetricCard icon={FlaskConical} label="Actual exposures" value={report?.exposureCount ?? "Unavailable"} />
        <AdminMetricCard icon={FlaskConical} label="Duration" value={report ? `${report.durationDays} days` : "Unavailable"} />
        <AdminMetricCard icon={Banknote} label="Revenue currencies" value={report?.revenue.length ?? "Unavailable"} />
        <AdminMetricCard icon={ShieldAlert} label="Guardrails" value={experiment.guardrail_metrics.length} />
      </div>

      <AdminSection title="Hypothesis and targeting">
        <Card className="grid gap-5 p-4 md:grid-cols-2 lg:grid-cols-3">
          <Detail label="Hypothesis" value={experiment.hypothesis} />
          <Detail label="Audience" value={`${humanizeAdminValue(experiment.audience)}, ${experiment.allocation_percentage}%`} />
          <Detail label="Platforms" value={experiment.target_platforms.map(humanizeAdminValue).join(", ")} />
          <Detail label="Plans" value={experiment.target_plans.map(humanizeAdminValue).join(", ")} />
          <Detail label="Conflict group" value={experiment.conflict_group ?? "None"} />
          <Detail
            label="Parent feature flag"
            value={flag?.data ? `${flag.data.key}: ${flag.data.status}` : "Core surface"}
          />
          <Detail label="Starts" value={formatAdminDate(experiment.starts_at ?? experiment.started_at, true)} />
          <Detail label="Ends" value={formatAdminDate(experiment.ends_at ?? experiment.completed_at, true)} />
          <Detail label="Experiment key" value={experiment.key} />
        </Card>
      </AdminSection>

      {actions.length ? (
        <AdminSection
          title="Lifecycle control"
          description="Every change requires confirmation and an audit reason. Emergency stop blocks new exposure immediately and preserves history."
        >
          <ExperimentLifecycleForm experimentId={experiment.id} actions={actions} />
        </AdminSection>
      ) : null}

      <AdminSection title="Variants" description="Weights are fixed after launch. The total allocation is 100%.">
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {(variantsResult.data ?? []).map((variant) => (
            <Card key={variant.id} className="p-4">
              <div className="flex items-center justify-between gap-3">
                <p className="font-semibold">{variant.name}</p>
                {variant.is_control ? <AdminStatus label="Control" /> : <AdminStatus label={variant.key.replaceAll("_", " ")} />}
              </div>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">{variant.description || "No additional description."}</p>
              <p className="mt-3 text-xs font-medium tabular-nums">{variant.weight_basis_points / 100}% allocation</p>
            </Card>
          ))}
        </div>
      </AdminSection>

      {["draft", "scheduled"].includes(experiment.status) ? (
        <AdminSection title="Selected testers" description="Used only when the audience is selected testers. The list locks after launch.">
          <Card className="space-y-4 p-4">
            <ExperimentTesterForm experimentId={experiment.id} />
            <div className="flex flex-wrap gap-2">
              {(testersResult.data ?? []).map((tester, index) => (
                <AdminStatus
                  key={tester.user_id ?? `deleted-${index}`}
                  label={tester.user_id ? (usernames.get(tester.user_id) ? `@${usernames.get(tester.user_id)}` : tester.user_id) : "Deleted account"}
                />
              ))}
              {!testersResult.data?.length ? <p className="text-xs text-muted-foreground">No selected testers.</p> : null}
            </div>
          </Card>
        </AdminSection>
      ) : null}

      <AdminSection
        title="Results"
        description="Only actual exposures are included. Binary rates use a two-proportion z-test after at least 7 days, 30 exposed users per compared variant, and 5 expected observations in every outcome cell. A directional result requires at least 95% confidence."
      >
        {!report ? (
          <AdminQueryError message="Results are unavailable. Apply the latest migration and try again." />
        ) : (
          <div className="space-y-5">
            {report.warning ? (
              <div className="flex gap-3 rounded-xl border border-amber-500/25 bg-amber-500/10 p-4 text-sm text-amber-200">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" /> {report.warning}
              </div>
            ) : null}
            <MetricTable metricKey={experiment.primary_metric} title={`Primary: ${metricLabel(experiment.primary_metric)}`} rows={report.primary} />
            {report.secondary.map((item) => <MetricTable key={item.metricKey} metricKey={item.metricKey} title={`Secondary: ${metricLabel(item.metricKey)}`} rows={item.rows} />)}
            {report.guardrails.map((item) => <MetricTable key={item.metricKey} metricKey={item.metricKey} title={`Guardrail: ${metricLabel(item.metricKey)}`} rows={item.rows} guardrail />)}
            <RevenueTable rows={report.revenue} />
          </div>
        )}
      </AdminSection>
    </div>
  );
}

function lifecycleActions(status: ExperimentStatus) {
  if (status === "draft") return ["schedule", "start", "cancel"] as const;
  if (status === "scheduled") return ["start", "cancel"] as const;
  if (status === "running") return ["pause", "stop", "emergency_stop"] as const;
  if (status === "paused") return ["resume", "stop", "cancel"] as const;
  return [] as const;
}

function Detail({ label, value }: { label: string; value: string }) {
  return <div><p className="text-xs font-medium text-muted-foreground">{label}</p><p className="mt-1 text-sm leading-6">{value}</p></div>;
}

function MetricTable({
  title,
  metricKey,
  rows,
  guardrail = false
}: {
  title: string;
  metricKey: string;
  rows: Array<{
    variantKey: string;
    sampleSize: number;
    convertedUsers: number;
    ratePercent: number | null;
    absoluteDifferencePoints: number | null;
    relativeDifferencePercent: number | null;
    confidencePercent: number | null;
    interpretation: string;
  }>;
  guardrail?: boolean;
}) {
  return (
    <Card className="overflow-x-auto p-0">
      <div className="border-b border-border/70 px-4 py-3"><h3 className="text-sm font-semibold">{title}</h3></div>
      <table className="w-full min-w-[720px] text-left text-sm">
        <thead className="text-xs text-muted-foreground">
          <tr>{["Variant", "Exposed", "Converted", "Rate", "Absolute", "Relative", "Confidence", "Reading"].map((label) => <th key={label} className="px-4 py-3 font-medium">{label}</th>)}</tr>
        </thead>
        <tbody className="divide-y divide-border/60">
          {rows.map((row) => (
            <tr key={row.variantKey}>
              <td className="px-4 py-3 font-medium">{humanizeAdminValue(row.variantKey)}</td>
              <td className="px-4 py-3 tabular-nums">{row.sampleSize}</td>
              <td className="px-4 py-3 tabular-nums">{row.convertedUsers}</td>
              <td className="px-4 py-3 tabular-nums">{formatPercent(row.ratePercent)}</td>
              <td className="px-4 py-3 tabular-nums">{row.absoluteDifferencePoints === null ? "Not enough data" : `${signed(row.absoluteDifferencePoints)} pp`}</td>
              <td className="px-4 py-3 tabular-nums">{row.relativeDifferencePercent === null ? "Not enough data" : `${signed(row.relativeDifferencePercent)}%`}</td>
              <td className="px-4 py-3 tabular-nums">{formatPercent(row.confidencePercent)}</td>
              <td className={guardrail && isGuardrailRegression(row.interpretation, metricKey) ? "px-4 py-3 text-red-400" : "px-4 py-3"}>
                {resultLabel(row.interpretation, metricKey)}
              </td>
            </tr>
          ))}
          {!rows.length ? <tr><td colSpan={8} className="px-4 py-6 text-center text-muted-foreground">No exposed cohort yet.</td></tr> : null}
        </tbody>
      </table>
    </Card>
  );
}

function RevenueTable({ rows }: { rows: Array<{ currency: string; variantKey: string; exposedUsers: number; payingUsers: number; amountMinor: number; amountPerExposedUserMinor: number }> }) {
  return (
    <Card className="overflow-x-auto p-0">
      <div className="border-b border-border/70 px-4 py-3">
        <h3 className="text-sm font-semibold">Verified Paystack revenue</h3>
        <p className="mt-1 text-xs text-muted-foreground">Currencies are never converted or combined.</p>
      </div>
      <table className="w-full min-w-[620px] text-left text-sm">
        <thead className="text-xs text-muted-foreground"><tr>{["Currency", "Variant", "Exposed", "Paid", "Revenue", "Per exposed user"].map((label) => <th key={label} className="px-4 py-3 font-medium">{label}</th>)}</tr></thead>
        <tbody className="divide-y divide-border/60">
          {rows.map((row) => (
            <tr key={`${row.currency}:${row.variantKey}`}>
              <td className="px-4 py-3 font-medium">{row.currency}</td>
              <td className="px-4 py-3">{humanizeAdminValue(row.variantKey)}</td>
              <td className="px-4 py-3 tabular-nums">{row.exposedUsers}</td>
              <td className="px-4 py-3 tabular-nums">{row.payingUsers}</td>
              <td className="px-4 py-3 tabular-nums">{money(row.amountMinor, row.currency)}</td>
              <td className="px-4 py-3 tabular-nums">{money(row.amountPerExposedUserMinor, row.currency)}</td>
            </tr>
          ))}
          {!rows.length ? <tr><td colSpan={6} className="px-4 py-6 text-center text-muted-foreground">No verified revenue after exposure.</td></tr> : null}
        </tbody>
      </table>
    </Card>
  );
}

function metricLabel(key: string) {
  return EXPERIMENT_METRICS.find((metric) => metric.key === key)?.label ?? humanizeAdminValue(key);
}

function formatPercent(value: number | null) {
  return value === null ? "Not enough data" : `${value}%`;
}

function signed(value: number) {
  return value > 0 ? `+${value}` : String(value);
}

function resultLabel(value: string, metricKey: string) {
  const increaseIsBetter = !LOWER_IS_BETTER_METRICS.has(metricKey);
  return {
    control: "Control",
    insufficient_data: "Not enough data",
    no_clear_difference: "No clear difference",
    higher: increaseIsBetter ? "Variant performing better" : "Control performing better",
    lower: increaseIsBetter ? "Control performing better" : "Variant performing better"
  }[value] ?? "Not enough data";
}

function isGuardrailRegression(value: string, metricKey: string) {
  return LOWER_IS_BETTER_METRICS.has(metricKey) ? value === "higher" : value === "lower";
}

const LOWER_IS_BETTER_METRICS = new Set([
  "cancellation",
  "payment_failure",
  "support_issue",
  "notification_opt_out"
]);

function money(minor: number, currency: string) {
  try {
    return new Intl.NumberFormat("en", { style: "currency", currency }).format(minor / 100);
  } catch {
    return `${currency} ${(minor / 100).toFixed(2)}`;
  }
}
