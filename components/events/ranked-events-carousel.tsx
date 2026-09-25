"use client";

import { useCallback, useRef, useState } from "react";
import { ChevronRight, MapPin } from "lucide-react";

import { EventArtwork } from "@/components/events/event-artwork";
import { nextTrendingIndex, trendingSwipeDirection } from "@/lib/events/trending-carousel";
import type { RankedEvent } from "@/lib/events/ranked-events";

function startLabel(startsAt: string): string {
  return new Date(startsAt).toLocaleString([], {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit"
  });
}

/** Home's image-led view over the existing, server-ranked top five Events. */
export function RankedEventsCarousel({
  events,
  onOpenEvent
}: {
  events: RankedEvent[];
  onOpenEvent: (event: RankedEvent) => void;
}) {
  const [activeId, setActiveId] = useState<string | null>(null);
  const touchStart = useRef<{ x: number; y: number } | null>(null);
  const suppressClick = useRef(false);

  // Identity, rather than an index, survives a fresh ranking or a cover update.
  const activeIndex = Math.max(0, events.findIndex((event) => event.id === activeId));
  const event = events[activeIndex];

  const move = useCallback((direction: -1 | 1) => {
    setActiveId((current) => {
      const index = Math.max(0, events.findIndex((item) => item.id === current));
      return events[nextTrendingIndex(index, events.length, direction)]?.id ?? null;
    });
  }, [events]);

  if (!event) return null;

  return (
    <div className="relative isolate mx-auto w-full max-w-[52rem] overflow-hidden rounded-[1.75rem] bg-[#191a1e] shadow-[0_18px_50px_-28px_rgba(0,0,0,0.7)]">
      <button
        type="button"
        className="focus-ring relative block h-[19rem] w-full touch-pan-y overflow-hidden rounded-[1.75rem] text-left sm:h-[23rem]"
        aria-label={`Open trending event ${activeIndex + 1} of ${events.length}: ${event.name}`}
        onClick={() => {
          if (suppressClick.current) {
            suppressClick.current = false;
            return;
          }
          onOpenEvent(event);
        }}
        onTouchStart={(touchEvent) => {
          const touch = touchEvent.touches[0];
          if (touch) touchStart.current = { x: touch.clientX, y: touch.clientY };
        }}
        onTouchEnd={(touchEvent) => {
          const start = touchStart.current;
          touchStart.current = null;
          const touch = touchEvent.changedTouches[0];
          if (!start || !touch) return;
          const direction = trendingSwipeDirection(touch.clientX - start.x, touch.clientY - start.y);
          if (direction === 0 || events.length < 2) return;
          // A swipe changes the card; its synthetic click must not open it.
          touchEvent.preventDefault();
          suppressClick.current = true;
          window.setTimeout(() => { suppressClick.current = false; }, 350);
          move(direction);
        }}
        onTouchCancel={() => { touchStart.current = null; }}
        onKeyDown={(keyboardEvent) => {
          if (keyboardEvent.key === "ArrowRight" || keyboardEvent.key === "ArrowLeft") {
            keyboardEvent.preventDefault();
            move(keyboardEvent.key === "ArrowRight" ? 1 : -1);
          }
        }}
      >
        {/* Key by event: a cover recovery or load state must never leak from
            one ranked Event into another when the active card changes. */}
        <EventArtwork
          key={event.id}
          eventId={event.id}
          coverUrl={event.media.kind === "image" ? event.media.url : null}
          coverExpected={event.hasCover}
          loading="eager"
          focalX={event.focalPoint.x}
          focalY={event.focalPoint.y}
          className="absolute inset-0 h-full w-full rounded-[1.75rem]"
        />
        <span aria-hidden="true" className="absolute inset-0 bg-[linear-gradient(180deg,rgba(0,0,0,0.35)_0%,rgba(0,0,0,0.05)_36%,rgba(0,0,0,0.82)_100%)]" />
        <span className="absolute left-5 top-5 rounded-full border border-white/25 bg-black/30 px-3 py-1.5 text-[0.6875rem] font-bold uppercase tracking-[0.14em] text-white backdrop-blur-sm sm:left-7 sm:top-7">
          #{event.rank} trending
        </span>
        <span className="absolute inset-x-5 bottom-12 flex flex-col gap-1 text-white sm:inset-x-7 sm:bottom-14">
          <span className="line-clamp-2 text-[1.65rem] font-bold leading-tight tracking-tight drop-shadow-[0_2px_12px_rgba(0,0,0,0.75)] sm:text-3xl">{event.name}</span>
          <span className="text-sm font-medium text-white/90">{startLabel(event.startsAt)}</span>
          {event.venueLabel ? (
            <span className="flex items-center gap-1 text-xs text-white/85">
              <MapPin className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <span className="truncate">{event.venueLabel}</span>
            </span>
          ) : null}
          {event.goingCount > 0 || event.interestedCount > 0 || event.isHost || event.myRsvp === "going" || event.myRsvp === "interested" ? (
            <span className="flex flex-wrap items-center gap-x-2 text-xs font-medium text-white/85">
              {event.goingCount > 0 ? <span>{event.goingCount} going</span> : null}
              {event.interestedCount > 0 ? <span>{event.interestedCount} interested</span> : null}
              {event.isHost ? <span className="text-[#ffc247]">You&apos;re hosting</span>
                : event.myRsvp === "going" ? <span className="text-[#ffc247]">You&apos;re going</span>
                : event.myRsvp === "interested" ? <span className="text-[#ffc247]">Interested</span>
                : null}
            </span>
          ) : null}
        </span>
      </button>

      {events.length > 1 ? (
        <>
          <button
            type="button"
            onClick={() => move(1)}
            aria-label="Next trending event"
            className="focus-ring absolute right-4 top-4 grid h-11 w-11 place-items-center rounded-full border border-white/30 bg-black/40 text-white backdrop-blur-sm transition-colors hover:bg-black/65 sm:right-6 sm:top-6"
          >
            <ChevronRight className="h-5 w-5" aria-hidden="true" />
          </button>
          <div className="absolute inset-x-0 bottom-1 flex justify-center" role="group" aria-label="Choose a trending event">
            {events.map((item, index) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setActiveId(item.id)}
                aria-label={`Show trending event ${index + 1} of ${events.length}: ${item.name}`}
                aria-current={index === activeIndex ? "true" : undefined}
                className="focus-ring grid h-11 w-8 place-items-center rounded-full"
              >
                <span aria-hidden="true" className={`h-2 w-2 rounded-full ${index === activeIndex ? "bg-white" : "bg-white/45"}`} />
              </button>
            ))}
          </div>
        </>
      ) : null}
    </div>
  );
}
