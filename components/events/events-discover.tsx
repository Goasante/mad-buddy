"use client";

import { useEffect, useMemo, useState } from "react";
import { nearbyEventIdsAction } from "@/app/(app)/event-actions";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { EmptyState } from "@/components/ui/empty-state";
import { EventCompactRow, EventDiscoveryCard, type EventCardFacts } from "@/components/events/event-cards";
import { SectionLabel } from "@/components/events/event-badges";
import {
  DISCOVER_FILTERS,
  applyDiscoverFilter,
  describeEvent,
  searchEvents,
  type DiscoverFilterId
} from "@/lib/events/presentation";
import type { EventView } from "@/lib/events/mobile";
import { cn } from "@/lib/utils";

/**
 * Discover -- reference panel 2.
 *
 * Browsing, as distinct from Home's summary: search, four real segments, then
 * featured cards with a live section broken out. Every segment is a genuine
 * predicate (see applyDiscoverFilter); none is decoration.
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

export function EventsDiscover({
  events,
  nowMs,
  onOpen
}: {
  events: EventView[];
  nowMs: number;
  onOpen: (eventId: string) => void;
}) {
  const [filter, setFilter] = useState<DiscoverFilterId>("for_you");
  const [query, setQuery] = useState("");

  /* REAL PROXIMITY, NOT "HAS A LOCALITY" (4K §19-22).
   *
   * This segment used to select every Event with a published locality, so in
   * one city it matched everything -- a heading promising proximity over a
   * list unrelated to where the viewer stood.
   *
   *   undefined -> not asked yet
   *   null      -> asked, and there is no fresh location to answer with
   *   string[]  -> the Events genuinely within the canonical 5km, nearest first
   *
   * The distinction between null and [] is the whole point: one means "we
   * cannot tell you", the other "there is nothing near you". Collapsing them
   * would turn a location prompt into a false empty state. */
  const [nearbyIds, setNearbyIds] = useState<string[] | null | undefined>(undefined);

  useEffect(() => {
    if (filter !== "near_you") return;
    let cancelled = false;
    void (async () => {
      const ids = await nearbyEventIdsAction(events.map((event) => event.id));
      if (!cancelled) setNearbyIds(ids);
    })();
    return () => {
      cancelled = true;
    };
  }, [filter, events]);

  /* How many Events earn a full-size featured card.
   *
   * One on a phone, two once there is a second column. Starts at 1 so the
   * server render and the first client paint agree -- widening then adds the
   * second card, which is a smaller correction than removing one.
   *
   * 640px is Tailwind's `sm`, matching the grid below it. */
  const [featuredSlots, setFeaturedSlots] = useState(1);
  useEffect(() => {
    // Named wide, not `query` -- the search box already owns that name in this
    // component, and shadowing it here would be a trap for the next reader.
    const wide = window.matchMedia("(min-width: 640px)");
    const sync = () => setFeaturedSlots(wide.matches ? 2 : 1);
    sync();
    wide.addEventListener("change", sync);
    return () => wide.removeEventListener("change", sync);
  }, []);

  const { featured, live, rest } = useMemo(() => {
    let filtered = applyDiscoverFilter(searchEvents(events, query), filter, nowMs);

    /* Near you is the one segment answered by the SERVER, because only the
     * server may see where the viewer is. Ordered nearest-first, and never
     * widened when the result is thin -- fewer Events is the honest answer. */
    if (filter === "near_you") {
      if (!nearbyIds) {
        filtered = [];
      } else {
        const order = new Map(nearbyIds.map((id, index) => [id, index]));
        filtered = filtered
          .filter((event) => order.has(event.id))
          .sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
      }
    }
    const liveOnes = filtered.filter((event) => describeEvent(event, nowMs).isLive);
    const notLive = filtered.filter((event) => !describeEvent(event, nowMs).isLive);
    /* The featured slot shows a live Event when there is one -- on a discovery
     * surface, something happening right now is the most interesting thing
     * available.
     *
     * ONE on a phone, TWO from sm up (4J §15). Two stacked 16:9 cards filled an
     * entire 390px viewport before "More events" appeared, so the surface felt
     * empty rather than full of things to explore -- the opposite of what a
     * discovery screen is for.
     *
     * Capped by MEASURED VIEWPORT rather than by a CSS class, so the Event that
     * loses its featured card genuinely moves into "More events" instead of
     * being hidden in one place and duplicated in the other. */
    const head = (liveOnes.length > 0 ? [...liveOnes, ...notLive] : notLive).slice(0, featuredSlots);
    const headIds = new Set(head.map((event) => event.id));
    return {
      featured: head,
      live: liveOnes.filter((event) => !headIds.has(event.id)),
      rest: notLive.filter((event) => !headIds.has(event.id))
    };
  }, [events, featuredSlots, filter, nearbyIds, nowMs, query]);

  const activeLabel = DISCOVER_FILTERS.find((entry) => entry.id === filter)?.label ?? "";

  return (
    <div className="space-y-5">
      <div className="relative">
        <Search
          className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden="true"
        />
        <Input
          value={query}
          onChange={(changeEvent) => setQuery(changeEvent.target.value)}
          placeholder="Search events"
          aria-label="Search events by name or venue"
          className="pl-9"
        />
      </div>

      {/* Segments are a radiogroup, not buttons: exactly one is active, and a
          screen reader should announce the selection, not just the press. */}
      <div
        role="radiogroup"
        aria-label="Filter events"
        className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {DISCOVER_FILTERS.map((entry) => {
          const active = entry.id === filter;
          return (
            <button
              key={entry.id}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => setFilter(entry.id)}
              className={cn(
                "min-h-[2.25rem] shrink-0 rounded-full px-3.5 text-sm font-medium transition",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary",
                active
                  ? "bg-primary text-primary-foreground shadow-sm"
                  : "bg-secondary/60 text-muted-foreground hover:bg-secondary"
              )}
            >
              {entry.label}
            </button>
          );
        })}
      </div>

      {featured.length === 0 && live.length === 0 && rest.length === 0 ? (
        filter === "near_you" && nearbyIds === null ? (
          /* NO FRESH LOCATION. Not an empty result -- an unanswerable question.
             Saying "nothing near you" here would be a claim we cannot make. */
          <EmptyState
            title="See events around you"
            description="Update your location to find events happening nearby. Your exact location is never shown to anyone."
          />
        ) : filter === "near_you" && nearbyIds === undefined ? (
          <EmptyState title="Looking around you…" description="Checking which events are nearby." />
        ) : (
          <EmptyState
            title={
              query
                ? "No events match that"
                : filter === "near_you"
                  ? "Nothing near you right now"
                  : `Nothing under ${activeLabel} yet`
            }
            description={
              query
                ? "Try a different name or venue."
                : filter === "near_you"
                  ? "Events further away still show up under For you and Trending."
                  : "Check another filter, or look again a little later."
            }
          />
        )
      ) : null}

      {featured.length > 0 ? (
        <section className="space-y-3">
          <SectionLabel>{filter === "trending" ? "Trending" : "Featured"}</SectionLabel>
          {/* Two-up from sm: a discovery grid may widen, unlike the detail
              view. A single phone-width column stretched across a desktop is
              the failure mode this avoids. */}
          <div className="grid gap-3 sm:grid-cols-2">
            {featured.map((event) => (
              <EventDiscoveryCard key={event.id} facts={toFacts(event, nowMs)} onOpen={() => onOpen(event.id)} />
            ))}
          </div>
        </section>
      ) : null}

      {live.length > 0 ? (
        <section className="space-y-1">
          <SectionLabel>Happening now</SectionLabel>
          <div className="divide-y divide-border/40">
            {live.map((event) => (
              <EventCompactRow key={event.id} facts={toFacts(event, nowMs)} onOpen={() => onOpen(event.id)} />
            ))}
          </div>
        </section>
      ) : null}

      {rest.length > 0 ? (
        <section className="space-y-1">
          <SectionLabel>{filter === "near_you" ? "Near you" : "More events"}</SectionLabel>
          <div className="divide-y divide-border/40">
            {rest.map((event) => (
              <EventCompactRow key={event.id} facts={toFacts(event, nowMs)} onOpen={() => onOpen(event.id)} />
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}
