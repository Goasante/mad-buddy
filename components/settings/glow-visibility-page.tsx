"use client";

import { Ghost, ShieldCheck, Sparkles, UserCheck, Users, UsersRound } from "lucide-react";
import { useState, useTransition } from "react";
import { updateVisibilityStatusAction } from "@/app/(app)/settings-actions";
import { Button } from "@/components/ui/button";
import { SettingsSubHeader } from "@/components/settings/settings-sub-header";
import type { VisibilityStatus } from "@/lib/supabase/database.types";
import { cn } from "@/lib/utils";

type Audience = "approved" | "close" | "circles" | "custom";
type Duration = "30m" | "1h" | "3h" | "until_hide" | "custom";

const audienceOptions: Array<{ id: Audience; label: string; description: string; icon: typeof Users }> = [
  { id: "approved", label: "Approved Muddies", description: "Only people you've approved.", icon: UsersRound },
  { id: "close", label: "Close Friends", description: "Only your close friends.", icon: UserCheck },
  { id: "circles", label: "Circles", description: "People in your selected circles.", icon: Users },
  { id: "custom", label: "Custom", description: "Choose specific people.", icon: ShieldCheck }
];

const durationOptions: Array<{ id: Duration; label: string }> = [
  { id: "30m", label: "30 mins" },
  { id: "1h", label: "1 hour" },
  { id: "3h", label: "3 hours" },
  { id: "until_hide", label: "Until I hide" },
  { id: "custom", label: "Custom" }
];

export function GlowVisibilityPage({ initialVisibilityStatus = "visible" }: { initialVisibilityStatus?: VisibilityStatus }) {
  const [visibilityStatus, setVisibilityStatus] = useState(initialVisibilityStatus);
  const [audience, setAudience] = useState<Audience>("approved");
  const [duration, setDuration] = useState<Duration>("1h");
  const [feedback, setFeedback] = useState("");
  const [, startTransition] = useTransition();
  const isPaused = visibilityStatus === "ghost";

  function toggleGlow() {
    const next: VisibilityStatus = isPaused ? "visible" : "ghost";
    setVisibilityStatus(next);
    startTransition(async () => {
      const result = await updateVisibilityStatusAction(next);
      setFeedback(result.message);
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
        <Button type="button" variant={isPaused ? "primary" : "outline"} size="sm" onClick={toggleGlow}>
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
