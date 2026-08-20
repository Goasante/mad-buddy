import { eventPhase } from "@/lib/events/rules";
import type { EventView } from "@/lib/events/mobile";

/**
 * Presentation derivations for the Events surfaces.
 *
 * Four screens (Home, Discover, Your Events, Hosting) plus the detail view all
 * need the same answers: is this live, what does its time read as, which
 * section does it belong in. This module is the single place those are decided.
 *
 * It is pure and takes `nowMs` as an argument -- never Date.now() internally.
 * That is what makes "live" testable at an exact instant, and it keeps the
 * server render and the client hydration agreeing on the same answer.
 *
 * TIMING AUTHORITY IS NOT REDEFINED HERE. Live/upcoming/past comes from
 * eventPhase in rules.ts; this module only decides how to PRESENT that.
 */

export type EventPresentation = {
  isLive: boolean;
  isPast: boolean;
  isToday: boolean;
  isThisWeek: boolean;
  whenLabel: string;
};

const DAY_MS = 86_400_000;

function startOfDay(ms: number): number {
  const date = new Date(ms);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

const TIME_FORMAT: Intl.DateTimeFormatOptions = { hour: "numeric", minute: "2-digit" };

/**
 * A human time label.
 *
 * "Live now" wins over any date: while something is happening, when it started
 * is not the useful fact. Then Today/Tomorrow, then a weekday inside the coming
 * week, then an explicit date. The point is that the common cases never make a
 * reader parse a date to work out whether an Event is soon.
 */
export function eventWhenLabel(event: Pick<EventView, "startsAt" | "endsAt">, nowMs: number): string {
  const startsAtMs = Date.parse(event.startsAt);
  const endsAtMs = Date.parse(event.endsAt);
  if (!Number.isFinite(startsAtMs)) return "";

  const phase = eventPhase({ startsAtMs, endsAtMs }, nowMs);
  if (phase === "live") return "Live now";

  const time = new Date(startsAtMs).toLocaleTimeString([], TIME_FORMAT);
  const dayDelta = Math.round((startOfDay(startsAtMs) - startOfDay(nowMs)) / DAY_MS);

  if (phase === "past") {
    if (dayDelta === 0) return `Today · ${time}`;
    if (dayDelta === -1) return `Yesterday · ${time}`;
    return new Date(startsAtMs).toLocaleDateString([], { month: "short", day: "numeric" });
  }

  if (dayDelta === 0) return `Today · ${time}`;
  if (dayDelta === 1) return `Tomorrow · ${time}`;
  if (dayDelta <= 6) {
    return `${new Date(startsAtMs).toLocaleDateString([], { weekday: "short" })} · ${time}`;
  }
  return `${new Date(startsAtMs).toLocaleDateString([], { month: "short", day: "numeric" })} · ${time}`;
}

export function describeEvent(event: Pick<EventView, "startsAt" | "endsAt">, nowMs: number): EventPresentation {
  const startsAtMs = Date.parse(event.startsAt);
  const endsAtMs = Date.parse(event.endsAt);
  const phase = eventPhase({ startsAtMs, endsAtMs }, nowMs);
  const dayDelta = Math.round((startOfDay(startsAtMs) - startOfDay(nowMs)) / DAY_MS);

  return {
    isLive: phase === "live",
    isPast: phase === "past",
    isToday: dayDelta === 0,
    // "This week" excludes today so the two sections never claim the same Event.
    isThisWeek: dayDelta > 0 && dayDelta <= 7,
    whenLabel: eventWhenLabel(event, nowMs)
  };
}

/**
 * The hero pick for Events Home.
 *
 * A live Event outranks everything -- "what's happening" means now. Failing
 * that, the soonest thing that has not started. Returns null rather than
 * promoting a past Event: a stale hero is worse than no hero, because the hero
 * is the surface's claim about what matters right now.
 */
export function pickHeroEvent<T extends Pick<EventView, "startsAt" | "endsAt">>(
  events: readonly T[],
  nowMs: number
): T | null {
  let live: T | null = null;
  let soonest: T | null = null;
  for (const event of events) {
    const phase = eventPhase(
      { startsAtMs: Date.parse(event.startsAt), endsAtMs: Date.parse(event.endsAt) },
      nowMs
    );
    if (phase === "live") {
      if (!live || Date.parse(event.startsAt) < Date.parse(live.startsAt)) live = event;
    } else if (phase === "upcoming") {
      if (!soonest || Date.parse(event.startsAt) < Date.parse(soonest.startsAt)) soonest = event;
    }
  }
  return live ?? soonest;
}

/** Ascending by start. Used wherever a list must read as a timeline. */
export function byStartAscending<T extends Pick<EventView, "startsAt">>(a: T, b: T): number {
  return Date.parse(a.startsAt) - Date.parse(b.startsAt);
}

/**
 * "Anyone with the link" and "Public" get explanation screens during creation.
 * The copy lives here, next to the audience rules, so the mobile create flow
 * and the web one cannot drift into describing the same choice differently.
 *
 * Each mentions only surfaces that actually exist. Public says Home, Discover
 * and Near you because those are real; it does not promise search, which is
 * not built.
 */
export const AUDIENCE_EXPLANATION: Record<string, { title: string; lines: string[] }> = {
  link: {
    title: "Anyone with the link",
    lines: [
      "This event will not appear in discovery feeds.",
      "Only people with the link can see details and RSVP.",
      "Good for private or share-by-invite events."
    ]
  },
  public: {
    title: "Public",
    lines: [
      "Anyone on Mad Buddy can discover this event.",
      "Your event may appear in Home, Discover and Near you.",
      "Best for open, public events."
    ]
  }
};

// ---------------------------------------------------------------------------
// Discover filters
// ---------------------------------------------------------------------------

/**
 * The Discover segments.
 *
 * Every one of these is a REAL predicate over facts the projection already
 * carries -- there is no decorative filter here. "Trending" ranks by the same
 * going/interested counts the ranking module uses; it is not a random shuffle
 * dressed up as popularity.
 */
export const DISCOVER_FILTERS = [
  { id: "for_you", label: "For you" },
  { id: "near_you", label: "Near you" },
  { id: "trending", label: "Trending" },
  { id: "this_weekend", label: "This weekend" }
] as const;

export type DiscoverFilterId = (typeof DISCOVER_FILTERS)[number]["id"];

/** Saturday or Sunday in the viewer's own timezone. */
function isWeekend(ms: number): boolean {
  const day = new Date(ms).getDay();
  return day === 0 || day === 6;
}

/**
 * Applies a Discover segment.
 *
 * Past Events are dropped first, for every segment: Discover is for deciding
 * where to go, and nothing already over belongs in that decision.
 */
export function applyDiscoverFilter<
  T extends Pick<EventView, "startsAt" | "endsAt" | "locality" | "goingCount" | "interestedCount">
>(events: readonly T[], filter: DiscoverFilterId, nowMs: number): T[] {
  const current = events.filter((event) => !describeEvent(event, nowMs).isPast);

  switch (filter) {
    case "near_you":
      // A published locality is what makes an Event locatable at all. This
      // filters on the EVENT's geography, never on where the viewer is.
      return current.filter((event) => Boolean(event.locality)).sort(byStartAscending);

    case "trending":
      /* Popularity, not recency. Interested is weighted below Going because
       * caring is a weaker signal than intending -- the same ordering the
       * ranking module uses, so the two surfaces cannot disagree about what
       * "trending" means. */
      return [...current].sort(
        (a, b) =>
          b.goingCount * 2 + b.interestedCount - (a.goingCount * 2 + a.interestedCount) ||
          byStartAscending(a, b)
      );

    case "this_weekend":
      return current.filter((event) => isWeekend(Date.parse(event.startsAt))).sort(byStartAscending);

    case "for_you":
    default:
      // Chronological. "For you" is everything this viewer may discover -- the
      // audience rules already decided that upstream in listEvents.
      return [...current].sort(byStartAscending);
  }
}

/**
 * Name and venue matching for the Discover search field.
 *
 * Local, over Events already fetched and already audience-filtered. It cannot
 * widen what a viewer may see -- searching is not a way around visibility.
 */
export function searchEvents<T extends Pick<EventView, "name" | "venueLabel" | "locality">>(
  events: readonly T[],
  query: string
): T[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [...events];
  return events.filter((event) =>
    [event.name, event.venueLabel, event.locality]
      .filter(Boolean)
      .some((field) => (field as string).toLowerCase().includes(needle))
  );
}
