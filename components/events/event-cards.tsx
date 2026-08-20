"use client";

import { ChevronRight } from "lucide-react";
import { EventArtwork } from "@/components/events/event-artwork";
import { AudienceChip, LiveBadge, formatAttendance } from "@/components/events/event-badges";
import { cn } from "@/lib/utils";

/**
 * The Events card vocabulary.
 *
 * Three forms, each with a job, deliberately NOT one card with size props:
 *
 *   EventHeroCard     -- one per surface. Full-bleed artwork, text over image.
 *   EventDiscoveryCard -- browsing. Artwork above text, scannable in a column.
 *   EventCompactRow   -- lists. Thumbnail plus two lines. No card chrome.
 *
 * The compact row carries NO border and NO card background on purpose. The old
 * Events UI put a rounded rectangle around every line, which is what made it
 * read as a settings screen; here separation comes from spacing and the
 * thumbnail, and the row's own shape only appears on hover.
 */

export type EventCardFacts = {
  id: string;
  name: string;
  coverUrl: string | null;
  focalX: number;
  focalY: number;
  venueLabel: string | null;
  locality: string | null;
  goingCount: number;
  isLive: boolean;
  whenLabel: string;
  visibility?: string;
};

/** Venue and locality, without repeating a word the other already said. */
function placeLabel(facts: Pick<EventCardFacts, "venueLabel" | "locality">): string | null {
  const venue = facts.venueLabel?.trim() || null;
  const locality = facts.locality?.trim() || null;
  if (venue && locality && !venue.toLowerCase().includes(locality.toLowerCase())) return `${venue}, ${locality}`;
  return venue ?? locality;
}

export function EventHeroCard({
  facts,
  onOpen,
  footer,
  className
}: {
  facts: EventCardFacts;
  onOpen: () => void;
  /** Social row: attendee avatars, "Doors open", a Going pill. */
  footer?: React.ReactNode;
  className?: string;
}) {
  const place = placeLabel(facts);
  const attendance = formatAttendance(facts.goingCount);

  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={`Open ${facts.name}`}
      className={cn(
        "group relative block w-full overflow-hidden rounded-2xl text-left shadow-lg transition-transform",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background",
        "active:scale-[0.995] motion-reduce:transition-none motion-reduce:active:scale-100",
        className
      )}
    >
      {/* CINEMATIC, NOT ENORMOUS (4J §7).
       *
       * This was 4:5 on phones -- 488px tall at 390 wide, which filled the
       * viewport and pushed "Upcoming for you" entirely below the fold, so the
       * first screen looked like one card and nothing else. 5:4 keeps the
       * artwork dominant while leaving the next section visible, which is what
       * makes the surface feel like there is more to see. */}
      <EventArtwork
        eventId={facts.id}
        coverUrl={facts.coverUrl}
        focalX={facts.focalX}
        focalY={facts.focalY}
        alt={facts.name}
        scrim="strong"
        className="aspect-[5/4] w-full sm:aspect-[16/9]"
      />

      <div className="absolute inset-x-0 bottom-0 space-y-2 p-4 sm:p-5">
        {facts.isLive ? <LiveBadge /> : null}
        {/* Fixed white here, not a token: this text sits on a photographic
            scrim in both themes, so it must not follow the theme's foreground. */}
        <h3 className="text-balance text-2xl font-bold leading-tight text-white drop-shadow-sm sm:text-3xl">
          {facts.name}
        </h3>
        {place ? <p className="text-sm text-white/85">{place}</p> : null}
        {footer ?? (
          <p className="text-sm text-white/70">
            {[attendance, facts.whenLabel].filter(Boolean).join(" · ")}
          </p>
        )}
      </div>
    </button>
  );
}

export function EventDiscoveryCard({
  facts,
  onOpen,
  className
}: {
  facts: EventCardFacts;
  onOpen: () => void;
  className?: string;
}) {
  const place = placeLabel(facts);
  const attendance = formatAttendance(facts.goingCount);

  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={`Open ${facts.name}`}
      className={cn(
        "group block w-full overflow-hidden rounded-xl bg-card text-left shadow-sm ring-1 ring-border/50 transition",
        "hover:ring-border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary",
        className
      )}
    >
      <div className="relative">
        <EventArtwork
          eventId={facts.id}
          coverUrl={facts.coverUrl}
          focalX={facts.focalX}
          focalY={facts.focalY}
          alt={facts.name}
          scrim={facts.isLive ? "soft" : "none"}
          className="aspect-[16/9] w-full"
        />
        {facts.isLive ? (
          <div className="absolute left-3 top-3">
            <LiveBadge compact />
          </div>
        ) : null}
      </div>
      <div className="space-y-1 p-3.5">
        <h3 className="text-pretty font-semibold leading-snug">{facts.name}</h3>
        {place ? <p className="text-sm text-muted-foreground">{place}</p> : null}
        <p className="text-sm text-muted-foreground">
          {[facts.whenLabel, attendance].filter(Boolean).join(" · ")}
        </p>
      </div>
    </button>
  );
}

export function EventCompactRow({
  facts,
  onOpen,
  /** Replaces the chevron: "Interested", a Going tick, a host menu. */
  trailing,
  className
}: {
  facts: EventCardFacts;
  onOpen: () => void;
  trailing?: React.ReactNode;
  className?: string;
}) {
  const place = placeLabel(facts);

  return (
    <div className={cn("flex items-center gap-3", className)}>
      <button
        type="button"
        onClick={onOpen}
        aria-label={`Open ${facts.name}`}
        // min-h-[3.5rem] keeps the whole row a comfortable touch target, not
        // just the 56px thumbnail.
        className="flex min-h-[3.5rem] flex-1 items-center gap-3 rounded-xl px-1 py-1.5 text-left transition hover:bg-secondary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
      >
        <div className="relative shrink-0">
          <EventArtwork
            eventId={facts.id}
            coverUrl={facts.coverUrl}
            focalX={facts.focalX}
            focalY={facts.focalY}
            alt={facts.name}
            className="h-14 w-14 rounded-lg"
          />
          {facts.isLive ? (
            <span
              aria-hidden="true"
              className="absolute -right-0.5 -top-0.5 h-3 w-3 rounded-full border-2 border-card bg-primary"
            />
          ) : null}
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium leading-snug">{facts.name}</p>
          <p className="truncate text-sm text-muted-foreground">{facts.whenLabel}</p>
          {place ? <p className="truncate text-xs text-muted-foreground/80">{place}</p> : null}
        </div>
        {facts.visibility ? <AudienceChip visibility={facts.visibility} className="hidden sm:inline-flex" /> : null}
        {trailing ? null : <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />}
      </button>
      {trailing}
    </div>
  );
}
