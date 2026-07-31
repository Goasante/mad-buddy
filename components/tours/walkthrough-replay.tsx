"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Circle, PlayCircle, RotateCcw } from "lucide-react";
import { startTourReplayAction } from "@/app/(app)/tour-replay-actions";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { FEATURE_GUIDE_GROUPS, findFeatureGuide, type FeatureGuideGroupId } from "@/lib/tours/registry";
import { cn } from "@/lib/utils";

type ReplayableTour = {
  tourVersionId: string;
  slug: string;
  title: string;
  description: string;
  version: number;
  stepCount: number;
  progressStatus: "started" | "completed" | "skipped" | "dismissed" | null;
};

function guideStatus(status: ReplayableTour["progressStatus"]) {
  if (status === "completed") return { label: "Completed", icon: CheckCircle2, tone: "text-emerald-600 dark:text-emerald-300" };
  if (status === "started") return { label: "In progress", icon: PlayCircle, tone: "text-primary" };
  if (status === "skipped" || status === "dismissed") return { label: "Not completed", icon: Circle, tone: "text-muted-foreground" };
  return { label: "Not viewed", icon: Circle, tone: "text-muted-foreground" };
}

export function WalkthroughReplay({ tours }: { tours: ReplayableTour[] }) {
  const router = useRouter();
  const [error, setError] = useState("");
  const [startingId, setStartingId] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const grouped = useMemo(() => {
    const groups = new Map<FeatureGuideGroupId, ReplayableTour[]>();
    for (const group of FEATURE_GUIDE_GROUPS) groups.set(group.id, []);
    for (const tour of tours) {
      const group = findFeatureGuide(tour.slug)?.group ?? "getting-started";
      groups.get(group)?.push(tour);
    }
    return groups;
  }, [tours]);

  if (tours.length === 0) {
    return (
      <EmptyState
        icon={PlayCircle}
        title="No feature guides available"
        description="Guides appear here as Mad Buddy features become available to you."
      />
    );
  }

  const start = (tour: ReplayableTour) => {
    setError("");
    setStartingId(tour.tourVersionId);
    startTransition(async () => {
      const result = await startTourReplayAction({ versionId: tour.tourVersionId });
      if (!result.ok) {
        setError(result.message);
        setStartingId(null);
        return;
      }
      router.push((findFeatureGuide(tour.slug)?.entryRoute ?? "/dashboard") as Parameters<typeof router.push>[0]);
    });
  };

  return (
    <div className="space-y-7">
      {error ? <p className="rounded-xl bg-destructive/10 px-4 py-3 text-sm text-destructive" role="alert">{error}</p> : null}

      {FEATURE_GUIDE_GROUPS.map((group) => {
        const entries = grouped.get(group.id) ?? [];
        if (entries.length === 0) return null;
        return (
          <section key={group.id} aria-labelledby={`feature-guide-${group.id}`}>
            <h2 id={`feature-guide-${group.id}`} className="mb-2 text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              {group.label}
            </h2>
            <div className="overflow-hidden rounded-2xl border border-border/70 bg-card/45">
              {entries.map((tour, index) => {
                const state = guideStatus(tour.progressStatus);
                const StateIcon = state.icon;
                const replay = tour.progressStatus !== null;
                return (
                  <div
                    key={tour.tourVersionId}
                    className={cn(
                      "flex min-h-[4.75rem] items-center gap-3 px-4 py-3",
                      index > 0 && "border-t border-border/60"
                    )}
                  >
                    <span className={cn("grid h-9 w-9 shrink-0 place-items-center rounded-full bg-secondary/70", state.tone)}>
                      <StateIcon className="h-4 w-4" aria-hidden="true" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold">{findFeatureGuide(tour.slug)?.label ?? tour.title}</p>
                      <p className={cn("mt-0.5 text-xs", state.tone)}>{state.label} · {tour.stepCount} {tour.stepCount === 1 ? "step" : "steps"}</p>
                    </div>
                    <Button
                      type="button"
                      size="sm"
                      variant={replay ? "outline" : "primary"}
                      className="shrink-0"
                      disabled={isPending}
                      onClick={() => start(tour)}
                      aria-label={`${replay ? "Replay" : "Start"} ${findFeatureGuide(tour.slug)?.label ?? tour.title} guide`}
                    >
                      {replay ? <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" /> : <PlayCircle className="h-3.5 w-3.5" aria-hidden="true" />}
                      {startingId === tour.tourVersionId ? "Starting..." : replay ? "Replay" : "Start"}
                    </Button>
                  </div>
                );
              })}
            </div>
          </section>
        );
      })}

      <p className="text-xs leading-5 text-muted-foreground">
        Replaying a guide does not reset your history or change your feature access.
      </p>
    </div>
  );
}
