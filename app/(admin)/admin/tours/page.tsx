import Link from "next/link";
import type { Route } from "next";
import { ArrowRight, Compass } from "lucide-react";
import {
  AdminEmptyState,
  AdminPageHeader,
  AdminSection,
  AdminStatus,
  formatAdminDate,
  humanizeAdminValue
} from "@/components/admin/admin-ui";
import { Card } from "@/components/ui/card";
import { CreateTourButton } from "@/components/admin/tours/create-tour-button";
import { requireAdminPagePermission } from "@/lib/admin/access";
import { listAdminTours, loadTourAnalytics } from "@/lib/tours/admin-service";
import type { DisplayStatus } from "@/lib/tours/admin-model";

export const dynamic = "force-dynamic";

const STATUS_TONE: Record<DisplayStatus, "success" | "warning" | "danger" | "default"> = {
  published: "success",
  scheduled: "warning",
  paused: "warning",
  draft: "default",
  retired: "default",
  ended: "default"
};

export default async function AdminToursPage() {
  // Redirects a viewer without admin.tours.manage; support does not hold it.
  const { admin } = await requireAdminPagePermission("admin.tours.manage");
  const tours = await listAdminTours(admin);

  // Funnel numbers come from the aggregate RPC, one call per version. The list
  // is small by nature (a handful of tours), so this stays bounded — it is not a
  // per-row scan of event history.
  const analytics = await Promise.all(
    tours.map(async (tour) => ({ versionId: tour.versionId, data: await loadTourAnalytics(admin, tour.versionId) }))
  );
  const byVersion = new Map(analytics.map((entry) => [entry.versionId, entry.data]));

  return (
    <div className="space-y-7">
      <AdminPageHeader
        title="Product tours"
        description="Versioned feature education. Publishing a new version is how a tour is shown again; completion history is never deleted."
        action={<CreateTourButton />}
      />

      {tours.length === 0 ? (
        <AdminEmptyState
          icon={Compass}
          title="No tours yet"
          description="Seeded tours and any versions created here will appear in this list."
        />
      ) : (
        <AdminSection title="Tours" description="Newest change first. Only a published version can reach consumers.">
          <Card className="divide-y divide-border/70 overflow-hidden p-0">
            {tours.map((tour) => {
              const funnel = byVersion.get(tour.versionId)?.funnel;
              return (
                <Link
                  key={tour.versionId}
                  href={`/admin/tours/${tour.versionId}` as Route}
                  className="focus-ring safe-motion flex items-center justify-between gap-4 px-4 py-3.5 hover:bg-secondary/35"
                >
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="truncate text-sm font-semibold">{tour.title}</p>
                      <AdminStatus label={humanizeAdminValue(tour.display)} tone={STATUS_TONE[tour.display]} />
                      <span className="text-xs text-muted-foreground">v{tour.version}</span>
                    </div>
                    <p className="mt-0.5 truncate text-xs text-muted-foreground">
                      {tour.slug} · {tour.kind === "main" ? "Main walkthrough" : "Feature tour"} · {tour.stepCount}{" "}
                      {tour.stepCount === 1 ? "step" : "steps"} · {tour.plans.length === 3 ? "all plans" : tour.plans.join(", ")}
                      {tour.cohort !== "all" ? ` · ${tour.cohort} users` : ""}
                    </p>
                    <p className="mt-0.5 truncate text-[0.6875rem] text-muted-foreground">
                      Updated {formatAdminDate(tour.updatedAt, true)}
                      {tour.publishReason ? ` · ${tour.publishReason}` : ""}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-4">
                    <div className="text-right">
                      <p className="text-sm font-semibold tabular-nums">{funnel ? `${funnel.completionRate}%` : "—"}</p>
                      <p className="text-[0.6875rem] text-muted-foreground">
                        {funnel ? `${funnel.completed}/${funnel.started} completed` : "no data"}
                      </p>
                    </div>
                    <ArrowRight className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                  </div>
                </Link>
              );
            })}
          </Card>
        </AdminSection>
      )}
    </div>
  );
}
