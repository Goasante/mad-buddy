"use client";

import { Ghost, ShieldCheck, Sparkles, UserCheck, Users, UsersRound } from "lucide-react";
import { useMemo, useState, useTransition } from "react";
import {
  endVisibilitySessionAction,
  startVisibilitySessionAction
} from "@/app/(app)/circles-actions";
import { updateVisibilityStatusAction } from "@/app/(app)/settings-actions";
import { Button } from "@/components/ui/button";
import { SettingsSubHeader } from "@/components/settings/settings-sub-header";
import type { VisibilityMode, VisibilityStatus } from "@/lib/supabase/database.types";
import { cn } from "@/lib/utils";

type Circle = { id: string; name: string; icon: string | null };
type Duration = "30m" | "1h" | "3h" | "until_hide";

type ActiveSession = {
  visibilityMode: VisibilityMode;
  endsAt: string | null;
  circleIds: string[];
};

const audienceOptions: Array<{ id: VisibilityMode; label: string; description: string; icon: typeof Users }> = [
  { id: "all_muddies", label: "All Muddies", description: "Every approved Muddy can see you.", icon: UsersRound },
  { id: "close_friends", label: "Close Friends", description: "Only your close friends.", icon: UserCheck },
  { id: "selected_circles", label: "Circles", description: "People in your selected circles.", icon: Users },
  { id: "hidden", label: "Hidden", description: "No one sees your Glow.", icon: ShieldCheck }
];

const durationOptions: Array<{ id: Duration; label: string; ms: number | null }> = [
  { id: "30m", label: "30 mins", ms: 30 * 60 * 1000 },
  { id: "1h", label: "1 hour", ms: 60 * 60 * 1000 },
  { id: "3h", label: "3 hours", ms: 3 * 60 * 60 * 1000 },
  { id: "until_hide", label: "Until I change it", ms: null }
];

