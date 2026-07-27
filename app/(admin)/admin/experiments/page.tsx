import Link from "next/link";
import type { Route } from "next";
import { FlaskConical, UsersRound } from "lucide-react";
import { AdminEmptyState, AdminPageHeader, AdminQueryError, AdminSection, AdminStatus, formatAdminDate } from "@/components/admin/admin-ui";
import { ExperimentCreateForm } from "@/components/admin/experiment-controls";
import { Card } from "@/components/ui/card";
import { requireAdminPagePermission } from "@/lib/admin/access";

export const dynamic = "force-dynamic";

export default async function ExperimentsAdminPage() {
  const { admin, access } = await requireAdminPagePermission("admin.experiments.manage");
  if (access.role !== "owner") return <AdminQueryError message="Only the Owner can manage experiments." />;
  await admin.rpc("process_experiment_schedules");

  const [experimentsResult, flagsResult] = await Promise.all([
    admin
      .from("experiments")
      .select("id, key, name, description, status, allocation_percentage, audience, starts_at, ends_at, primary_metric, created_at")
      .order("created_at", { ascending: false })
      .limit(100),
    admin
      .from("feature_flags")
      .select("id, key, description")
      .neq("status", "archived")
      .order("key")
  ]);
  if (experimentsResult.error || flagsResult.error) {
    return <AdminQueryError message="Experiment controls could not be loaded. Apply the latest migration, then try again." />;
  }
  const ids = (experimentsResult.data ?? []).map((experiment) => experiment.id);
  const [assignments, exposures] = ids.length
    ? await Promise.all([
        admin.from("experiment_assignments").select("experiment_id").in("experiment_id", ids),
        admin.from("experiment_exposures").select("experiment_id").in("experiment_id", ids)
      ])
    : [{ data: [], error: null }, { data: [], error: null }];
  const assignmentCounts = countBy(assignments.data ?? []);
  const exposureCounts = countBy(exposures.data ?? []);

  return (
    <div className="space-y-8">
      <AdminPageHeader
        title="Experiments"
        description="Run controlled product tests with permanent assignments, actual-exposure measurement, mature results, and immediate safety stops."
        meta={<AdminStatus label="Owner only" tone="warning" />}
      />

      <AdminSection
        title="Experiment registry"
        description="No experiment launches automatically. Drafts require an explicit confirmed start or schedule action."
      >
        {(experimentsResult.data ?? []).length ? (
          <div className="grid gap-3">
            {(experimentsResult.data ?? []).map((experiment) => (
              <Link
                key={experiment.id}
                href={`/admin/experiments/${experiment.id}` as Route}
                className="focus-ring rounded-2xl"
              >
                <Card className="safe-motion p-4 hover:border-primary/35 hover:bg-secondary/25">
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <FlaskConical className="h-4 w-4 text-primary" aria-hidden="true" />
                        <h3 className="font-semibold">{experiment.name}</h3>
                        <AdminStatus
                          label={experiment.status}
                          tone={experiment.status === "running" ? "success" : experiment.status === "paused" ? "warning" : "default"}
                        />
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">{experiment.key} · {experiment.description}</p>
                      <p className="mt-2 text-xs text-muted-foreground">
                        Primary: {experiment.primary_metric.replaceAll("_", " ")} · {experiment.allocation_percentage}% allocation · {experiment.audience.replaceAll("_", " ")}
                      </p>
                    </div>
                    <div className="grid grid-cols-2 gap-4 text-right text-xs">
                      <div><p className="font-semibold tabular-nums">{assignmentCounts.get(experiment.id) ?? 0}</p><p className="text-muted-foreground">Assigned</p></div>
                      <div><p className="font-semibold tabular-nums">{exposureCounts.get(experiment.id) ?? 0}</p><p className="text-muted-foreground">Exposed</p></div>
                    </div>
                  </div>
                  <p className="mt-3 text-[11px] text-muted-foreground">
                    {experiment.starts_at ? `Starts ${formatAdminDate(experiment.starts_at, true)}` : "Manual start"}
                    {experiment.ends_at ? ` · Ends ${formatAdminDate(experiment.ends_at, true)}` : ""}
                  </p>
                </Card>
              </Link>
            ))}
          </div>
        ) : (
          <AdminEmptyState
            icon={UsersRound}
            title="No experiments"
            description="Create a draft below. Nothing is assigned or exposed until the Owner explicitly starts it."
          />
        )}
      </AdminSection>

      <AdminSection
        title="Create a controlled draft"
        description="Variants change presentation only. Subscription access and entitlements remain server-authoritative."
      >
        <Card className="p-4 sm:p-5">
          <ExperimentCreateForm featureFlags={flagsResult.data ?? []} />
        </Card>
      </AdminSection>
    </div>
  );
}

function countBy(rows: Array<{ experiment_id: string }>) {
  const counts = new Map<string, number>();
  for (const row of rows) counts.set(row.experiment_id, (counts.get(row.experiment_id) ?? 0) + 1);
  return counts;
}

