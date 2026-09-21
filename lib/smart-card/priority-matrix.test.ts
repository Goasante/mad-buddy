import { describe, expect, it } from "vitest";

import type { JourneyData } from "@/lib/journey/journey";
import { smartCardProviders, type SmartCardInput, type SmartCardNearbyFriend } from "@/lib/smart-card/providers";
import { resolveSmartCard } from "@/lib/smart-card/smart-card";
import type { UpcomingAgendaItem } from "@/lib/social/upcoming-agenda-projection";

/**
 * The approved Smart Card ranking, asserted as head-to-head contests.
 *
 * Home shows exactly ONE card, so what matters is not that each provider can
 * build a card but which one WINS when several apply at once. Each case below
 * puts two real states in the same input and names the winner:
 *
 *   0 safety / truth
 *   1 the viewer owes someone an answer
 *   2 something social is happening now
 *   3 relationship momentum
 *   4 useful opportunity
 *   5 growth / progression
 *   6 fallback
 *
 * The rule this protects in plain terms: a Buddy Score meter must never
 * outrank an unanswered Plan, and Journey must never outrank a live Event or a
 * Muddy who is actually nearby.
 */

const NOW = new Date("2026-08-05T10:00:00.000Z");

const completeJourney: JourneyData = { completedCount: 8, totalCount: 8, currentStep: null, steps: [] };
const activeJourney: JourneyData = {
  completedCount: 3,
  totalCount: 8,
  currentStep: {
    id: "send_first_wave",
    title: "Send your first wave",
    description: "A wave is the lightest way to start.",
    state: "current",
    unlockCondition: "",
    destination: "/friends",
    guide: null
  },
  steps: []
};

/* PlanAgendaItem extends HomeUpcomingPlan, whose full shape is irrelevant to
   ranking -- the providers read kind, myRsvp, startsAt and title only. The cast
   keeps the fixture to the fields under test instead of carrying a dozen
   unrelated ones that would drift. */
const invitedPlan = {
  kind: "plan",
  id: "11111111-1111-4111-8111-111111111111",
  title: "Dinner Friday",
  startAt: "2026-08-05T18:00:00.000Z",
  startsAt: "2026-08-05T18:00:00.000Z",
  endAt: "2026-08-05T20:00:00.000Z",
  endsAt: "2026-08-05T20:00:00.000Z",
  organiserName: "Ama",
  myRsvp: "invited",
  invitedCount: 4,
  goingCount: 2,
  maybeCount: 0,
  placeText: "Osu",
  category: null,
  coverImageUrl: null,
  attendees: []
} as unknown as UpcomingAgendaItem;

/** Answered, so it cannot win on "you owe someone an answer". */
const startingPlan = {
  ...(invitedPlan as unknown as Record<string, unknown>),
  id: "33333333-3333-4333-8333-333333333333",
  myRsvp: "going",
  startAt: "2026-08-05T10:30:00.000Z",
  startsAt: "2026-08-05T10:30:00.000Z",
  endAt: "2026-08-05T12:30:00.000Z",
  endsAt: "2026-08-05T12:30:00.000Z"
} as unknown as UpcomingAgendaItem;

const liveEvent: UpcomingAgendaItem = {
  kind: "event",
  id: "22222222-2222-4222-8222-222222222222",
  title: "Acoustic Night",
  startsAt: "2026-08-05T09:00:00.000Z",
  endsAt: "2026-08-05T13:00:00.000Z",
  locationLabel: "Osu",
  href: "/events?event=22222222-2222-4222-8222-222222222222",
  isHost: false,
  myRsvp: "going",
  hostName: "Nana",
  coverUrl: null,
  coverFocalX: null,
  coverFocalY: null
};

const freshNearby: SmartCardNearbyFriend = {
  friend_id: "44444444-4444-4444-8444-444444444444",
  username: "ama",
  display_name: "Ama",
  avatar_url: null,
  proximity_band: "close_by",
  freshness_state: "live"
};

function input(overrides: Partial<SmartCardInput> = {}): SmartCardInput {
  return {
    now: NOW,
    journey: activeJourney,
    safeArrival: null,
    birthday: null,
    agenda: [],
    weekendPlanCount: 0,
    nearbyFriends: [],
    locationFreshForProximity: false,
    muddyCount: 4,
    buddyScore: null,
    recentAchievement: null,
    suggestionCount: 0,
    ...overrides
  };
}

const winner = (overrides: Partial<SmartCardInput>) => {
  const built = input(overrides);
  return resolveSmartCard(smartCardProviders(built), { now: built.now.getTime() })?.id ?? null;
};

const withScore = { buddyScore: { nextLevel: "Trusted Buddy", pointsToNext: 40, total: 60 } } as unknown as Partial<SmartCardInput>;
const withNearby = { nearbyFriends: [freshNearby], locationFreshForProximity: true };

describe("tier 0 — safety outranks everything", () => {
  it("beats a live Event, an unanswered Plan and a nearby Muddy at once", () => {
    expect(
      winner({
        safeArrival: { travelling: true, watcherCount: 2 },
        agenda: [invitedPlan, liveEvent],
        ...withNearby,
        ...withScore
      })
    ).toBe("safe_arrival");
  });
});

