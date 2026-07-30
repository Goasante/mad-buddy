"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { cloneTourVersionAction, setTourAudienceAction, setTourStatusAction } from "@/app/(admin)/admin/tours/actions";
import { startTourPreviewAction } from "@/app/(admin)/admin/tours/preview-actions";
import { canTransition, type AdminTourStatus } from "@/lib/tours/admin-model";
import { cn } from "@/lib/utils";

const PLANS = [
  { key: "free", label: "Free" },
  { key: "buddy_plus", label: "Buddy Plus" },
  { key: "buddy_pro", label: "Buddy Pro" }
] as const;

const COHORTS = [
  { key: "all", label: "All users" },
  { key: "new", label: "New users" },
  { key: "existing", label: "Existing users" }
] as const;

/**
 * Lifecycle + audience controls for one tour version.
 *
 * Buttons are hidden rather than disabled when a transition is illegal, so the
 * UI cannot suggest an action the server will refuse. The server re-checks the
 * permission, the transition and the validation regardless — this is
 * presentation only.
 */
export function TourVersionControls({
  versionId,
  status,
  plans,
  cohort
}: {
  versionId: string;
  status: AdminTourStatus;
  plans: string[];
  cohort: "all" | "new" | "existing";
}) {
  const router = useRouter();
  const [reason, setReason] = useState("");
  const [selectedPlans, setSelectedPlans] = useState<string[]>(plans);
  const [selectedCohort, setSelectedCohort] = useState(cohort);
  const [feedback, setFeedback] = useState<{ ok: boolean; message: string } | null>(null);
  const [isPending, startTransition] = useTransition();

  const run = (action: () => Promise<{ ok: boolean; message: string }>) => {
    setFeedback(null);
    startTransition(async () => setFeedback(await action()));
  };

  const isDraft = status === "draft";

  return (
    <div className="space-y-3">
      {feedback ? (
        <p
          className={cn(
            "rounded-xl px-4 py-3 text-sm",
            feedback.ok ? "bg-emerald-500/10 text-emerald-800 dark:text-emerald-100" : "bg-destructive/10 text-destructive"
          )}
          role="status"
        >
          {feedback.message}
        </p>
      ) : null}

      <Card className="space-y-3 p-4">
        {canTransition(status, "published") ? (
          <div className="space-y-2">
            <label htmlFor="publish-reason" className="block text-sm font-medium">
              {status === "paused" ? "Reason for resuming" : "Reason for publishing"}
            </label>
            <Input
              id="publish-reason"
              value={reason}
              maxLength={280}
              placeholder="Introduce the new Socialize experience"
              onChange={(event) => setReason(event.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              Recorded in the admin audit log. Publishing makes this version eligible for everyone matching its audience.
            </p>
          </div>
        ) : null}

        <div className="flex flex-wrap gap-2">
          {canTransition(status, "published") ? (
            <Button type="button" size="sm" disabled={isPending || reason.trim().length < 3} onClick={() => run(() => setTourStatusAction({ versionId, to: "published", reason }))}>
              {status === "paused" ? "Resume" : "Publish"}
            </Button>
          ) : null}
          {canTransition(status, "paused") ? (
            <Button type="button" size="sm" variant="outline" disabled={isPending} onClick={() => run(() => setTourStatusAction({ versionId, to: "paused" }))}>
              Pause
            </Button>
          ) : null}
          {canTransition(status, "retired") ? (
            <Button type="button" size="sm" variant="outline" disabled={isPending} onClick={() => run(() => setTourStatusAction({ versionId, to: "retired" }))}>
              Retire
            </Button>
          ) : null}
          <Button type="button" size="sm" variant="outline" disabled={isPending} onClick={() => run(() => cloneTourVersionAction({ sourceVersionId: versionId }))}>
            Create next version
          </Button>
          {/* Draft preview: opens a permission-checked preview session and drops
              into the real consumer renderer inside the real app shell, so
              route-aware steps and live spotlights behave exactly as they will
              for users. Records no progress and emits no consumer analytics. */}
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={isPending}
            onClick={() => {
              setFeedback(null);
              startTransition(async () => {
                const started = await startTourPreviewAction({
                  versionId,
                  returnTo: `/admin/tours/${versionId}`
                });
                if (!started.ok) {
                  setFeedback(started);
                  return;
                }
                // Step 1's own route takes over from here if it declares one.
                router.push("/dashboard");
              });
            }}
          >
            Preview draft
          </Button>
        </div>

        <p className="text-xs text-muted-foreground">
          Retired is final. To show this tour again, create the next version — existing completion history stays intact and
          everyone becomes eligible for the new version.
        </p>
      </Card>

      <Card className="space-y-3 p-4">
        <p className="text-sm font-medium">Audience</p>
        {!isDraft ? (
          <p className="text-xs text-muted-foreground">
            A published version&apos;s audience is fixed, so recorded completions keep meaning what they meant. Create the next
            version to change targeting.
          </p>
        ) : null}
        <div className="flex flex-wrap gap-1.5">
          {PLANS.map((plan) => {
            const active = selectedPlans.includes(plan.key);
            return (
              <button
                key={plan.key}
                type="button"
                disabled={!isDraft || isPending}
                aria-pressed={active}
                onClick={() =>
                  setSelectedPlans((current) =>
                    current.includes(plan.key) ? current.filter((item) => item !== plan.key) : [...current, plan.key]
                  )
                }
                className={cn(
                  "focus-ring safe-motion min-h-9 rounded-full border px-3 py-1.5 text-xs font-medium disabled:opacity-60",
                  active ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground"
                )}
              >
                {plan.label}
              </button>
            );
          })}
        </div>
        <div className="flex flex-wrap gap-1.5">
          {COHORTS.map((option) => (
            <button
              key={option.key}
              type="button"
              disabled={!isDraft || isPending}
              aria-pressed={selectedCohort === option.key}
              onClick={() => setSelectedCohort(option.key)}
              className={cn(
                "focus-ring safe-motion min-h-9 rounded-full border px-3 py-1.5 text-xs font-medium disabled:opacity-60",
                selectedCohort === option.key ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground"
              )}
            >
              {option.label}
            </button>
          ))}
        </div>
        {isDraft ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={isPending || selectedPlans.length === 0}
            onClick={() => run(() => setTourAudienceAction({ versionId, plans: selectedPlans, cohort: selectedCohort }))}
          >
            Save audience
          </Button>
        ) : null}
      </Card>
    </div>
  );
}
