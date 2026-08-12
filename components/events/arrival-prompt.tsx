"use client";

import { useState } from "react";
import { Loader2, MapPin } from "lucide-react";
import { fallbackGradient, resolveEventMedia } from "@/lib/events/event-media";
import { focalObjectPosition } from "@/lib/events/cover";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

/**
 * "Are you here?" (Stage F UI, Part B).
 *
 * ONE component, rendered wherever the server says the viewer is eligible --
 * Home and the Event detail both use this, so there is exactly one arrival
 * presentation and exactly one eligibility implementation. This component
 * does NOT decide eligibility: resolveArrivalPrompt already did, server-side,
 * and the UI only renders the result.
 *
 * Deliberately a compact card, not a takeover: the app noticing that
 * something you committed to is happening should feel like a nudge, not an
 * advertisement.
 */

export type ArrivalEvent = {
  id: string;
  name: string;
  venueLabel: string | null;
  coverUrl: string | null;
  focalX: number;
  focalY: number;
};

export function ArrivalPrompt({
  event,
  pending = false,
  onCheckIn,
  onNotYet
}: {
  event: ArrivalEvent;
  pending?: boolean;
  onCheckIn: () => void;
  onNotYet: () => void;
}) {
  // Duplicate-tap protection (§14): the button disables the instant it is
  // pressed, and stays disabled until the parent's transition resolves.
  const [submitted, setSubmitted] = useState(false);
  const busy = pending || submitted;
  const media = resolveEventMedia(event.id, event.coverUrl);

  return (
    <Card className="flex items-center gap-3 p-3" data-testid="arrival-prompt">
      <span
        aria-hidden="true"
        className="relative h-16 w-[3.25rem] shrink-0 overflow-hidden rounded-xl"
        style={media.kind === "fallback" ? { backgroundImage: fallbackGradient(media.treatment) } : undefined}
      >
        {media.kind === "image" ? (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img
            src={media.url}
            alt=""
            loading="lazy"
            decoding="async"
            style={{ objectPosition: focalObjectPosition(event.focalX, event.focalY) }}
            className="h-full w-full object-cover"
          />
        ) : null}
      </span>

      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold leading-tight">Are you here?</p>
        <p className="mt-0.5 truncate text-xs text-muted-foreground">
          {event.name} is happening now.
        </p>
        {event.venueLabel ? (
          <p className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
            <MapPin className="h-3 w-3 shrink-0" aria-hidden="true" />
            <span className="truncate">{event.venueLabel}</span>
          </p>
        ) : null}

        <div className="mt-2 flex flex-wrap gap-2">
          <Button
            type="button"
            size="sm"
            disabled={busy}
            onClick={() => {
              setSubmitted(true);
              onCheckIn();
            }}
          >
            {busy ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" aria-hidden="true" />
            ) : null}
            Check in
          </Button>
          {/* "Not yet" only dismisses. It never touches the RSVP, never marks
              not going, never checks in, never enables Event Glow. */}
          <Button type="button" size="sm" variant="outline" disabled={busy} onClick={onNotYet}>
            Not yet
          </Button>
        </div>
      </div>
    </Card>
  );
}