describe("tier 1 — you owe someone an answer", () => {
  it("an unanswered Plan beats a live Event", () => {
    expect(winner({ agenda: [invitedPlan, liveEvent] })).toBe("plan_rsvp");
  });

  it("an unanswered Plan beats a fresh nearby Muddy", () => {
    expect(winner({ agenda: [invitedPlan], ...withNearby })).toBe("plan_rsvp");
  });
});

describe("tier 2 — something social is happening now", () => {
  it("a Plan starting soon beats Journey and Buddy Score", () => {
    expect(winner({ agenda: [startingPlan], ...withScore })).toBe("plan_starting");
  });

  it("a live Event beats Journey and Buddy Score", () => {
    expect(winner({ agenda: [liveEvent], ...withScore })).toBe("event_live");
  });

  it("a fresh nearby Muddy beats Journey and Buddy Score", () => {
    expect(winner({ ...withNearby, ...withScore })).toBe("nearby_muddies");
  });
});

describe("tier 5 — growth never outranks a real obligation or opportunity", () => {
  it("Journey beats Buddy Score when both apply", () => {
    expect(winner({ ...withScore })).toBe("journey");
  });

  it("Buddy Score never beats an unanswered Plan", () => {
    expect(winner({ agenda: [invitedPlan], ...withScore })).toBe("plan_rsvp");
  });

  it("Buddy Score never beats a live Event", () => {
    expect(winner({ agenda: [liveEvent], ...withScore })).toBe("event_live");
  });

  it("Buddy Score never beats a nearby Muddy", () => {
    expect(winner({ ...withNearby, ...withScore })).toBe("nearby_muddies");
  });

  it("Buddy Score can win only once Journey is finished and nothing social applies", () => {
    expect(winner({ journey: completeJourney, ...withScore })).toBe("journey_complete");
  });
});

describe("cold start and quiet maturity", () => {
  it("names real people before offering generic progression", () => {
    // add_first_muddy IS the current Journey step here, so both states ask for
    // the same thing; suggestions win because they name someone real.
    const coldStart: JourneyData = {
      completedCount: 1,
      totalCount: 8,
      currentStep: {
        id: "add_first_muddy",
        title: "Add your first Muddy",
        description: "Mad Buddy works once one real person is in your circle.",
        state: "current",
        unlockCondition: "",
        destination: "/muddies",
        guide: null
      },
      steps: []
    };
    expect(winner({ journey: coldStart, muddyCount: 0, suggestionCount: 3 })).toBe("suggestions");
  });

  it("falls back to UpFor for a mature, quiet viewer", () => {
    const built = input({ journey: completeJourney });
    const card = resolveSmartCard(smartCardProviders(built), {
      now: built.now.getTime(),
      acknowledgedIds: new Set(["journey_complete"])
    });
    expect(card?.id).toBe("upfor_fallback");
    expect(card?.title).toBe("What are you UpFor today?");
    expect(card?.destination).toBe("/hangout-mode");
  });
});

describe("proximity privacy", () => {
  it("does not render when the viewer's own location is stale", () => {
    expect(winner({ nearbyFriends: [freshNearby], locationFreshForProximity: false })).not.toBe("nearby_muddies");
  });

  it("does not render when the Muddy's proximity is stale", () => {
    expect(
      winner({
        nearbyFriends: [{ ...freshNearby, freshness_state: "stale" }],
        locationFreshForProximity: true
      })
    ).not.toBe("nearby_muddies");
  });

  it("exposes no coordinates or numeric distance anywhere on the card", () => {
    const built = input(withNearby);
    const card = resolveSmartCard(smartCardProviders(built), { now: built.now.getTime() });
    expect(card?.id).toBe("nearby_muddies");

    const serialized = JSON.stringify(card);
    for (const forbidden of [
      "latitude",
      "longitude",
      "coordinate",
      "distance",
      "meters",
      "metres",
      " km",
      "accuracy",
      "geohash"
    ]) {
      expect(serialized.toLowerCase(), `${forbidden} must never reach the card`).not.toContain(forbidden);
    }
    // And no bare number-with-unit slipped into the copy.
    expect(`${card?.title} ${card?.subtitle} ${card?.meta ?? ""}`).not.toMatch(/\d+\s*(m|km|meters|metres)\b/i);
  });

  it("uses only the approved qualitative bands", () => {
    const APPROVED = ["Right Here", "Just Around", "Close By", "In Your Area", "Around Town", "Across Town"];
    const built = input(withNearby);
    const card = resolveSmartCard(smartCardProviders(built), { now: built.now.getTime() });
    expect(APPROVED.some((label) => card?.title?.includes(label))).toBe(true);
  });

  it("routes to a username, never a raw user id", () => {
    const built = input(withNearby);
    const card = resolveSmartCard(smartCardProviders(built), { now: built.now.getTime() });
    expect(card?.destination).toBe("/friends/ama");
    expect(card?.destination).not.toContain(freshNearby.friend_id);
  });
});
