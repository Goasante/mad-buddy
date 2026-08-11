import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { stripComments } from "@/lib/content/strip-comments";
import {
  ACCORDION_RANK_ORDER,
  HOME_RANKED_EVENTS_LIMIT,
  MAX_RANKED_EVENTS,
  activeIndexForAccordion,
  arrangeForAccordion,
  isRankableEvent,
  rankEvents,
  scoreEvent,
  type RankableEvent
} from "@/lib/events/ranking";
import { EVENT_FALLBACK_TREATMENTS, resolveEventMedia } from "@/lib/events/event-media";

/**
 * Ranked Events Discovery.
 *
 * The ranking and media layers are PURE, so these are real behavioural tests
 * -- actual inputs, actual outputs. The component and projection assertions
 * at the bottom are source-text (vitest runs environment: "node", so there is
 * no DOM to mount a client accordion into), following the same pattern the
 * rest of this codebase uses for server-only and client-only modules.
 */

const HOUR = 3_600_000;
const NOW = Date.parse("2026-08-11T12:00:00.000Z");

function makeEvent(overrides: Partial<RankableEvent> & { id: string }): RankableEvent {
  return {
    startsAtMs: NOW + 24 * HOUR,
    endsAtMs: NOW + 27 * HOUR,
    status: "scheduled",
    goingCount: 0,
    interestedCount: 0,
    ...overrides
  };
}

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

