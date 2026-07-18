"use client";

import { useState, useTransition } from "react";
import { Sparkles } from "lucide-react";
import { clearStatusAction, setStatusAction } from "@/app/(app)/social-actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import {
  ACTIVITY_TYPES,
  AVAILABILITY_TYPES,
  STATUS_DURATION_PRESETS,
  STATUS_MAX_TEXT_LENGTH,
  activityLabels,
  availabilityLabels
} from "@/lib/social/rules";
import type { ActivityType, AvailabilityType } from "@/lib/supabase/database.types";
import { cn } from "@/lib/utils";

export type StatusComposerProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved?: (message: string) => void;
  initialAvailability?: AvailabilityType;
  initialActivity?: ActivityType | null;
  initialNote?: string;
  hasActiveStatus?: boolean;
};

function resolveExpiry(presetMs: number): string {
  if (presetMs === -1) {
    // "Until tonight" → 23:59 local today.
    const end = new Date();
    end.setHours(23, 59, 0, 0);
    return end.toISOString();
  }
  return new Date(Date.now() + presetMs).toISOString();
}

export function StatusComposer({
  open,
  onOpenChange,
  onSaved,
  initialAvailability = "free",
  initialActivity = null,
  initialNote = "",
  hasActiveStatus = false
}: StatusComposerProps) {
  const [availability, setAvailability] = useState<AvailabilityType>(initialAvailability);
  const [activity, setActivity] = useState<ActivityType | null>(initialActivity);
  const [note, setNote] = useState(initialNote);
  const [durationId, setDurationId] = useState("2h");
  const [feedback, setFeedback] = useState("");
  const [isPending, startTransition] = useTransition();

  function save() {
    const preset = STATUS_DURATION_PRESETS.find((option) => option.id === durationId);
    if (!preset) return;
    setFeedback("");
    startTransition(async () => {
      const result = await setStatusAction({
        availabilityType: availability,
        activityType: activity,
        customText: note.trim() || undefined,
        expiresAt: resolveExpiry(preset.ms)
      });
      if (result.ok) {
        onSaved?.(result.message);
        onOpenChange(false);
      } else {
        setFeedback(result.message);
      }
    });
  }

  function clear() {
    setFeedback("");
    startTransition(async () => {
      const result = await clearStatusAction();
      if (result.ok) {
        onSaved?.(result.message);
        onOpenChange(false);
      } else {
        setFeedback(result.message);
      }
    });
  }

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title={hasActiveStatus ? "Update your status" : "Set your status"}
      description="Let your Muddies know if you're around."
    >
      <div className="max-h-[65vh] space-y-5 overflow-y-auto pr-1">
        <fieldset>
          <legend className="mb-2 text-sm font-medium">Availability</legend>
          <div className="flex flex-wrap gap-2">
            {AVAILABILITY_TYPES.map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => setAvailability(option)}
                aria-pressed={availability === option}
                className={cn(
                  "focus-ring safe-motion rounded-full border px-3 py-1.5 text-sm font-medium",
                  availability === option
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-border text-muted-foreground hover:bg-secondary"
                )}
              >
                {availabilityLabels[option]}
              </button>
            ))}
          </div>
        </fieldset>

        <fieldset>
          <legend className="mb-2 text-sm font-medium">Activity (optional)</legend>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setActivity(null)}
              aria-pressed={activity === null}
              className={cn(
                "focus-ring safe-motion rounded-full border px-3 py-1.5 text-sm font-medium",
                activity === null ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:bg-secondary"
              )}
            >
              None
            </button>
            {ACTIVITY_TYPES.map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => setActivity(option)}
                aria-pressed={activity === option}
                className={cn(
                  "focus-ring safe-motion rounded-full border px-3 py-1.5 text-sm font-medium",
                  activity === option ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:bg-secondary"
                )}
              >
                {activityLabels[option]}
              </button>
            ))}
          </div>
        </fieldset>

        <div>
          <label htmlFor="status-note" className="mb-1.5 block text-sm font-medium">
            Custom note (optional)
          </label>
          <Input
            id="status-note"
            value={note}
            maxLength={STATUS_MAX_TEXT_LENGTH}
            onChange={(event) => setNote(event.target.value)}
            placeholder="At the library until 6"
          />
          <p className="mt-1 text-xs text-muted-foreground">{note.length}/{STATUS_MAX_TEXT_LENGTH}</p>
        </div>

        <fieldset>
          <legend className="mb-2 text-sm font-medium">Clear after</legend>
          <div className="flex flex-wrap gap-2">
            {STATUS_DURATION_PRESETS.map((option) => (
              <button
                key={option.id}
                type="button"
                onClick={() => setDurationId(option.id)}
                aria-pressed={durationId === option.id}
                className={cn(
                  "focus-ring safe-motion rounded-full border px-3 py-1.5 text-sm font-medium",
                  durationId === option.id ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:bg-secondary"
                )}
              >
                {option.label}
              </button>
            ))}
          </div>
        </fieldset>

        <p className="flex items-start gap-2 text-xs text-muted-foreground">
          <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" aria-hidden="true" />
          Only approved Muddies can see your status. It&apos;s hidden while Ghost Mode is on.
        </p>

        {feedback ? <p className="text-sm text-red-500" role="status">{feedback}</p> : null}
      </div>

      <div className="mt-5 flex justify-between gap-3">
        {hasActiveStatus ? (
          <Button type="button" variant="ghost" onClick={clear} disabled={isPending}>
            Clear status
          </Button>
        ) : (
          <span />
        )}
        <div className="flex gap-2">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={isPending}>
            Cancel
          </Button>
          <Button type="button" onClick={save} disabled={isPending}>
            {isPending ? "Saving..." : hasActiveStatus ? "Update status" : "Set status"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
