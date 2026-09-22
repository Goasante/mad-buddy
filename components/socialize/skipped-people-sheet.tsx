"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { Loader2, RotateCcw, X } from "lucide-react";
import { useEffect, useState, useTransition } from "react";

import { loadSkippedPeopleAction, undoPassAction } from "@/app/(app)/social-actions";
import { UserAvatar } from "@/components/ui/user-avatar";
import { skipExpiryLabel, type SkippedPerson } from "@/lib/social/skipped-people-shared";

/**
 * The people you skipped, and a way back.
 *
 * A left swipe is easy to trigger by accident on a touch surface. The in-deck
 * undo only ever held the LAST skip, in React state — reload the page or skip
 * someone else and it was gone, leaving that person unreachable for 30 days.
 * The rows always existed; this is the missing way to look at them.
 *
 * Loaded on OPEN rather than with the page: most sessions never need this, and
 * fetching a list nobody asks for costs every visit a query.
 *
 * What it deliberately does not show: presence, proximity or activity. Those
 * describe where somebody is right now, and recovering a card must not become
 * a way to watch a person you are not currently being shown.
 */

export function SkippedPeopleSheet({
  open,
  onOpenChange,
  onRestored
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called after a successful undo, so the deck can pick the person back up. */
  onRestored: () => void;
}) {
  const [people, setPeople] = useState<SkippedPerson[] | null>(null);
  const [isPending, startTransition] = useTransition();

  /**
   * Clear the previous list the moment the sheet opens.
   *
   * Derived during render rather than set inside the effect: resetting in the
   * effect would paint one frame of the PREVIOUS session's list before the
   * loading state appeared — briefly showing people who may since have been
   * restored or expired.
   */
  const [wasOpen, setWasOpen] = useState(open);
  if (wasOpen !== open) {
    setWasOpen(open);
    if (open) setPeople(null);
  }

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    // Re-fetched on every open: a skip made since the last look should appear,
    // and one that expired should not.
    void loadSkippedPeopleAction().then((result) => {
      if (!cancelled) setPeople(result);
    });
    return () => {
      cancelled = true;
    };
  }, [open]);

  function restore(person: SkippedPerson) {
    // Optimistic: the row leaves the list immediately and returns if the
    // delete fails, so the list never disagrees with the server for long.
    setPeople((current) => current?.filter((item) => item.userId !== person.userId) ?? null);
    startTransition(async () => {
      const result = await undoPassAction(person.userId);
      if (result.ok) {
        onRestored();
      } else {
        setPeople((current) => (current ? [person, ...current] : [person]));
      }
    });
  }

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        {/* The canonical sheet chrome, matching Quick Controls: bottom sheet
            on a phone, centred panel from sm up. */}
        <Dialog.Overlay className="modal-drop-overlay fixed inset-0 z-[60] bg-black/50 backdrop-blur-md" />
        <Dialog.Content
          aria-describedby="skipped-people-description"
          className="modal-sheet-panel fixed inset-x-0 bottom-0 z-[61] flex max-h-[calc(92svh-env(safe-area-inset-top,0px))] w-full flex-col overflow-hidden rounded-t-[2rem] border border-b-0 border-border/80 bg-card pb-[max(1rem,env(safe-area-inset-bottom))] shadow-[0_-18px_60px_hsl(var(--shadow)/0.28)] outline-none sm:inset-x-auto sm:bottom-auto sm:left-1/2 sm:top-16 sm:max-h-[calc(100svh-5rem)] sm:w-[calc(100%-1.5rem)] sm:max-w-[26rem] sm:-translate-x-1/2 sm:rounded-[1.5rem] sm:border sm:pb-4"
        >
          <div className="flex items-start justify-between gap-3 px-5 pt-5">
            <div className="min-w-0">
              <Dialog.Title className="text-[1.0625rem] font-semibold tracking-tight">
                People you skipped
              </Dialog.Title>
              <Dialog.Description
                id="skipped-people-description"
                className="mt-1 text-[0.8125rem] leading-relaxed text-muted-foreground"
              >
                {/* States the promise rather than leaving it to be discovered:
                    a skip lapses on its own, and it was never visible to them. */}
                Skipping is private — they were never told. Everyone here comes
                back on their own, or you can bring them back now.
              </Dialog.Description>
            </div>
            <Dialog.Close
              aria-label="Close"
              className="focus-ring -mr-2 -mt-2 grid h-11 w-11 shrink-0 place-items-center rounded-full text-muted-foreground hover:bg-secondary/50 hover:text-foreground"
            >
              <X className="h-5 w-5" aria-hidden="true" />
            </Dialog.Close>
          </div>

          <div className="max-h-[60vh] overflow-y-auto px-5 pb-6 pt-4">
            {people === null ? (
              <p className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />
                Loading…
              </p>
            ) : people.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">
                You haven&rsquo;t skipped anyone.
              </p>
            ) : (
              <ul className="flex flex-col gap-1">
                {people.map((person) => (
                  <li key={person.userId} className="flex items-center gap-3 rounded-2xl px-1 py-2">
                    <UserAvatar src={person.avatarUrl} name={person.displayName} size="sm" decorative />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[0.9375rem] font-medium">{person.displayName}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        {skipExpiryLabel(person.expiresAt)}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => restore(person)}
                      disabled={isPending}
                      aria-label={`Bring ${person.displayName} back`}
                      className="focus-ring safe-motion inline-flex min-h-[38px] shrink-0 items-center gap-1.5 rounded-full border border-border/60 px-3 text-[0.8125rem] font-semibold transition-colors hover:bg-secondary/50 disabled:opacity-50"
                    >
                      <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
                      Undo
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
