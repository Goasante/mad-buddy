"use client";

import { Sparkles } from "lucide-react";
import { useState, useTransition } from "react";

import { setProfileInterestsAction } from "@/app/(app)/profile-interests-actions";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Modal } from "@/components/ui/modal";
import {
  CANONICAL_INTERESTS,
  MAX_INTERESTS,
  type DisplayInterest,
  toDisplayInterests
} from "@/lib/profile/interests";
import { cn } from "@/lib/utils";

/**
 * Interests — display and editing.
 *
 * The whole selection is saved at once. Saving per chip would mean a tap on
 * the eighth interest could fail on its own and leave the person looking at a
 * set they did not choose; a single save either lands or does not.
 *
 * Legacy values (anything stored before the taxonomy) render as selected and
 * removable but are not offered as new choices, so a set converges on the
 * taxonomy through ordinary editing rather than through a migration.
 */
export function ProfileInterestsCard({
  interests,
  open = false,
  onOpenChange,
  onSaved
}: {
  interests: string[];
  /** Controlled by the parent, so the completion card's interests task can
   *  open this picker directly. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  onSaved?: () => void;
}) {
  const display = toDisplayInterests(interests);

  /* Open state lives with the parent, which also owns the completion card's
     "Choose a few interests" CTA. One owner means no effect syncing two
     copies of the same boolean. */
  const [draft, setDraft] = useState<string[]>(() => display.map((item) => item.value));
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const legacy = display.filter((item) => !item.canonical);
  /* Legacy values stay selectable in the picker so they can be removed, but
   * they sit after the canonical list rather than being mixed into it. */
  const choices: DisplayInterest[] = [
    ...CANONICAL_INTERESTS.map((value) => ({ value, canonical: true })),
    ...legacy
  ];

  function changeOpen(next: boolean) {
    onOpenChange?.(next);
  }

  /* Opening always reseeds the draft from what is actually saved, so a
     cancelled edit is genuinely discarded. */
  function openEditor() {
    setDraft(display.map((item) => item.value));
    setError(null);
    changeOpen(true);
  }

  function toggle(value: string) {
    setError(null);
    setDraft((current) => {
      if (current.includes(value)) return current.filter((item) => item !== value);
      if (current.length >= MAX_INTERESTS) {
        setError(`That's the most you can pick — remove one to add another.`);
        return current;
      }
      return [...current, value];
    });
  }

  function save() {
    setError(null);
    startTransition(async () => {
      const result = await setProfileInterestsAction({ interests: draft });
      if (!result.ok) {
        // The editor stays open with the draft intact so the choice is not
        // lost to a failed request.
        setError(result.message);
        return;
      }
      changeOpen(false);
      onSaved?.();
    });
  }

  return (
    <section aria-labelledby="profile-interests-heading">
      <div className="mb-2 flex items-center justify-between gap-3">
        <h3
          id="profile-interests-heading"
          className="text-xs font-semibold uppercase tracking-wide text-muted-foreground"
        >
          Interests
        </h3>
        <button
          type="button"
          onClick={openEditor}
          className=// min-w-11 as well as min-h-11: the label is often just "Add", which
          // left the control 39px wide. The negative margin keeps the label
          // visually where it was while the tappable box grows around it.
          "focus-ring -mx-2 inline-flex min-h-11 min-w-11 items-center justify-center rounded px-2 text-xs font-semibold text-primary"
        >
          {display.length > 0 ? "Edit" : "Add"}
        </button>
      </div>

      <Card className="p-4 sm:p-5">
        {display.length > 0 ? (
          <ul className="flex flex-wrap gap-2">
            {display.map((item) => (
              <li key={item.value}>
                <span className="inline-flex items-center rounded-full border border-primary/25 bg-primary/10 px-3 py-1.5 text-sm font-medium text-primary">
                  {item.value}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <button
            type="button"
            onClick={openEditor}
            /* min-h-11 (44px): the empty-state row inviting a new user to add
               interests. At 430px width the text stops wrapping and the row
               collapses to 40px, so the floor matters more on LARGER phones
               here, not smaller ones. */
            className="focus-ring flex min-h-11 w-full items-center gap-3 rounded-xl text-left"
          >
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-primary/10 text-primary">
              <Sparkles className="h-5 w-5" aria-hidden="true" />
            </span>
            <span className="min-w-0">
              <span className="block text-sm font-semibold">Add your interests</span>
              <span className="mt-0.5 block text-xs text-muted-foreground">
                A few things you&apos;re into, so Muddies know where to start.
              </span>
            </span>
          </button>
        )}
      </Card>

      <Modal
        open={open}
        onOpenChange={(next) => {
          // A cancel throws the draft away; reopening starts from what is
          // actually saved.
          if (!pending) changeOpen(next);
        }}
        title="Your interests"
        description={`Pick up to ${MAX_INTERESTS}.`}
        variant="sheet"
        footer={
          <div className="flex items-center justify-between gap-3">
            <span aria-live="polite" className="text-xs text-muted-foreground">
              {draft.length} of {MAX_INTERESTS}
            </span>
            <div className="flex gap-2">
              <Button type="button" variant="ghost" onClick={() => changeOpen(false)} disabled={pending}>
                Cancel
              </Button>
              <Button type="button" onClick={save} disabled={pending}>
                {pending ? "Saving..." : "Save"}
              </Button>
            </div>
          </div>
        }
      >
        <div className="grid gap-3">
          {error ? (
            <p className="rounded-xl border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive" role="alert">
              {error}
            </p>
          ) : null}

          <ul className="flex flex-wrap gap-2">
            {choices.map((choice) => {
              const selected = draft.includes(choice.value);
              return (
                <li key={choice.value}>
                  <button
                    type="button"
                    onClick={() => toggle(choice.value)}
                    aria-pressed={selected}
                    disabled={pending}
                    className={cn(
                      "focus-ring safe-motion rounded-full border px-3 py-1.5 text-sm font-medium",
                      selected
                        ? "border-primary/40 bg-primary/15 text-primary"
                        : "border-border/70 bg-card/50 text-foreground hover:bg-secondary/40",
                      pending && "opacity-60"
                    )}
                  >
                    {choice.value}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      </Modal>
    </section>
  );
}
