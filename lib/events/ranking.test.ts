import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { stripComments } from "@/lib/content/strip-comments";
import {
  ACCORDION_RANK_ORDER,
  HOME_RANKED_EVENTS_LIMIT,
  MAX_RANKED_EVENTS,
  MOMENTUM_WINDOW_MS,
  START_PROXIMITY_BUCKETS,
  activeIndexForAccordion,
  arrangeForAccordion,
  isRankableEvent,
  rankEvents,
  scoreEvent,
  startProximityBoost,
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
    // Far enough out to sit in the no-boost band, so a test that says nothing
    // about timing is not silently also testing the start-proximity boost.
    startsAtMs: NOW + 30 * 24 * HOUR,
    endsAtMs: NOW + 30 * 24 * HOUR + 3 * HOUR,
    status: "scheduled",
    goingCount: 0,
    interestedCount: 0,
    recentGoingCount: 0,
    recentInterestedCount: 0,
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
    expect(scoreEvent(going, NOW)).toBeGreaterThan(scoreEvent(interested, NOW));
  });

  it("still counts interest, so a new event can surface", () => {
    expect(scoreEvent(makeEvent({ id: "a", interestedCount: 3 }), NOW)).toBeGreaterThan(0);
  });

  it("scores an event with no RSVPs at zero rather than inventing a number", () => {
    expect(scoreEvent(makeEvent({ id: "a" }), NOW)).toBe(0);
  });

  it("does not let going dominate so completely that nothing else matters", () => {
    // Going is stronger, but a lone Going must not outweigh a wave of real
    // interest -- that would make Interested decorative.
    const oneGoing = makeEvent({ id: "a", goingCount: 1 });
    const manyInterested = makeEvent({ id: "b", interestedCount: 40 });
    expect(scoreEvent(manyInterested, NOW)).toBeGreaterThan(scoreEvent(oneGoing, NOW));
  });
});

describe("size fairness", () => {
  it("gives diminishing returns to raw popularity", () => {
    // 10 -> 60 is a real signal; 2000 -> 2050 is noise. Under linear counts
    // the second gap dwarfed the first, which is how one huge event owned
    // rank 1 permanently.
    const smallGain =
      scoreEvent(makeEvent({ id: "a", goingCount: 60 }), NOW) -
      scoreEvent(makeEvent({ id: "a", goingCount: 10 }), NOW);
    const largeGain =
      scoreEvent(makeEvent({ id: "b", goingCount: 2050 }), NOW) -
      scoreEvent(makeEvent({ id: "b", goingCount: 2000 }), NOW);
    expect(smallGain).toBeGreaterThan(largeGain);
  });

  it("still ranks a genuinely bigger event above a smaller one, all else equal", () => {
    // Diminishing returns must not become no returns.
    expect(scoreEvent(makeEvent({ id: "a", goingCount: 500 }), NOW)).toBeGreaterThan(
      scoreEvent(makeEvent({ id: "b", goingCount: 50 }), NOW)
    );
  });
});

describe("momentum", () => {
  it("lets a fast-rising event outrank a larger stale one", () => {
    // The exact failure the hardening targets: an older event with a bigger
    // lifetime total, against a newer one whose demand is happening now.
    const stale = makeEvent({ id: "stale", goingCount: 120, interestedCount: 200 });
    const rising = makeEvent({
      id: "rising",
      goingCount: 40,
      interestedCount: 60,
      recentGoingCount: 40,
      recentInterestedCount: 60
    });
    expect(scoreEvent(rising, NOW)).toBeGreaterThan(scoreEvent(stale, NOW));
  });

  it("does not let momentum alone beat a far more popular event", () => {
    // A handful of recent RSVPs must not vault a tiny event over a genuinely
    // in-demand one, or the ranking becomes a recency feed.
    const huge = makeEvent({ id: "huge", goingCount: 4000, interestedCount: 6000 });
    const tinyButRecent = makeEvent({
      id: "tiny",
      goingCount: 3,
      interestedCount: 2,
      recentGoingCount: 3,
      recentInterestedCount: 2
    });
    expect(scoreEvent(huge, NOW)).toBeGreaterThan(scoreEvent(tinyButRecent, NOW));
  });

  it("counts recent going above recent interested", () => {
    const recentGoing = makeEvent({ id: "a", goingCount: 5, recentGoingCount: 5 });
    const recentInterested = makeEvent({ id: "b", interestedCount: 5, recentInterestedCount: 5 });
    expect(scoreEvent(recentGoing, NOW)).toBeGreaterThan(scoreEvent(recentInterested, NOW));
  });

  it("uses a bounded window rather than all history", () => {
    expect(MOMENTUM_WINDOW_MS).toBe(24 * HOUR);
  });
});