export function GlowVisibilityPage({
  initialVisibilityStatus = "visible",
  circles = [],
  activeSession = null
}: {
  initialVisibilityStatus?: VisibilityStatus;
  circles?: Circle[];
  activeSession?: ActiveSession | null;
}) {
  const [visibilityStatus, setVisibilityStatus] = useState(initialVisibilityStatus);
  const [audience, setAudience] = useState<VisibilityMode>(activeSession?.visibilityMode ?? "all_muddies");
  const [duration, setDuration] = useState<Duration>("until_hide");
  const [selectedCircleIds, setSelectedCircleIds] = useState<string[]>(activeSession?.circleIds ?? []);
  const [feedback, setFeedback] = useState("");
  const [hasActiveSession, setHasActiveSession] = useState(Boolean(activeSession));
  const [isPending, startTransition] = useTransition();
  const isPaused = visibilityStatus === "ghost";

  const canApply = useMemo(() => {
    if (audience === "selected_circles") return selectedCircleIds.length > 0;
    return true;
  }, [audience, selectedCircleIds]);

  function toggleGlow() {
    const next: VisibilityStatus = isPaused ? "visible" : "ghost";
    setVisibilityStatus(next);
    startTransition(async () => {
      const result = await updateVisibilityStatusAction(next);
      setFeedback(result.message);
    });
  }

  function toggleCircle(id: string) {
    setSelectedCircleIds((prev) => (prev.includes(id) ? prev.filter((c) => c !== id) : [...prev, id]));
  }

  function applyVisibility() {
    const chosen = durationOptions.find((option) => option.id === duration);
    const endsAt = chosen?.ms ? new Date(Date.now() + chosen.ms).toISOString() : null;
    startTransition(async () => {
      const result = await startVisibilitySessionAction({
        featureType: "glow",
        visibilityMode: audience,
        circleIds: audience === "selected_circles" ? selectedCircleIds : undefined,
        endsAt
      });
      setFeedback(result.message);
      if (result.ok) setHasActiveSession(true);
    });
  }

  function resetVisibility() {
    startTransition(async () => {
      const result = await endVisibilitySessionAction("glow");
      setFeedback(result.message);
      if (result.ok) {
        setHasActiveSession(false);
        setAudience("all_muddies");
        setSelectedCircleIds([]);
      }
    });
  }

  return (
    <div className="mr-auto max-w-[640px] space-y-6 pt-6">
      <div className="flex items-center justify-between gap-3">
        <SettingsSubHeader title="Glow & Visibility" description="Control who can see you and for how long." />
      </div>

      <div className="flex items-center justify-between rounded-xl border border-border/70 bg-card/50 px-4 py-3">
        <span className={cn("inline-flex items-center gap-1.5 text-sm font-semibold", isPaused ? "text-muted-foreground" : "text-primary")}>
          <Sparkles className="h-4 w-4" aria-hidden="true" />
          {isPaused ? "Glow paused" : "Glow active"}
        </span>
        <Button type="button" variant={isPaused ? "primary" : "outline"} size="sm" onClick={toggleGlow} disabled={isPending}>
          <Ghost className="h-4 w-4" aria-hidden="true" />
          {isPaused ? "Resume Glow" : "Pause Glow"}
        </Button>
      </div>
      {feedback ? <p className="text-sm text-muted-foreground" role="status">{feedback}</p> : null}

      <section>
        <h2 className="mb-3 text-sm font-semibold">Who can see your Glow</h2>
        <div className="grid grid-cols-2 gap-3">
          {audienceOptions.map((option) => (
            <button
              key={option.id}
              type="button"
              onClick={() => setAudience(option.id)}
              aria-pressed={audience === option.id}
              className={cn(
                "focus-ring safe-motion rounded-xl border p-3 text-left",
                audience === option.id
                  ? "border-primary bg-primary/10"
                  : "border-border hover:bg-secondary"
              )}
            >
              <option.icon className={cn("h-4 w-4", audience === option.id ? "text-primary" : "text-muted-foreground")} aria-hidden="true" />
              <p className="mt-2 text-sm font-semibold">{option.label}</p>
              <p className="mt-0.5 text-xs text-muted-foreground">{option.description}</p>
            </button>
          ))}
        </div>
      </section>

      {audience === "selected_circles" ? (
        <section>
          <h2 className="mb-3 text-sm font-semibold">Which circles?</h2>
          {circles.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              You don&apos;t have any circles yet. Create one from your Muddies list first.
            </p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {circles.map((circle) => (
                <button
                  key={circle.id}
                  type="button"
                  onClick={() => toggleCircle(circle.id)}
                  aria-pressed={selectedCircleIds.includes(circle.id)}
                  className={cn(
                    "focus-ring safe-motion rounded-full border px-4 py-2 text-sm font-medium",
                    selectedCircleIds.includes(circle.id)
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border text-muted-foreground hover:bg-secondary"
                  )}
                >
                  {circle.icon ? `${circle.icon} ` : ""}
                  {circle.name}
                </button>
              ))}
            </div>
          )}
        </section>
      ) : null}

      <section>
        <h2 className="mb-3 text-sm font-semibold">For how long?</h2>
        <div className="flex flex-wrap gap-2">
          {durationOptions.map((option) => (
            <button
              key={option.id}
              type="button"
              onClick={() => setDuration(option.id)}
              aria-pressed={duration === option.id}
              className={cn(
                "focus-ring safe-motion rounded-full border px-4 py-2 text-sm font-medium",
                duration === option.id
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-border text-muted-foreground hover:bg-secondary"
              )}
            >
              {option.label}
            </button>
          ))}
        </div>
      </section>

      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" variant="primary" size="sm" onClick={applyVisibility} disabled={isPending || !canApply}>
          Apply visibility
        </Button>
        {hasActiveSession ? (
          <Button type="button" variant="outline" size="sm" onClick={resetVisibility} disabled={isPending}>
            Reset to all Muddies
          </Button>
        ) : null}
      </div>

      <div className="flex items-start gap-3 rounded-xl border border-border/70 bg-card/50 p-4">
        <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-primary" aria-hidden="true" />
        <div>
          <p className="text-sm font-semibold">Privacy guarantee</p>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            Your exact location is never shown. Only a general glow signal is shared with your chosen audience.
          </p>
        </div>
      </div>
    </div>
  );
}
