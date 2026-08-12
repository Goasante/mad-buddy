"use client";

import Link from "next/link";
import type { Route } from "next";
import { Crown, MapPin } from "lucide-react";
import { fallbackGradient } from "@/lib/events/event-media";
import { focalObjectPosition } from "@/lib/events/cover";
import type { RankedEvent } from "@/lib/events/ranked-events";
import { EmptyState } from "@/components/ui/empty-state";
import { CalendarPlus } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * The full ranked list (Ranked Events Discovery).
 *
 * Up to 100 rows, however many genuinely exist. There is no padding to reach
 * a round number: a ranking of nine events shows nine, and the copy never
 * claims otherwise. Each row links to the CANONICAL event detail rather than
 * expanding a second detail implementation here -- this page is discovery,
 * the events page owns the record.
 */

function startLabel(startsAt: string): string {
  return new Date(startsAt).toLocaleString([], {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit"
  });
}

export function TopEventsList({ events }: { events: RankedEvent[] }) {
  if (events.length === 0) {
    return (
      <EmptyState
        icon={CalendarPlus}
        title="No events to rank yet"
        description="When events are created and Muddies start showing interest, the top ones appear here."
        action={
          <Link href={"/events" as Route} className="focus-ring text-sm font-semibold text-primary">
            Browse events
          </Link>
        }
      />
    );
  }

  return (
    <ol className="space-y-2">
      {events.map((event) => (
        <li key={event.id}>
          <Link
            href={`/events?event=${event.id}` as Route}
            className="focus-ring flex items-stretch gap-3 rounded-2xl border border-border/70 bg-card p-2 transition-transform duration-200 ease-out active:scale-[0.99] motion-reduce:active:scale-100"
          >
            {/* Rank. Large and quiet -- a numeral, not a medal. */}
            <span className="flex w-9 shrink-0 flex-col items-center justify-center gap-0.5">
              {event.rank === 1 ? (
                <Crown className="h-3.5 w-3.5 text-[var(--color-brand-orange)]" aria-hidden="true" />
              ) : null}
              <span
                className={cn(
                  "font-bold leading-none tabular-nums",
                  event.rank === 1 ? "text-xl text-foreground" : "text-lg text-muted-foreground"
                )}
              >
                {event.rank}
              </span>
            </span>

            <span
              aria-hidden="true"
              className="relative h-16 w-16 shrink-0 overflow-hidden rounded-xl"
              style={
                event.media.kind === "fallback"
                  ? { backgroundImage: fallbackGradient(event.media.treatment) }
                  : undefined
              }
            >
              {event.media.kind === "image" ? (
                /* Remote user upload; see ranked-events-accordion for the
                   same note about next/image loaders. */
                /* eslint-disable-next-line @next/next/no-img-element */
                <img
                  src={event.media.url}
                  alt=""
                  loading="lazy"
                  decoding="async"
                  // Same focal point as the accordion: one image, many crops.
                  style={{ objectPosition: focalObjectPosition(event.focalPoint.x, event.focalPoint.y) }}
                  className="h-full w-full object-cover"
                />
              ) : null}
            </span>

            <span className="flex min-w-0 flex-1 flex-col justify-center gap-0.5 py-0.5 pr-1">
              <span className="truncate text-sm font-semibold leading-tight">{event.name}</span>
              <span className="text-xs text-muted-foreground">{startLabel(event.startsAt)}</span>
              {event.venueLabel ? (
                <span className="flex items-center gap-1 text-xs text-muted-foreground">
                  <MapPin className="h-3 w-3 shrink-0" aria-hidden="true" />
                  <span className="truncate">{event.venueLabel}</span>
                </span>
              ) : null}
              <span className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[0.6875rem] font-medium text-muted-foreground">
                {event.goingCount > 0 ? <span>{event.goingCount} going</span> : null}
                {event.interestedCount > 0 ? <span>{event.interestedCount} interested</span> : null}
                {event.isHost ? (
                  <span className="text-[var(--color-brand-orange)]">You&apos;re hosting</span>
                ) : event.myRsvp === "going" ? (
                  <span className="text-[var(--color-brand-orange)]">You&apos;re going</span>
                ) : event.myRsvp === "interested" ? (
                  <span className="text-[var(--color-brand-orange)]">Interested</span>
                ) : null}
              </span>
            </span>
          </Link>
        </li>
      ))}
    </ol>
  );
}
