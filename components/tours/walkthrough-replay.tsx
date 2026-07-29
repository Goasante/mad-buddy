"use client";

import { useState } from "react";
import { PlayCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { TourRunner } from "@/components/tours/tour-runner";

type ReplayableTour = {
  tourVersionId: string;
  slug: string;
  title: string;
  description: string;
  version: number;
  steps: Array<{
    id: string;
    stepKey: string;
    title: string;
    body: string;
    targetId: string | null;
    route: string | null;
    mediaPath: string | null;
    ctaLabel: string | null;
    ctaHref: string | null;
    entitlementKeys: string[];
  }>;
  plan: "free" | "buddy_plus" | "buddy_pro";
  entitlements: Record<
    string,
    { key: string; label: string; free: string; buddyPlus: string; buddyPro: string; current: string }
  >;
};

/**
 * Manual replay (brief §20). Replay always starts at step one and still records
 * progress normally — a deliberate replay is real engagement, not preview.
 */
export function WalkthroughReplay({ tours }: { tours: ReplayableTour[] }) {
  const [active, setActive] = useState<ReplayableTour | null>(null);

  if (tours.length === 0) {
    return (
      <EmptyState
        icon={PlayCircle}
        title="No walkthroughs available"
        description="Tours appear here as new Mad Buddy features launch."
      />
    );
  }

  return (
    <>
      <div className="space-y-3">
        {tours.map((tour) => (
          <Card key={tour.tourVersionId} className="flex items-center justify-between gap-4 p-4">
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold">{tour.title}</p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {tour.steps.length} {tour.steps.length === 1 ? "step" : "steps"}
                {tour.description ? ` · ${tour.description}` : ""}
              </p>
            </div>
            <Button type="button" size="sm" variant="outline" className="shrink-0" onClick={() => setActive(tour)}>
              Start
            </Button>
          </Card>
        ))}
      </div>

      {active ? (
        <TourRunner
          key={active.tourVersionId}
          tourVersionId={active.tourVersionId}
          title={active.title}
          description={active.description}
          steps={active.steps}
          startIndex={0}
          plan={active.plan}
          entitlements={active.entitlements}
          autoStart
        />
      ) : null}
    </>
  );
}
