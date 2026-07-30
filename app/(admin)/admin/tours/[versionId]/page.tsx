import Link from "next/link";
import { notFound } from "next/navigation";
import { CheckCircle2, ChevronLeft, Play, TrendingUp, UsersRound } from "lucide-react";
import {
  AdminMetricCard,
  AdminPageHeader,
  AdminSection,
  AdminStatus,
  formatAdminDate,
  humanizeAdminValue
} from "@/components/admin/admin-ui";
import { Card } from "@/components/ui/card";
import { requireAdminPagePermission } from "@/lib/admin/access";
import { MANAGED_FEATURES } from "@/lib/features/feature-flags";
import type { AdminTourStatus } from "@/lib/tours/admin-model";
import { loadTourAnalytics, loadVersionSteps, resolveDisplayStatus, validateVersion } from "@/lib/tours/admin-service";
import { TourVersionControls } from "@/components/admin/tours/tour-version-controls";
import { StepEditor } from "@/components/admin/tours/step-editor";

export const dynamic = "force-dynamic";

export default async function AdminTourVersionPage({ params }: { params: Promise<{ versionId: string }> }) {
  const { versionId } = await params;
  const { admin } = await requireAdminPagePermission("admin.tours.manage");

  const { data: version } = await admin
    .from("tour_versions")
    .select("id, version, status, audience, starts_at, ends_at, published_at, publish_reason, updated_at, tours!inner(slug, title, description, kind)")
    .eq("id", versionId)
    .maybeSingle();
  if (!version) notFound();

  const tour = version.tours as unknown as { slug: string; title: string; description: string; kind: string };
  const status = version.status as AdminTourStatus;
  const audience = (version.audience ?? {}) as { plans?: string[]; cohort?: string };

  const [steps, analytics, issues] = await Promise.all([
    loadVersionSteps(admin, versionId),
    loadTourAnalytics(admin, versionId),
    validateVersion(admin, versionId)
  ]);

  const display = resolveDisplayStatus(status, version.starts_at, version.ends_at);

  return (
    <div className="space-y-7">
      <Link
        href="/admin/tours"
        className="focus-ring safe-motion inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ChevronLeft className="h-4 w-4" aria-hidden="true" />
        Product tours
      </Link>

      <AdminPageHeader
        title={`${tour.title} · v${version.version}`}
        description={tour.description || tour.slug}
        meta={<AdminStatus label={humanizeAdminValue(display)} tone={display === "published" ? "success" : "default"} />}
      />

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <AdminMetricCard icon={UsersRound} label="Eligible" value={analytics.funnel.eligible} hint="Users matching plan and cohort" />
        <AdminMetricCard icon={Play} label="Started" value={analytics.funnel.started} hint={`${analytics.funnel.shown} shown the invitation`} />
        <AdminMetricCard icon={CheckCircle2} label="Completed" value={analytics.funnel.completed} hint={`${analytics.funnel.skipped} skipped`} tone="success" />
        <AdminMetricCard icon={TrendingUp} label="Completion rate" value={`${analytics.funnel.completionRate}%`} hint="Of those who started" tone="orange" />
      </section>

      {issues.length > 0 ? (
        <AdminSection title="Validation" description="Errors block publishing. Warnings do not, but publish knowingly.">
          <Card className="divide-y divide-border/70 overflow-hidden p-0">
            {issues.map((issue, index) => (
              <div key={`${issue.stepKey}-${index}`} className="flex items-start justify-between gap-4 px-4 py-3">
                <p className="min-w-0 text-sm">
                  {issue.stepKey ? <span className="text-muted-foreground">{issue.stepKey}: </span> : null}
                  {issue.message}
                </p>
                <AdminStatus label={issue.level === "error" ? "Error" : "Warning"} tone={issue.level === "error" ? "danger" : "warning"} />
              </div>
            ))}
          </Card>
        </AdminSection>
      ) : null}

      <AdminSection title="Lifecycle" description="Publishing requires a reason and is recorded in the audit log.">
        <TourVersionControls
          versionId={versionId}
          status={status}
          plans={audience.plans ?? ["free", "buddy_plus", "buddy_pro"]}
          cohort={(audience.cohort as "all" | "new" | "existing") ?? "all"}
        />
      </AdminSection>

      <AdminSection
        title="Steps"
        description={
          status === "draft"
            ? "Add, edit, reorder or remove steps. Nothing here reaches users until you publish."
            : "Order is what consumers see. Steps behind a disabled feature are skipped at render time."
        }
      >
        <StepEditor
          versionId={versionId}
          steps={steps}
          editable={status === "draft"}
          featureOptions={MANAGED_FEATURES.map((feature) => ({ key: feature.key, title: feature.title }))}
        />
      </AdminSection>

      {/* Analytics are kept separate from configuration, and hidden entirely for
          a draft where every number would be zero and meaningless. */}
      {status !== "draft" && analytics.dropOff.length > 0 ? (
        <AdminSection title="Step drop-off" description="Viewers per step, relative to step one.">
          <Card className="divide-y divide-border/70 overflow-hidden p-0">
            {analytics.dropOff.map((entry) => (
              <div key={entry.stepKey} className="flex items-center justify-between gap-4 px-4 py-3">
                <p className="min-w-0 truncate text-sm">
                  <span className="text-muted-foreground">{entry.position}. </span>
                  {entry.title}
                </p>
                <span className="shrink-0 text-sm tabular-nums">
                  {entry.retention}% <span className="text-muted-foreground">({entry.viewers})</span>
                </span>
              </div>
            ))}
          </Card>
        </AdminSection>
      ) : null}

      {status !== "draft" && analytics.byPlan.length > 0 ? (
        <AdminSection title="By plan" description="Whether premium education is landing. Counts only, never individual users.">
          <Card className="divide-y divide-border/70 overflow-hidden p-0">
            {analytics.byPlan.map((row) => (
              <div key={row.plan} className="flex items-center justify-between gap-4 px-4 py-3 text-sm">
                <span className="text-muted-foreground">{humanizeAdminValue(row.plan)}</span>
                <span className="tabular-nums">
                  {row.completed}/{row.started} completed
                </span>
              </div>
            ))}
          </Card>
        </AdminSection>
      ) : null}

      <p className="text-xs text-muted-foreground">
        Published {formatAdminDate(version.published_at, true) || "—"} · Updated {formatAdminDate(version.updated_at, true)}
        {version.publish_reason ? ` · ${version.publish_reason}` : ""}
      </p>
    </div>
  );
}
