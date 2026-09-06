import { describe, expect, it } from "vitest";
import { smartCardProviders, type SmartCardInput } from "@/lib/smart-card/providers";
import { resolveSmartCard, SMART_CARD_IDS } from "@/lib/smart-card/smart-card";
import type { JourneyData } from "@/lib/journey/journey";
import type { UpcomingAgendaItem } from "@/lib/social/upcoming-agenda-projection";

const NOW = new Date("2026-08-05T10:00:00.000Z");
const completeJourney: JourneyData = { completedCount: 9, totalCount: 9, currentStep: null, steps: [] };

const invitedPlan: UpcomingAgendaItem = {
  kind: "plan",
  id: "11111111-1111-4111-8111-111111111111",
  title: "Dinner Friday",
  startAt: "2026-08-05T12:00:00.000Z",
  endAt: "2026-08-05T14:00:00.000Z",
  organiserName: "Ama",
  myRsvp: "invited",
  invitedCount: 4,
  goingCount: 2,
  maybeCount: 0,
  placeText: "Osu",
  category: null,
  coverImageUrl: null,
  attendees: [
    { name: "Ama", avatarUrl: null },
    { name: "Kofi", avatarUrl: null }
  ]
};

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

function input(overrides: Partial<SmartCardInput> = {}): SmartCardInput {
  return {
    now: NOW,
    journey: completeJourney,
    safeArrival: null,
    birthday: null,
    agenda: [],
    weekendPlanCount: 0,
    nearbyFriends: [],
    locationFreshForProximity: false,
    muddyCount: 1,
    buddyScore: null,
    recentAchievement: null,
    suggestionCount: 0,
    ...overrides
  };
}

describe("Home Smart Card convergence", () => {
  it("has no membership upsell provider", () => {
    expect(SMART_CARD_IDS).not.toContain("membership" as never);
    expect(smartCardProviders(input()).some((provider) => provider.id === ("membership" as never))).toBe(false);
  });

  it("keeps exactly-one-card fallback behavior", () => {
    const built = input();
    const card = resolveSmartCard(smartCardProviders(built), {
      now: built.now.getTime(),
      acknowledgedIds: new Set(["journey_complete"])
    });
    expect(card?.id).toBe("upfor_fallback");
    expect(card?.destination).toBe("/hangout-mode");
  });

  it("keeps cold-start people help ahead of the UpFor fallback", () => {
    const built = input({ muddyCount: 0, suggestionCount: 3 });
    expect(resolveSmartCard(smartCardProviders(built), { now: built.now.getTime() })?.id).toBe("suggestions");
  });

  it("still prioritizes safety over every ordinary state", () => {
    const built = input({
      safeArrival: { travelling: true, watcherCount: 2 },
      agenda: [invitedPlan, liveEvent]
    });
    expect(resolveSmartCard(smartCardProviders(built), { now: built.now.getTime() })?.id).toBe("safe_arrival");
  });

  it("puts a real unanswered Plan above a live Event", () => {
    const built = input({ agenda: [liveEvent, invitedPlan] });
    const card = resolveSmartCard(smartCardProviders(built), { now: built.now.getTime() });
    expect(card?.id).toBe("plan_rsvp");
    expect(card?.title).toContain("needs your answer");
  });

  it("puts a live Event above progression when no answer is owed", () => {
    const activeJourney: JourneyData = {
      completedCount: 2,
      totalCount: 9,
      currentStep: { id: "find-a-muddy", title: "Find a Muddy", description: "Start with someone you know.", destination: "/friends" },
      steps: []
    };
    const built = input({ journey: activeJourney, agenda: [liveEvent] });
    expect(resolveSmartCard(smartCardProviders(built), { now: built.now.getTime() })?.id).toBe("event_live");
  });

  it("allows only fresh privacy-safe proximity to win", () => {
    const nearby = {
      friend_id: "33333333-3333-4333-8333-333333333333",
      display_name: "Ama",
      avatar_url: null,
      proximity_band: "close_by" as const,
      freshness_state: "live" as const
    };
    const fresh = input({ nearbyFriends: [nearby], locationFreshForProximity: true });
    expect(resolveSmartCard(smartCardProviders(fresh), { now: fresh.now.getTime() })?.id).toBe("nearby_muddies");
    expect(resolveSmartCard(smartCardProviders(fresh), { now: fresh.now.getTime() })?.meta).toBe("Close By");

    const stale = input({
      nearbyFriends: [{ ...nearby, freshness_state: "stale" }],
      locationFreshForProximity: true
    });
    expect(resolveSmartCard(smartCardProviders(stale), { now: stale.now.getTime() })?.id).not.toBe("nearby_muddies");
  });
});
