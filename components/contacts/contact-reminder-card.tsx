"use client";

import { UserPlus, Users, X } from "lucide-react";
import { useState, useTransition } from "react";

import {
  dismissContactReminderAction,
  stopContactRemindersAction
} from "@/app/(app)/contact-actions";
import { Button } from "@/components/ui/button";
import { haptic } from "@/lib/device/haptics";
import type { ContactReminderKind } from "@/lib/contacts/reminder-eligibility";

/**
 * The Contact Discovery reminder.
 *
 * A CARD, not a modal. This is an offer, and an offer that blocks the screen
 * reads as a demand -- the point is that it can be ignored by simply scrolling
 * past it.
 *
 * IT CANNOT REACH CONTACTS. The primary action opens the Slice 3 setup sheet,
 * which shows its explanation and only then, on a further deliberate tap,
 * invokes the picker. Nothing here calls `navigator.contacts`, and a test
 * asserts that directly: a reminder that produced an OS permission dialog
 * would be the worst possible version of this feature.
 *
 * Two variants, because two different things may be missing -- a number, or
 * the contact step. Asking somebody to connect contacts before they have a
 * number would be out of order.
 */
export function ContactReminderCard({
  kind,
  onOpenSetup,
  onResolved
}: {
  kind: ContactReminderKind;
  /** Opens the existing setup flow. The ONLY route to contact access. */
  onOpenSetup: () => void;
  /** Called once dismissed, so the surface can stop rendering this. */
  onResolved: () => void;
}) {
  const [showStopOption, setShowStopOption] = useState(false);
  const [isPending, startTransition] = useTransition();

  const isPhonePrompt = kind === "add_phone";

  function dismiss() {
    // Very light: an acknowledgement, not an event.
    haptic("close");
    startTransition(async () => {
      const result = await dismissContactReminderAction();
      // After the last allowed dismissal the server says so, and the card
      // offers the permanent option rather than silently never returning.
      if (result.message) setShowStopOption(true);
      else onResolved();
    });
  }

  function stopAsking() {
    startTransition(async () => {
      await stopContactRemindersAction();
      onResolved();
    });
  }

  function openSetup() {
    haptic("tick");
    onOpenSetup();
  }

  if (showStopOption) {
    return (
      <section
        aria-labelledby="contact-reminder-stop-heading"
        className="rounded-2xl border border-border/80 bg-card/60 p-4"
      >
        <h2 id="contact-reminder-stop-heading" className="text-sm font-semibold">
          Stop asking about this?
        </h2>
        <p className="mt-1 text-xs leading-5 text-muted-foreground">
          {/* States plainly that nothing is being switched off. */}
          You can always find people from your contacts later in Settings.
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button type="button" size="sm" variant="outline" disabled={isPending} onClick={stopAsking}>
            Don&rsquo;t ask again
          </Button>
          <Button type="button" size="sm" variant="ghost" disabled={isPending} onClick={onResolved}>
            Keep reminding me
          </Button>
        </div>
      </section>
    );
  }

  return (
    <section
      aria-labelledby="contact-reminder-heading"
      className="relative rounded-2xl border border-border/80 bg-card/60 p-4"
    >
      {/* A quiet dismiss in the corner, so the card can be cleared without
          reading it -- the same weight as Maybe later, and equally harmless. */}
      <button
        type="button"
        onClick={dismiss}
        disabled={isPending}
        aria-label="Dismiss this suggestion"
        className="focus-ring absolute right-2 top-2 grid h-9 w-9 place-items-center rounded-full text-muted-foreground hover:bg-secondary/50"
      >
        <X className="h-4 w-4" aria-hidden="true" />
      </button>

      <div className="flex items-start gap-3 pr-9">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-primary/10 text-primary">
          {isPhonePrompt ? (
            <UserPlus className="h-5 w-5" aria-hidden="true" />
          ) : (
            <Users className="h-5 w-5" aria-hidden="true" />
          )}
        </span>

        <div className="min-w-0 flex-1">
          <h2 id="contact-reminder-heading" className="text-sm font-semibold">
            {isPhonePrompt ? "Help your Muddies find you" : "Find people you already know"}
          </h2>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            {isPhonePrompt
              ? // No mention of verification, security or login: none of those
                // exist here, and implying them would be a false claim.
                "Add your number so people who already have you saved can find you. It won't appear on your profile."
              : "Mad Buddy can privately match selected contacts with people already here."}
          </p>

          <div className="mt-3 flex flex-wrap gap-2">
            <Button type="button" size="sm" disabled={isPending} onClick={openSetup}>
              {isPhonePrompt ? "Add number" : "Find my Muddies"}
            </Button>
            <Button type="button" size="sm" variant="ghost" disabled={isPending} onClick={dismiss}>
              Maybe later
            </Button>
          </div>
        </div>
      </div>
    </section>
  );
}
