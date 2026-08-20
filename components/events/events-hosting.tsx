"use client";

import { useMemo } from "react";
import { CalendarPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { EventCompactRow, type EventCardFacts } from "@/components/events/event-cards";
import { AudienceChip, SectionLabel, formatAttendance } from "@/components/events/event-badges";
import { byStartAscending, describeEvent } from "@/lib/events/presentation";
import type { EventView } from "@/lib/events/mobile";

/**
 * Hosting -- reference panel 4.
 *
 * The host's own Events, which is a different job from attending: here the
 * useful facts are who can find it, how many said yes, and whether it is still
 * a draft. Answering an RSVP is not on this screen at all -- a host does not
 * RSVP to their own Event, and setEventRsvp refuses it server-side.
 *
 * Drafts lead, ahead of published Events. A draft is unfinished work with
 * nobody able to see it, so it is the thing most likely to need the host's
 * attention -- burying it under published Events is how drafts get forgotten.
 */

function toFacts(event: EventView, nowMs: number): EventCardFacts {
  const described = describeEvent(event, nowMs);
  return {
    id: event.id,
    name: event.name,
    coverUrl: event.coverUrl,
    focalX: event.focalX,
    focalY: event.focalY,
    venueLabel: event.venueLabel,
    locality: event.locality,
    goingCount: event.goingCount,
    isLive: described.isLive,
    whenLabel: described.whenLabel
  };
}

/** Going count plus audience: the two things a host checks at a glance. */
function HostMeta({ event }: { event: EventView }) {
  const attendance = formatAttendance(event.goingCount);
  return (
    <div className="flex shrink-0 items-center gap-2">
      {attendance ? <span className="text-xs text-muted-foreground">{attendance}</span> : null}
      <AudienceChip visibility={event.visibility} />
    </div>
  );
}

export function EventsHosting({
  events,
  nowMs,
  onOpen,
  onCreate,
  onResumeDraft
}: {
  events: EventView[];
  nowMs: number;
  onOpen: (eventId: string) => void;
  onCreate: () => void;
  /** Reopens the creation flow on an existing draft. */
  onResumeDraft: (eventId: string) => void;
}) {
  const { drafts, upcoming, past } = useMemo(() => {
    const mine = events.filter((event) => event.isHost);
    return {
      drafts: mine.filter((event) => event.status === "draft").sort(byStartAscending),
      upcoming: mine
        .filter((event) => event.status !== "draft" && !describeEvent(event, nowMs).isPast)
        .sort(byStartAscending),
      past: mine
        .filter((event) => event.status !== "draft" && describeEvent(event, nowMs).isPast)
        .sort((a, b) => byStartAscending(b, a))
    };
  }, [events, nowMs]);

  const total = drafts.length + upcoming.length + past.length;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          {total === 0
            ? "You have not created an event yet."
            : `${total} event${total === 1 ? "" : "s"} you host.`}
        </p>
        <Button size="sm" onClick={onCreate} className="shrink-0">
          <CalendarPlus className="mr-1.5 h-4 w-4" aria-hidden="true" />
          Create event
        </Button>
      </div>

      {total === 0 ? (
        <EmptyState
          title="Nothing hosted yet"
          description="Publish an event and choose exactly who should know about it."
          action={<Button onClick={onCreate}>Create your first event</Button>}
        />
      ) : null}

      {drafts.length > 0 ? (
        <section className="space-y-1">
          <SectionLabel className="px-1">Drafts</SectionLabel>
          <div className="divide-y divide-border/40">
            {drafts.map((event) => (
              <EventCompactRow
                key={event.id}
                facts={toFacts(event, nowMs)}
                /* A DRAFT OPENS THE CREATION FLOW, not the Event detail.
                 *
                 * THE BUG: Continue called onOpen, which opens the detail
                 * sheet. A draft with no cover renders almost nothing there,
                 * so the person got a dimmed screen with an effectively empty
                 * panel and no way to finish the Event. Resuming is a
                 * different job from viewing. */
                onOpen={() => onResumeDraft(event.id)}
                trailing={
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => onResumeDraft(event.id)}
                    className="shrink-0"
                  >
                    Continue
                  </Button>
                }
              />
            ))}
          </div>
          <p className="px-1 pt-1 text-xs text-muted-foreground">
            A draft is visible only to you until you publish it.
          </p>
        </section>
      ) : null}

      {upcoming.length > 0 ? (
        <section className="space-y-1">
          <SectionLabel className="px-1">Upcoming</SectionLabel>
          <div className="divide-y divide-border/40">
            {upcoming.map((event) => (
              <EventCompactRow
                key={event.id}
                facts={toFacts(event, nowMs)}
                onOpen={() => onOpen(event.id)}
                trailing={<HostMeta event={event} />}
              />
            ))}
          </div>
        </section>
      ) : null}

      {past.length > 0 ? (
        <section className="space-y-1">
          <SectionLabel className="px-1">Past events</SectionLabel>
          <div className="divide-y divide-border/40">
            {past.map((event) => (
              <EventCompactRow
                key={event.id}
                facts={toFacts(event, nowMs)}
                onOpen={() => onOpen(event.id)}
                trailing={<span className="shrink-0 text-xs text-muted-foreground">Completed</span>}
              />
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}
