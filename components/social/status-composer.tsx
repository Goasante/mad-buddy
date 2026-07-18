"use client";

import * as Dialog from "@radix-ui/react-dialog";
import * as Popover from "@radix-ui/react-popover";
import { Sparkles, X } from "lucide-react";
import { useEffect, useState, useTransition, type ReactNode } from "react";
import { clearStatusAction, setStatusAction } from "@/app/(app)/social-actions";
import { Button } from "@/components/ui/button";
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

// Below sm the anchored popover would risk running off-screen, so we switch to
// a bottom sheet. Defaults to desktop for SSR/first paint (the panel only
// renders on interaction, so there's no hydration mismatch on the trigger).
function useIsMobile(query = "(max-width: 639px)"): boolean {
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const mql = window.matchMedia(query);
    const update = () => setIsMobile(mql.matches);
    update();
    mql.addEventListener("change", update);
    return () => mql.removeEventListener("change", update);
  }, [query]);
  return isMobile;
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
  const isMobile = useIsMobile();
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

  const closeButton = (
    <button
      type="button"
      onClick={() => setOpen(false)}
      aria-label="Close status"
      className="focus-ring safe-motion -mr-1 grid h-11 w-11 shrink-0 place-items-center rounded-full text-muted-foreground hover:bg-secondary hover:text-foreground"
    >
      <X className="h-4 w-4" aria-hidden="true" />
    </button>
  );

  const body = (
    <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
      <div>
        <label htmlFor="status-availability" className="mb-1.5 block text-sm font-medium">
          Availability
        </label>
        <select
          id="status-availability"
          value={availability ?? ""}
          onChange={(event) => setAvailability(event.target.value as AvailabilityType)}
          className={fieldClass}
        >
          <option value="" disabled>
            Choose availability
          </option>
          {AVAILABILITY_TYPES.map((option) => (
            <option key={option} value={option}>
              {availabilityLabels[option]}
            </option>
          ))}
        </select>
        {attempted && !availability ? (
          <p className="mt-1 text-xs text-red-500">Choose your availability.</p>
        ) : null}
      </div>

      <div>
        <label htmlFor="status-activity" className="mb-1.5 block text-sm font-medium">
          Activity <span className="font-normal text-muted-foreground">(optional)</span>
        </label>
        <select
          id="status-activity"
          value={activity ?? "none"}
          onChange={(event) => setActivity(event.target.value === "none" ? null : (event.target.value as ActivityType))}
          className={fieldClass}
        >
          <option value="none">None</option>
          {ACTIVITY_TYPES.map((option) => (
            <option key={option} value={option}>
              {activityLabels[option]}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label htmlFor="status-duration" className="mb-1.5 block text-sm font-medium">
          Clear after
        </label>
        <select
          id="status-duration"
          value={durationId ?? ""}
          onChange={(event) => setDurationId(event.target.value)}
          className={fieldClass}
        >
          <option value="" disabled>
            Choose a duration
          </option>
          {STATUS_DURATION_PRESETS.map((option) => (
            <option key={option.id} value={option.id}>
              {durationLabel(option.id, option.label)}
            </option>
          ))}
        </select>
        {attempted && !durationId ? (
          <p className="mt-1 text-xs text-red-500">Choose when this status should clear.</p>
        ) : null}
      </div>

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
    </div>
  );

  const footer = (
    <div className="flex shrink-0 items-center justify-between gap-3 border-t border-border/60 px-5 py-4">
      {hasActiveStatus ? (
        <Button type="button" variant="ghost" size="sm" onClick={clear} disabled={isPending}>
          Clear status
        </Button>
      ) : (
        <span />
      )}
      <div className="flex gap-2">
        <Button type="button" variant="outline" size="sm" onClick={() => setOpen(false)} disabled={isPending}>
          Cancel
        </Button>
        <Button type="button" size="sm" onClick={save} disabled={isPending || !canSubmit}>
          {isPending ? "Saving..." : hasActiveStatus ? "Save changes" : "Save status"}
        </Button>
      </div>
    </div>
  );

  if (isMobile) {
    return (
      <Dialog.Root open={open} onOpenChange={handleOpenChange}>
        <Dialog.Trigger asChild>{trigger}</Dialog.Trigger>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm" />
          <Dialog.Content className="fixed inset-x-0 bottom-0 z-50 flex max-h-[86svh] flex-col rounded-t-2xl border-t border-border/70 bg-card pb-[env(safe-area-inset-bottom)] outline-none">
            <div className="flex shrink-0 items-start justify-between gap-4 border-b border-border/60 px-5 py-4">
              <div>
                <Dialog.Title className="text-base font-semibold">Set your status</Dialog.Title>
                <Dialog.Description className="mt-1 text-xs text-muted-foreground">
                  Let your Muddies know what you&apos;re up to.
                </Dialog.Description>
              </div>
              {closeButton}
            </div>
            {body}
            {footer}
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    );
  }

  return (
    <Popover.Root open={open} onOpenChange={handleOpenChange}>
      <Popover.Trigger asChild>{trigger}</Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="start"
          sideOffset={8}
          collisionPadding={16}
          className="z-50 flex max-h-[calc(100svh-32px)] w-[min(400px,calc(100vw-1.5rem))] flex-col rounded-2xl border border-border/70 bg-card shadow-lg outline-none"
        >
          <div className="flex shrink-0 items-start justify-between gap-4 border-b border-border/60 px-5 py-4">
            <div>
              <p className="text-base font-semibold">Set your status</p>
              <p className="mt-1 text-xs text-muted-foreground">Let your Muddies know what you&apos;re up to.</p>
            </div>
            {closeButton}
          </div>
          {body}
          {footer}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
