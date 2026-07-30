"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { PlayCircle } from "lucide-react";
import { startTourReplayAction } from "@/app/(app)/tour-replay-actions";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";

type ReplayableTour = {
  tourVersionId: string;
  slug: string;
  title: string;
  description: string;
  version: number;
  stepCount: number;
};

/**
 * Manual replay launcher.
 *
 * It deliberately does NOT render the tour itself. It used to, and that was the
 * bug: the first step of the main walkthrough routes to /dashboard, so the
 * tour's own navigation unmounted this page and took the running tour with it,
 * which looked like the tour cutting off after one step.
 *
 * Instead this opens a replay session (a cookie) and navigates into the app.
 * TourHost, which lives in the (app) layout, picks the session up and renders
 * the tour there, so it survives every subsequent route change. The user's
 * historical completion or skip is untouched: replay writes no progress.
 */
export function WalkthroughReplay({ tours }: { tours: ReplayableTour[] }) {
  const router = useRouter();
  const [error, setError] = useState("");
  const [isPending, startTransition] = useTransition();

  if (tours.length === 0) {
    return (
      <EmptyState
        icon={PlayCircle}
        title="No walkthroughs available"
        description="Tours appear here as new Mad Buddy features launch."
      />
    );
  }

  const start = (tour: ReplayableTour) => {
    setError("");
    startTransition(async () => {
      const result = await startTourReplayAction({ versionId: tour.tourVersionId });
      if (!result.ok) {
        setError(result.message);
        return;
      }
      // Step 1 takes over routing from here if it declares a route of its own.
      router.push("/dashboard");
    });
  };

  return (
    <div className="space-y-3">
      {error ? <p className="rounded-xl bg-destructive/10 px-4 py-3 text-sm text-destructive">{error}</p> : null}

      {tours.map((tour) => (
        <Card key={tour.tourVersionId} className="flex items-center justify-between gap-4 p-4">
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold">{tour.title}</p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {tour.stepCount} {tour.stepCount === 1 ? "step" : "steps"}
              {tour.description ? ` · ${tour.description}` : ""}
            </p>
          </div>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="shrink-0"
            disabled={isPending}
            onClick={() => start(tour)}
          >
            {isPending ? "Starting..." : "Replay"}
          </Button>
        </Card>
      ))}

      <p className="text-xs text-muted-foreground">
        Replaying does not reset your history. Your original walkthrough progress stays as it is.
      </p>
    </div>
  );
}
