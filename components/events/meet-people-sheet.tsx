"use client";

import { useState, useTransition } from "react";
import { Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { setEventLinkrConsentAction } from "@/app/(app)/event-actions";
import { eventModeHref } from "@/lib/social/event-mode";

/**
 * The consent step between being at an Event and being discoverable there.
 *
 * Checking in says "I am here". Event Glow says "let my Muddies know". Neither
 * of those is "show my profile to people I have never met", so this asks for
 * that separately and stores it separately. The sheet exists precisely so the
 * decision is made deliberately rather than inherited from arriving.
 */
export function MeetPeopleSheet({
  eventId,
  eventName,
  open,
  consented,
  poolLabel,
  onOpenChange,
  onConsentChange
}: {
  eventId: string;
  eventName: string;
  open: boolean;
  consented: boolean;
  poolLabel: string | null;
  onOpenChange: (open: boolean) => void;
  onConsentChange: (enabled: boolean) => void;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function decide(enabled: boolean) {
    setError(null);
    startTransition(async () => {
      const result = await setEventLinkrConsentAction(eventId, enabled);
      if (!result.ok) {
        // Server refusal must never paint as success -- the person would think
        // they were discoverable when they are not, or the reverse.
        setError(result.message);
        return;
      }
      onConsentChange(enabled);
      onOpenChange(false);
      if (enabled) window.location.href = eventModeHref(eventId);
    });
  }

  /* TWO DISTINCT STATES, NOT ONE SHEET WITH EVERY BUTTON.
   *
   * Before consent this is a decision: explain it, then ask. After consent it
   * is a door plus a way out. Showing "Turn off" beside a first-time ask, or
   * re-explaining the promise to somebody who already agreed, muddles a
   * privacy decision with routine navigation. */
  return (
    <Modal
      owner="MeetPeopleSheet"
      open={open}
      onOpenChange={onOpenChange}
      title={consented ? "Meet people here" : `Meet people at ${eventName}`}
      description={
        consented
          ? "You're open to connecting with people at this event."
          : "Discover people at this event who are also open to connecting."
      }
      variant="sheet"
    >
      <div className="space-y-4">
        {!consented ? (
          <ul className="space-y-2 text-sm leading-6 text-muted-foreground">
            <li>Only people who choose this can discover one another here.</li>
            <li>Your exact location is never shown.</li>
            <li>You can turn it off at any time.</li>
          </ul>
        ) : null}

        {consented && poolLabel ? <p className="text-sm font-medium">{poolLabel}</p> : null}

        {error ? (
          <p role="alert" className="text-sm font-medium text-destructive">
            {error}
          </p>
        ) : null}

        {!consented ? (
          <div className="flex flex-wrap justify-end gap-2">
            <Button type="button" variant="ghost" disabled={pending} onClick={() => onOpenChange(false)}>
              Not now
            </Button>
            <Button type="button" disabled={pending} onClick={() => decide(true)}>
              <Users className="h-4 w-4" aria-hidden="true" />
              {pending ? "Saving..." : "I'm open to meeting people"}
            </Button>
          </div>
        ) : (
          <div className="space-y-2">
            <Button
              type="button"
              className="w-full justify-center"
              disabled={pending}
              onClick={() => (window.location.href = eventModeHref(eventId))}
            >
              Open Linkr
            </Button>
            {/* Withdrawal is always available and never harder to reach than
                granting was, but it is not the primary action here. */}
            <Button
              type="button"
              variant="ghost"
              className="w-full justify-center"
              disabled={pending}
              aria-label="Turn off event discovery"
              onClick={() => decide(false)}
            >
              {pending ? "Saving..." : "Turn off event discovery"}
            </Button>
          </div>
        )}
      </div>
    </Modal>
  );
}
