"use client";

import { useRouter } from "next/navigation";
import type { Route } from "next";
import { PageSectionHeader } from "@/components/app-shell/page-section-header";
import { RankedEventsAccordion } from "@/components/events/ranked-events-accordion";
import type { RankedEvent } from "@/lib/events/ranked-events";

/**
 * Home's Top Events module (Ranked Events Discovery).
 *
 * Renders nothing at all when there is no ranking. Home already carries an
 * empty state for Plans and for Near; a third "no events yet" placeholder
 * would push the sections the viewer actually has further down the page for
 * no information gain. An absent module is the honest answer when the
 * ranking is genuinely empty -- and because ranking never fabricates events,
 * a fresh install legitimately has none.
 */
export function TopEventsHome({ events }: { events: RankedEvent[] }) {
  const router = useRouter();

  if (events.length === 0) return null;

  return (
    <section aria-labelledby="home-top-events-heading">
      <PageSectionHeader
        id="home-top-events-heading"
        title="Trending"
        href="/events/top"
        actionAriaLabel="See top events"
      />
      <RankedEventsAccordion
        events={events}
        // Opens the CANONICAL event detail, the same ?event= deep link the
        // events page and notification routing already use. Discovery hands
        // off to the real surface rather than reimplementing it.
        onOpenEvent={(event) => router.push(`/events?event=${event.id}` as Route)}
      />
    </section>
  );
}