describe("start proximity", () => {
  it("prefers the event happening tonight over the identical one months away", () => {
    const tonight = makeEvent({
      id: "tonight",
      goingCount: 30,
      startsAtMs: NOW + 3 * HOUR,
      endsAtMs: NOW + 6 * HOUR
    });
    const distant = makeEvent({ id: "distant", goingCount: 30 });
    expect(scoreEvent(tonight, NOW)).toBeGreaterThan(scoreEvent(distant, NOW));
  });

  it("boosts an event already under way", () => {
    const live = makeEvent({
      id: "live",
      goingCount: 10,
      startsAtMs: NOW - HOUR,
      endsAtMs: NOW + HOUR
    });
    expect(startProximityBoost(live, NOW)).toBe(START_PROXIMITY_BUCKETS[0].boost);
  });

  it("never penalises a distant event below its own demand", () => {
    // The boost is a multiplier >= 1: far-off events are not punished, they
    // simply do not get the lift.
    expect(startProximityBoost(makeEvent({ id: "a" }), NOW)).toBe(1);
  });

  it("cannot rescue an empty event", () => {
    // Imminence re-weights demand; it does not manufacture it.
    const imminentEmpty = makeEvent({
      id: "empty",
      startsAtMs: NOW + HOUR,
      endsAtMs: NOW + 2 * HOUR
    });
    expect(scoreEvent(imminentEmpty, NOW)).toBe(0);
  });

  it("moves in steps, not continuously, so the order does not flicker", () => {
    // Two loads a second apart must produce the same boost.
    const event = makeEvent({ id: "a", startsAtMs: NOW + 10 * HOUR, endsAtMs: NOW + 12 * HOUR });
    expect(startProximityBoost(event, NOW)).toBe(startProximityBoost(event, NOW + 1000));
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
    /* Both surfaces now call the SAME rule rather than each carrying a copy of
     * it. The duplicated `visibility !== "invite"` string this used to assert
     * was the drift risk: it let `link` -- an unlisted audience -- into ranked
     * discovery, and any future fix would have had to find both copies. */
    /* Broad ranking is STRICTER than the feed, deliberately. Browsing may show
     * a community Event to its members; "trending on Mad Buddy" is a claim
     * about the whole product, so only public/nearby qualify. Both surfaces
     * still share one owner -- they just ask it different questions. */
    expect(projection).toContain("isBroadlyRankable");
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

describe("Home and the full list cannot disagree", () => {
  const events = Array.from({ length: 12 }, (_, index) =>
    makeEvent({
      id: `e${index}`,
      goingCount: index * 3,
      interestedCount: (12 - index) * 2,
      recentGoingCount: index % 4
    })
  );

  it("gives an event the same rank in the top 5 as in the top 100", () => {
    const home = rankEvents(events, NOW, HOME_RANKED_EVENTS_LIMIT);
    const full = rankEvents(events, NOW, MAX_RANKED_EVENTS);
    for (const homeEvent of home) {
      const fullEvent = full.find((candidate) => candidate.id === homeEvent.id);
      expect(fullEvent?.rank, `rank drift for ${homeEvent.id}`).toBe(homeEvent.rank);
    }
  });

  it("makes the Home five exactly the first five of the full list", () => {
    expect(rankEvents(events, NOW, HOME_RANKED_EVENTS_LIMIT).map((e) => e.id)).toEqual(
      rankEvents(events, NOW, MAX_RANKED_EVENTS).slice(0, 5).map((e) => e.id)
    );
  });
});

describe("anti-manipulation", () => {
  it("counts a user once, so toggling cannot inflate a score", () => {
    // One row per user per event is a database constraint, so a status flip
    // moves the row between buckets rather than adding one. The projection
    // must therefore branch on the CURRENT status and never accumulate.
    expect(projection).toContain('row.status === "going"');
    expect(projection).toContain('row.status === "interested"');
    expect(projection).not.toMatch(/not_going/);
    // The unique constraint that makes the above true.
    const rsvpMigration = read("supabase/migrations/20260811130000_event_rsvps.sql");
    expect(rsvpMigration).toContain("unique (event_id, user_id)");
  });

  it("excludes cancelled and past events from any ranking", () => {
    const ranked = rankEvents(
      [
        makeEvent({ id: "cancelled", goingCount: 900, status: "cancelled" }),
        makeEvent({ id: "past", goingCount: 900, startsAtMs: NOW - 5 * HOUR, endsAtMs: NOW - HOUR }),
        makeEvent({ id: "real", goingCount: 1 })
      ],
      NOW
    );
    expect(ranked.map((event) => event.id)).toEqual(["real"]);
  });

  it("ranks events, never people", () => {
    for (const [name, source] of [["ranking", rankingSource], ["projection", projection]] as const) {
      expect(source, name).not.toMatch(/rankUsers|userRank|leaderboard/i);
    }
  });
});

describe("ranking engine boundary", () => {
  it("keeps scoring pure and free of database access", () => {
    expect(rankingSource).not.toContain("supabase");
    expect(rankingSource).not.toContain("admin");
    expect(rankingSource).not.toContain("Date.now()");
  });

  it("names future signals without pretending to compute them", () => {
    // Quality and anti-manipulation scores are NOT in RankableEvent and NOT
    // in the score. A field multiplied by a zero weight would be a fake
    // signal wearing a real field's name.
    expect(rankingSource).toContain("FutureRankingSignals");
    const scorer = rankingSource.slice(
      rankingSource.indexOf("export function scoreEvent"),
      rankingSource.indexOf("export function isRankableEvent")
    );
    expect(scorer).not.toContain("qualityScore");
    expect(scorer).not.toContain("manipulationPenalty");
  });

  it("makes momentum a required input rather than a silent zero", () => {
    // Optional momentum would read as 0 for any caller that forgot it, which
    // is indistinguishable from "this event has no recent demand".
    const shape = rankingSource.slice(
      rankingSource.indexOf("export type RankableEvent"),
      rankingSource.indexOf("export type FutureRankingSignals")
    );
    expect(shape).toContain("recentGoingCount: number;");
    expect(shape).toContain("recentInterestedCount: number;");
    expect(shape).not.toContain("recentGoingCount?:");
  });
});

describe("ranking performance", () => {
  it("derives momentum from the rows the counts already read", () => {
    // No second "recent RSVPs" query, and no per-event count query.
    expect(projection).toContain('.select("event_id, status, updated_at")');
    expect((projection.match(/from\("event_rsvps"\)/g) ?? []).length).toBe(2);
  });

  it("scores each event once rather than inside the comparator", () => {
    expect(rankingSource).toContain("scoreEvent(event, nowMs)");
    const comparator = rankingSource.slice(rankingSource.indexOf("const ordered = scored.sort"));
    expect(comparator.slice(0, 300)).not.toContain("scoreEvent(");
  });

  it("keeps the candidate window bounded", () => {
    expect(projection).toContain("limit(MAX_RANKED_EVENTS)");
  });
});