describe("scoreEvent", () => {
  it("weights going above interested", () => {
    const going = makeEvent({ id: "a", goingCount: 1 });
    const interested = makeEvent({ id: "b", interestedCount: 1 });
    expect(scoreEvent(going)).toBeGreaterThan(scoreEvent(interested));
  });

  it("still counts interest, so a new event can surface", () => {
    expect(scoreEvent(makeEvent({ id: "a", interestedCount: 3 }))).toBeGreaterThan(0);
  });

  it("scores an event with no RSVPs at zero rather than inventing a number", () => {
    expect(scoreEvent(makeEvent({ id: "a" }))).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Eligibility — past and cancelled events are excluded
// ---------------------------------------------------------------------------

describe("isRankableEvent", () => {
  it("excludes cancelled, draft and ended events", () => {
    for (const status of ["cancelled", "draft", "ended"]) {
      expect(isRankableEvent(makeEvent({ id: "a", status }), NOW), status).toBe(false);
    }
  });

  it("excludes an event that has already finished", () => {
    const past = makeEvent({ id: "a", startsAtMs: NOW - 5 * HOUR, endsAtMs: NOW - HOUR });
    expect(isRankableEvent(past, NOW)).toBe(false);
  });

  it("keeps an event that is running right now", () => {
    // Started but not finished. "Upcoming" must not drop what is live.
    const live = makeEvent({ id: "a", startsAtMs: NOW - HOUR, endsAtMs: NOW + HOUR });
    expect(isRankableEvent(live, NOW)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Ranking
// ---------------------------------------------------------------------------

describe("rankEvents", () => {
  it("orders by score, best first, and numbers from 1", () => {
    const ranked = rankEvents(
      [
        makeEvent({ id: "quiet", goingCount: 1 }),
        makeEvent({ id: "busy", goingCount: 10 }),
        makeEvent({ id: "middling", goingCount: 4 })
      ],
      NOW
    );
    expect(ranked.map((event) => event.id)).toEqual(["busy", "middling", "quiet"]);
    expect(ranked.map((event) => event.rank)).toEqual([1, 2, 3]);
  });

  it("never emits a duplicate rank, even for tied scores", () => {
    const ranked = rankEvents(
      [
        makeEvent({ id: "a", goingCount: 2 }),
        makeEvent({ id: "b", goingCount: 2 }),
        makeEvent({ id: "c", goingCount: 2 })
      ],
      NOW
    );
    expect(new Set(ranked.map((event) => event.rank)).size).toBe(3);
  });

  it("breaks ties deterministically, so two screens agree", () => {
    const events = [
      makeEvent({ id: "zzz", goingCount: 2 }),
      makeEvent({ id: "aaa", goingCount: 2 })
    ];
    // Same inputs in a different order must produce the same ranking.
    const first = rankEvents(events, NOW).map((event) => event.id);
    const second = rankEvents([...events].reverse(), NOW).map((event) => event.id);
    expect(first).toEqual(second);
  });

  it("prefers the sooner event when scores are equal", () => {
    const ranked = rankEvents(
      [
        makeEvent({ id: "later", goingCount: 3, startsAtMs: NOW + 48 * HOUR, endsAtMs: NOW + 50 * HOUR }),
        makeEvent({ id: "sooner", goingCount: 3, startsAtMs: NOW + 2 * HOUR, endsAtMs: NOW + 4 * HOUR })
      ],
      NOW
    );
    expect(ranked[0].id).toBe("sooner");
  });

  it("drops ineligible events before assigning ranks", () => {
    // A cancelled event must not consume rank #1 and leave a gap.
    const ranked = rankEvents(
      [
        makeEvent({ id: "cancelled", goingCount: 99, status: "cancelled" }),
        makeEvent({ id: "real", goingCount: 1 })
      ],
      NOW
    );
    expect(ranked.map((event) => event.id)).toEqual(["real"]);
    expect(ranked[0].rank).toBe(1);
  });

  it("honours the Home limit of 5", () => {
    const many = Array.from({ length: 20 }, (_, index) =>
      makeEvent({ id: `e${index}`, goingCount: index })
    );
    expect(rankEvents(many, NOW, HOME_RANKED_EVENTS_LIMIT)).toHaveLength(5);
  });

  it("caps the full ranking at 100 and never fabricates rows to reach it", () => {
    const many = Array.from({ length: 140 }, (_, index) =>
      makeEvent({ id: `e${index}`, goingCount: index })
    );
    expect(rankEvents(many, NOW, MAX_RANKED_EVENTS)).toHaveLength(MAX_RANKED_EVENTS);
    // Nine real events produce nine rows, not 100 padded ones.
    const nine = Array.from({ length: 9 }, (_, index) => makeEvent({ id: `n${index}` }));
    expect(rankEvents(nine, NOW, MAX_RANKED_EVENTS)).toHaveLength(9);
  });

  it("cannot be pushed past the hard cap by a larger limit", () => {
    const many = Array.from({ length: 200 }, (_, index) => makeEvent({ id: `e${index}` }));
    expect(rankEvents(many, NOW, 500).length).toBeLessThanOrEqual(MAX_RANKED_EVENTS);
  });

  it("returns nothing for an empty database rather than seeded events", () => {
    expect(rankEvents([], NOW)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Accordion arrangement — #4 #3 #1 #2 #5
// ---------------------------------------------------------------------------

describe("arrangeForAccordion", () => {
  const ranked = [1, 2, 3, 4, 5].map((rank) => ({ rank, id: `e${rank}` }));

  it("places the top rank at the optical centre", () => {
    expect(ACCORDION_RANK_ORDER).toEqual([4, 3, 1, 2, 5]);
    expect(arrangeForAccordion(ranked).map((event) => event.rank)).toEqual([4, 3, 1, 2, 5]);
  });

  it("opens on rank #1, whatever position it occupies", () => {
    const arranged = arrangeForAccordion(ranked);
    expect(activeIndexForAccordion(arranged)).toBe(2);
    expect(arranged[activeIndexForAccordion(arranged)].rank).toBe(1);
  });

  it("keeps every rank -- none is dropped by the arrangement", () => {
    expect(new Set(arrangeForAccordion(ranked).map((event) => event.rank))).toEqual(
      new Set([1, 2, 3, 4, 5])
    );
  });

  it("still centres #1 when fewer than five events exist", () => {
    const three = [1, 2, 3].map((rank) => ({ rank, id: `e${rank}` }));
    const arranged = arrangeForAccordion(three);
    expect(arranged.map((event) => event.rank)).toEqual([3, 1, 2]);
    expect(arranged[activeIndexForAccordion(arranged)].rank).toBe(1);
  });

  it("falls back to the first panel when there is no rank 1", () => {
    expect(activeIndexForAccordion([{ rank: 2, id: "a" }])).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Media fallback
// ---------------------------------------------------------------------------

describe("event media", () => {
  it("is deterministic for a given event", () => {
    const first = resolveEventMedia("event-abc");
    const second = resolveEventMedia("event-abc");
    expect(first).toEqual(second);
  });

  it("uses a real image when one exists", () => {
    expect(resolveEventMedia("e", "https://example.test/a.jpg")).toEqual({
      kind: "image",
      url: "https://example.test/a.jpg"
    });
  });

  it("treats a blank url as absent rather than rendering a broken image", () => {
    for (const blank of ["", "   ", null, undefined]) {
      expect(resolveEventMedia("e", blank).kind, JSON.stringify(blank)).toBe("fallback");
    }
  });

  it("draws every treatment from the designed set", () => {
    const ids = new Set(EVENT_FALLBACK_TREATMENTS.map((treatment) => treatment.id));
    for (let index = 0; index < 50; index += 1) {
      const media = resolveEventMedia(`event-${index}`);
      expect(media.kind).toBe("fallback");
      if (media.kind === "fallback") expect(ids.has(media.treatment.id)).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// Projection + surfaces (source-text: server-only / client-only modules)
// ---------------------------------------------------------------------------

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");
const projection = stripComments(read("lib/events/ranked-events.ts"));
const accordion = stripComments(read("components/events/ranked-events-accordion.tsx"));
const homeModule = stripComments(read("components/events/top-events-home.tsx"));
const rankedPage = stripComments(read("app/(app)/events/top/page.tsx"));
const dashboardLoader = stripComments(read("app/(app)/dashboard/page.tsx"));
const rankingSource = stripComments(read("lib/events/ranking.ts"));

describe("the projection reuses canonical eligibility", () => {
  it("applies the same visibility and block rules as listEvents", () => {
    expect(projection).toContain('event.visibility !== "invite"');
    expect(projection).toContain("batchBlockedIds");
  });

  it("counts RSVPs in one query, never one per event", () => {
    expect(projection).not.toMatch(/for \(const event of[\s\S]{0,400}await admin/);
    expect(projection).toContain('.in("event_id", eventIds)');
  });

  it("does not count not_going as popularity", () => {
    expect(projection).toContain('row.status === "going"');
    expect(projection).toContain('row.status === "interested"');
    expect(projection).not.toMatch(/status === "not_going".{0,40}\+ 1/);
  });

  it("never widens RLS to read counts", () => {
    // Counts come from the service-role client and are returned as numbers.
    expect(projection).toContain("createSupabaseAdminClient");
    expect(projection).not.toContain("create policy");
  });
});

describe("Home asks for 5, the ranked page asks for 100", () => {
  it("loads only the top 5 on Home", () => {
    expect(dashboardLoader).toContain("getRankedUpcomingEvents(user.id, { limit: HOME_RANKED_EVENTS_LIMIT })");
    expect(HOME_RANKED_EVENTS_LIMIT).toBe(5);
  });

  it("loads up to 100 on the ranked destination", () => {
    expect(rankedPage).toContain("limit: MAX_RANKED_EVENTS");
    expect(MAX_RANKED_EVENTS).toBe(100);
  });

  it("uses one loader for both, so ranks cannot disagree", () => {
    expect(dashboardLoader).toContain("getRankedUpcomingEvents");
    expect(rankedPage).toContain("getRankedUpcomingEvents");
  });

  it("does not ship a hardcoded 20-item fixture", () => {
    for (const [name, source] of [["page", rankedPage], ["projection", projection]] as const) {
      expect(source, name).not.toMatch(/\blimit:\s*20\b/);
    }
  });
});

describe("both ranked surfaces open the canonical event detail", () => {
  it("deep-links to the existing events route rather than a second detail", () => {
    expect(homeModule).toContain("/events?event=");
    expect(stripComments(read("components/events/top-events-list.tsx"))).toContain("/events?event=");
  });

  it("builds no RSVP or check-in controls inside discovery", () => {
    for (const [name, source] of [["accordion", accordion], ["home", homeModule]] as const) {
      expect(source, name).not.toContain("setEventRsvpAction");
      expect(source, name).not.toContain("checkInToEventAction");
    }
  });
});

describe("accordion interaction contract", () => {
  it("expands on first press and opens only on the second", () => {
    expect(accordion).toContain("if (event.id === activeEventId)");
    expect(accordion).toContain("onOpenEvent(event)");
    // Panels are buttons, not links: a link would navigate on the first tap.
    expect(accordion).not.toMatch(/<a\s/);
    expect(accordion).toContain('type="button"');
  });

  it("expands on hover only where a real pointer exists", () => {
    expect(accordion).toContain("finePointer ? () => setActiveId(event.id) : undefined");
    expect(accordion).toContain("FINE_POINTER_QUERY");
  });

  it("never opens an event from hover alone", () => {
    const hoverHandler = accordion.slice(accordion.indexOf("onMouseEnter"));
    expect(hoverHandler.slice(0, 120)).not.toContain("onOpenEvent");
  });

  it("tracks the active panel by identity so it survives a rerender", () => {
    // Index would point at a different event across the mobile breakpoint.
    expect(accordion).toContain("const [activeId, setActiveId] = useState<string | null>(null)");
    expect(accordion).toContain("panels.some((event) => event.id === activeId)");
  });

  it("supports keyboard navigation and focus", () => {
    for (const key of ["ArrowRight", "ArrowLeft", "Home", "End"]) {
      expect(accordion, key).toContain(`"${key}"`);
    }
    expect(accordion).toContain("onFocus");
    expect(accordion).toContain("buttonRefs.current[nextIndex]?.focus()");
  });

  it("marks the active panel for assistive technology, not by animation alone", () => {
    expect(accordion).toContain('aria-current={isActive ? "true" : undefined}');
    // The rank is real text on every panel, expanded or collapsed.
    expect(accordion).toContain("{event.rank}");
    expect(accordion).toContain("aria-label=");
  });

  it("respects reduced motion", () => {
    expect(accordion).toContain("useReducedMotion");
    expect(accordion).toContain("reducedMotion && \"transition-none\"");
  });

  it("keeps a 44px minimum touch target on collapsed rails", () => {
    expect(accordion).toContain('min-w-[2.75rem]');
  });

  it("cannot overflow the page horizontally", () => {
    // Percentage flex-basis keeps the row summing to its container.
    expect(accordion).toContain('flexBasis: isActive ? "52%" : "0%"');
    expect(accordion).not.toContain("overflow-x-auto");
    expect(accordion).not.toContain("100vw");
  });

  it("does not stack into a plain vertical list on mobile", () => {
    // The reference component collapses to a column under 520px, which is the
    // outcome the brief rules out. The ROW stays a row at every width -- note
    // this checks the container, not the panel's own content stack, which is
    // legitimately a column.
    expect(accordion).toContain('className="flex items-stretch gap-1.5 sm:gap-2"');
    const rowClasses = accordion.slice(
      accordion.indexOf('className="flex items-stretch'),
      accordion.indexOf('role="group"')
    );
    expect(rowClasses).not.toContain("flex-col");
  });

  it("keeps every rank reachable below the five-panel breakpoint", () => {
    // Ranks that lose a rail become edge peeks that promote on tap.
    expect(accordion).toContain("NARROW_RANKS");
    expect(accordion).toContain("peeks.map");
    expect(accordion).toContain("ACCORDION_FIVE_PANEL_MIN_WIDTH = 360");
  });

  it("adds no animation dependency for a width tween", () => {
    expect(accordion).not.toContain("gsap");
    expect(accordion).not.toContain("framer-motion");
  });
});

describe("ranking engine boundary", () => {
  it("keeps scoring pure and free of database access", () => {
    expect(rankingSource).not.toContain("supabase");
    expect(rankingSource).not.toContain("admin");
    expect(rankingSource).not.toContain("Date.now()");
  });

  it("names future signals without pretending to compute them", () => {
    expect(rankingSource).toContain("RankingSignals");
    // Declared as optional and unused; scoreEvent must not read them.
    const scorer = rankingSource.slice(rankingSource.indexOf("export function scoreEvent"));
    expect(scorer.slice(0, 200)).not.toContain("momentumScore");
    expect(scorer.slice(0, 200)).not.toContain("qualityScore");
  });
});
