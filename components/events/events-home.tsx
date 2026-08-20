"use client";

import { useMemo } from "react";
import { EmptyState } from "@/components/ui/empty-state";
import { Button } from "@/components/ui/button";
import { CalendarPlus } from "lucide-react";
import { EventCompactRow, EventHeroCard, type EventCardFacts } from "@/components/events/event-cards";
import { SectionLabel, formatAttendance } from "@/components/events/event-badges";
import { byStartAscending, describeEvent, pickHeroEvent } from "@/lib/events/presentation";
import type { EventView } from "@/lib/events/mobile";

/**
 * Events Home -- "what's happening".
 *
 * Reference panel 1. The shape of this screen is an argument: one big alive
 * thing at the top, then a scannable list of what is coming, then what is
 * local. It replaces a tab strip over a uniform list, which gave a live Event
 * and a fortnight-away Event exactly the same visual weight.
 *
 * Only ONE hero per surface. A second full-bleed card would make neither read
 * as the headline.
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

export function EventsHome({
  events,
  nowMs,
  onOpen,
  onCreate,
  onSeeAll
}: {
  events: EventView[];
  nowMs: number;
  onOpen: (eventId: string) => void;
  onCreate: () => void;
  onSeeAll: () => void;
}) {
  const { hero, upcoming, nearYou } = useMemo(() => {
    const current = events.filter((event) => !describeEvent(event, nowMs).isPast);
    const heroEvent = pickHeroEvent(current, nowMs);
    const rest = current.filter((event) => event.id !== heroEvent?.id).sort(byStartAscending);
    // Capped: Home is a summary surface, and "See all" exists for the rest.
    const upcoming = rest.slice(0, 5);
    const shown = new Set(upcoming.map((event) => event.id));

    return {
      hero: heroEvent,
      upcoming,
      /* NEAR YOU on Home means "has a published locality" -- the Event's own
       * geography, never the viewer's. The Discover surface runs the real
       * proximity query; Home only previews that such Events exist.
       *
       * EXCLUDES WHAT UPCOMING ALREADY SHOWED. Both sections drew from the same
       * list, so a local Event in the next few days appeared twice on one
       * screen -- which made the page look padded and made "Near you" look like
       * it had nothing of its own to say. This section now earns its place only
       * when it can show something new. */
      nearYou: rest.filter((event) => event.locality && !shown.has(event.id)).slice(0, 3)
    };
  }, [events, nowMs]);

  if (!hero) {
    return (
      <EmptyState
        title="Nothing on yet"
        description="When you or your Muddies publish an event, it shows up here."
        action={
          <Button onClick={onCreate}>
            <CalendarPlus className="mr-2 h-4 w-4" aria-hidden="true" />
            Create an event
          </Button>
        }
      />
    );
  }

  const heroFacts = toFacts(hero, nowMs);
  const heroAttendance = formatAttendance(hero.goingCount);

  return (
    <div className="space-y-8">
      <section className="space-y-3" aria-labelledby="events-happening">
        <SectionLabel className="px-1">
          <span id="events-happening">What&apos;s happening</span>
        </SectionLabel>
        <EventHeroCard
          facts={heroFacts}
          onOpen={() => onOpen(hero.id)}
          footer={
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-white/80">
              {heroAttendance ? <span className="font-medium text-white/90">{heroAttendance}</span> : null}
              <span>{heroFacts.whenLabel}</span>
              {hero.myRsvp === "going" ? (
                <span className="rounded-full bg-white/15 px-2 py-0.5 text-xs font-medium text-white">
                  You&apos;re going
                </span>
              ) : null}
            </div>
          }
        />
      </section>

      {upcoming.length > 0 ? (
        <section className="space-y-1" aria-labelledby="events-upcoming">
          <div className="flex items-baseline justify-between px-1">
            <SectionLabel>
              <span id="events-upcoming">Upcoming for you</span>
            </SectionLabel>
            <Button variant="ghost" size="sm" onClick={onSeeAll} className="-mr-2 h-8 text-xs">
              See all
            </Button>
          </div>
          <div className="divide-y divide-border/40">
            {upcoming.map((event) => (
              <EventCompactRow key={event.id} facts={toFacts(event, nowMs)} onOpen={() => onOpen(event.id)} />
            ))}
          </div>
        </section>
      ) : null}

      {nearYou.length > 0 ? (
        <section className="space-y-1" aria-labelledby="events-near">
          <SectionLabel className="px-1">
            <span id="events-near">Near you</span>
          </SectionLabel>
          <div className="divide-y divide-border/40">
            {nearYou.map((event) => (
              <EventCompactRow key={event.id} facts={toFacts(event, nowMs)} onOpen={() => onOpen(event.id)} />
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}
