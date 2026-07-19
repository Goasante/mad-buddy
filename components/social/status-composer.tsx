"use client";

import { Sparkles } from "lucide-react";
import { useState, useTransition, type ReactNode } from "react";
import { clearStatusAction, setStatusAction } from "@/app/(app)/social-actions";
import { Button } from "@/components/ui/button";
import { AppSelect } from "@/components/ui/app-dropdown";
import { ResponsiveFormPopover } from "@/components/ui/responsive-form-popover";
import {
  ACTIVITY_TYPES,
  AVAILABILITY_TYPES,
  STATUS_DURATION_PRESETS,
  STATUS_MAX_TEXT_LENGTH,
  activityLabels,
  availabilityLabels
} from "@/lib/social/rules";
import type { ActivityType, AvailabilityType } from "@/lib/supabase/database.types";

export type StatusComposerProps = {
  /** The button that opens the status surface; wired as the popover/sheet trigger. */
  trigger: ReactNode;
  onSaved?: (result: { message: string; expiresAt?: string }) => void;
  initialAvailability?: AvailabilityType;
  initialActivity?: ActivityType | null;
  initialNote?: string;
  hasActiveStatus?: boolean;
};

function resolveExpiry(presetMs: number): string {
  if (presetMs === -1) {
    // "End of day" → 23:59 local today.
    const end = new Date();
    end.setHours(23, 59, 0, 0);
    return end.toISOString();
  }
  return new Date(Date.now() + presetMs).toISOString();
}

function durationLabel(id: string, label: string): string {
  // Present the "until tonight" preset as "End of day" without touching the
  // stored preset id or its expiry math.
  return id === "tonight" ? "End of day" : label;
}

const fieldClass = "focus-ring safe-motion h-11 w-full rounded-md border border-border bg-card/70 px-3 text-sm";

export function StatusComposer({
  trigger,
  onSaved,
  initialAvailability,
  initialActivity = null,
  initialNote = "",
  hasActiveStatus = false
}: StatusComposerProps) {
  const [open, setOpen] = useState(false);
  const [availability, setAvailability] = useState<AvailabilityType | null>(null);
  const [activity, setActivity] = useState<ActivityType | null>(initialActivity);
  const [note, setNote] = useState(initialNote);
  const [durationId, setDurationId] = useState<string | null>(null);
  const [noteFocused, setNoteFocused] = useState(false);
  const [attempted, setAttempted] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [isPending, startTransition] = useTransition();

  const canSubmit = Boolean(availability && durationId);

  // Reset the draft each time the surface opens: prefill from the active status
  // when editing, otherwise start empty. Duration is never preselected.
  function prepare() {
    setAvailability(hasActiveStatus ? initialAvailability ?? null : null);
    setActivity(hasActiveStatus ? initialActivity : null);
    setNote(hasActiveStatus ? initialNote : "");
    setDurationId(null);
    setNoteFocused(false);
    setAttempted(false);
    setFeedback("");
  }

  function handleOpenChange(next: boolean) {
    if (next) prepare();
    setOpen(next);
  }

  function save() {
    setAttempted(true);
    if (!availability || !durationId) return;
    const preset = STATUS_DURATION_PRESETS.find((option) => option.id === durationId);
    if (!preset) return;
    setFeedback("");
    const expiresAt = resolveExpiry(preset.ms);
    startTransition(async () => {
      const result = await setStatusAction({
        availabilityType: availability,
        activityType: activity,
        customText: note.trim() || undefined,
        expiresAt
      });
      if (result.ok) {
        onSaved?.({ message: result.message, expiresAt });
        setOpen(false);
      } else {
        setFeedback("Couldn’t update your status. Try again.");
      }
    });
  }

  function clear() {
    setFeedback("");
    startTransition(async () => {
      const result = await clearStatusAction();
      if (result.ok) {
        onSaved?.({ message: "Status cleared" });
        setOpen(false);
      } else {
        setFeedback("Couldn’t update your status. Try again.");
      }
    });
  }

  const body = (
    <>
      <AppSelect
        id="status-availability"
        label="Availability"
        size="compact"
        value={availability}
        options={AVAILABILITY_TYPES.map((option) => ({ value: option, label: availabilityLabels[option] }))}
        placeholder="Choose availability"
        error={attempted && !availability ? "Choose your availability." : undefined}
        onChange={setAvailability}
      />

      <AppSelect
        id="status-activity"
        label="Activity (optional)"
        size="compact"
        value={activity ?? "none"}
        options={[
          { value: "none", label: "None" },
          ...ACTIVITY_TYPES.map((option) => ({ value: option, label: activityLabels[option] }))
        ]}
        onChange={(next) => setActivity(next === "none" ? null : next as ActivityType)}
      />

      <AppSelect
        id="status-duration"
        label="Clear after"
        size="compact"
        value={durationId}
        options={STATUS_DURATION_PRESETS.map((option) => ({ value: option.id, label: durationLabel(option.id, option.label) }))}
        placeholder="Choose a duration"
        error={attempted && !durationId ? "Choose when this status should clear." : undefined}
        onChange={setDurationId}
      />

      <div>
        <label htmlFor="status-note" className="mb-1.5 block text-sm font-medium">
          Add a note <span className="font-normal text-muted-foreground">(optional)</span>
        </label>
        <input
          id="status-note"
          type="text"
          value={note}
          maxLength={STATUS_MAX_TEXT_LENGTH}
          onChange={(event) => setNote(event.target.value)}
          onFocus={() => setNoteFocused(true)}
          onBlur={() => setNoteFocused(false)}
          placeholder="Free later, anyone around?"
          className={fieldClass}
        />
        {noteFocused || note.length > 0 ? (
          <p className="mt-1 text-xs text-muted-foreground">
            {note.length}/{STATUS_MAX_TEXT_LENGTH}
          </p>
        ) : null}
      </div>

      <p className="flex items-start gap-2 text-xs text-muted-foreground">
        <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" aria-hidden="true" />
        Only approved Muddies can see your status. It&apos;s hidden while Ghost Mode is on.
      </p>

      {feedback ? (
        <p className="text-xs font-medium text-red-500" role="alert">
          {feedback}
        </p>
      ) : null}
    </>
  );

  const footer = (
    <>
      {hasActiveStatus ? (
        <Button type="button" variant="ghost" size="sm" onClick={clear} disabled={isPending}>
          Clear status
        </Button>
      ) : (
        <Button type="button" variant="outline" size="sm" onClick={() => setOpen(false)} disabled={isPending}>
          Cancel
        </Button>
      )}
      <Button type="button" size="sm" onClick={save} disabled={isPending || !canSubmit}>
        {isPending ? "Saving..." : hasActiveStatus ? "Save changes" : "Save status"}
      </Button>
    </>
  );

  return (
    <ResponsiveFormPopover
      open={open}
      onOpenChange={handleOpenChange}
      trigger={trigger}
      title="Set your status"
      description="Let your Muddies know what you're up to."
      closeLabel="Close status form"
      footer={footer}
      align="start"
      widthClassName="w-[360px]"
      compact
      alwaysPopover
    >
      {body}
    </ResponsiveFormPopover>
  );
}
