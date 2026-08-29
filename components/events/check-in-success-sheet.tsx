"use client";

import type { Route } from "next";
import { useRouter } from "next/navigation";
import { CheckCircle2, Users } from "lucide-react";
import { eventModeHref } from "@/lib/social/event-mode";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";

/**
 * Post-check-in success (Stage F UI, Part C).
 *
 * Uses the canonical Modal's `sheet` variant -- a bottom-anchored,
 * safe-area-padded, Back-dismissible sheet on phones that becomes a centred
 * dialog from `sm` up. No second sheet system was added for this.
 *
 * EVERY ACTION HERE IS OPTIONAL. Checking in is complete before this appears;
 * nothing below runs automatically, and "Done" is a first-class outcome
 * rather than a way of skipping something.
 */

export function CheckInSuccessSheet({
  open,
  onOpenChange,
  eventId,
  eventName,
  glowEnabled,
  onSeeMuddies
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  eventId: string;
  eventName: string;
  /** The viewer's own Event Glow state, so the copy cannot overclaim. */
  glowEnabled: boolean;
  onSeeMuddies: () => void;
}) {
  const router = useRouter();

  return (
    <Modal
      owner="CheckInSuccessSheet"
      open={open}
      onOpenChange={onOpenChange}
      variant="sheet"
      title="You're checked in"
      description={eventName}
    >
      <div className="space-y-3">
        <p className="flex items-center gap-2 text-sm font-medium text-[var(--color-brand-orange)]">
          <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden="true" />
          You&apos;re checked in.
        </p>

        {/* Privacy, stated only when it is actually true (§16). Saying
            "checking in doesn't share your presence" while the viewer HAS
            enabled Event Glow would be wrong, so the copy follows the real
            state rather than being decorative reassurance. */}
        <p className="text-xs leading-relaxed text-muted-foreground">
          {glowEnabled
            ? "Muddies who are also checked in can see you're here. You can turn that off any time."
            : "Checking in doesn't automatically share your presence."}
        </p>

        <div className="flex flex-col gap-2 pt-1">
          {/* Opens the existing Stage E presence experience. Not a second
              attendee list -- all its privacy rules stay authoritative. */}
          <Button type="button" variant="outline" className="justify-start" onClick={onSeeMuddies}>
            {/* This opens a list of PEOPLE at the event. The file already
                imports Users for exactly that, and the label says it too. */}
            <Users className="h-4 w-4" aria-hidden="true" />
            See Muddies here
          </Button>

          {/* The already-built Linkr Event Mode entry point. The server still
              re-checks the live check-in requirement; this link is only a
              request, never an authorisation. */}
          <Button
            type="button"
            variant="outline"
            className="justify-start"
            onClick={() => {
              onOpenChange(false);
              router.push(eventModeHref(eventId) as Route);
            }}
          >
            <Users className="h-4 w-4" aria-hidden="true" />
            Meet people nearby
          </Button>

          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
            Done
          </Button>
        </div>
      </div>
    </Modal>
  );
}
