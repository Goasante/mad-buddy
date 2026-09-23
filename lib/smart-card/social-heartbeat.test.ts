import { describe, expect, it } from "vitest";

import { smartCardProviders, type SmartCardInput } from "@/lib/smart-card/providers";
import { resolveSmartCard } from "@/lib/smart-card/smart-card";
import type { HomeUpForContext } from "@/lib/social/home-upfor-context";

const NOW = new Date("2026-09-23T10:00:00.000Z");

function base(over: Partial<SmartCardInput> = {}): SmartCardInput {
  return {
    now: NOW,
    journey: { completedCount: 8, totalCount: 8, currentStep: null, steps: [] },
    safeArrival: null,
    birthday: null,
    agenda: [],
    weekendPlanCount: 0,
    nearbyFriends: [],
    locationFreshForProximity: false,
    muddyCount: 5,
    buddyScore: null,
    recentAchievement: null,
    suggestionCount: 0,
    ...over
  };
}

function pick(over: Partial<SmartCardInput> = {}) {
  const input = base(over);
  return resolveSmartCard(smartCardProviders(input), {
    now: input.now.getTime(),
    acknowledgedIds: new Set(["journey_complete"])
  });
}

const upFor = (over: Partial<HomeUpForContext> = {}): HomeUpForContext => ({
  ownedLive: [],
  ownedScheduled: [],
  joined: [],
  opportunities: [],
  ...over
});

describe("Home Smart Card is the social heartbeat", () => {
  it("makes a live Safe Arrival specific without inventing a watcher identity", () => {
    const card = pick({
      safeArrival: {
        travelling: true,
        watcherCount: 2,
        destinationLabel: "East Legon",
        expectedArrivalAt: "2026-09-23T10:30:00.000Z",
        status: "active"
      }
    });

    expect(card).toMatchObject({
      id: "safe_arrival",
      eyebrow: "SAFE ARRIVAL",
      title: "You're heading to East Legon",
      meta: "Expected in 30 min",
      metaKind: "time",
      cta: "Open Safe Arrival"
    });
    expect(card?.subtitle).toContain("2 Muddies are checking on you");
  });

  it("turns a Plan invitation into one compact answer: who, when and who is going", () => {
    const card = pick({
      agenda: [
        {
          kind: "plan",
          id: "p1",
          title: "Game Night",
          startsAt: "2026-09-23T15:00:00.000Z",
          endsAt: "2026-09-23T17:00:00.000Z",
          startAt: "2026-09-23T15:00:00.000Z",
          organiserName: "Kofi",
          myRsvp: "invited",
          invitedCount: 5,
          goingCount: 3,
          maybeCount: 1,
          placeText: "East Legon",
          category: null,
          coverImageUrl: null,
          attendees: []
        }
      ]
    });

    expect(card).toMatchObject({
      id: "plan_rsvp",
      title: "Game Night needs your answer",
      subtitle: "Kofi invited you.",
      meta: "Starts in 5 hours",
      metaKind: "time",
      socialProof: "3 going · 1 maybe",
      cta: "Respond",
      expiresAt: Date.parse("2026-09-23T17:00:00.000Z")
    });
  });

  it("pulls an imminent Plan forward without replacing Coming Up", () => {
    const start = "2026-09-23T10:45:00.000Z";
    const card = pick({
      agenda: [
        {
          kind: "plan",
          id: "p2",
          title: "Game Night",
          startsAt: start,
          endsAt: "2026-09-23T13:00:00.000Z",
          startAt: start,
          organiserName: "Ama",
          myRsvp: "going",
          invitedCount: 6,
          goingCount: 4,
          maybeCount: 1,
          placeText: "East Legon",
          category: null,
          coverImageUrl: null,
          attendees: []
        }
      ]
    });

    expect(card).toMatchObject({
      id: "plan_starting",
      title: "Game Night starts in 45 min",
      meta: "East Legon",
      metaKind: "location",
      socialProof: "4 going · 1 maybe",
      expiresAt: Date.parse(start)
    });
  });

  it("makes a live Event social and self-expiring", () => {
    const end = "2026-09-23T12:00:00.000Z";
    const card = pick({
      agenda: [
        {
          kind: "event",
          id: "e1",
          title: "Open Mic",
          startsAt: "2026-09-23T09:00:00.000Z",
          endsAt: end,
          locationLabel: "Osu",
          href: "/events?event=e1",
          isHost: false,
          myRsvp: "going",
          hostName: "Nana",
          coverUrl: null,
          coverFocalX: null,
          coverFocalY: null
        }
      ]
    });

    expect(card).toMatchObject({
      id: "event_live",
      eyebrow: "HAPPENING NOW",
      title: "Open Mic is happening now",
      meta: "Osu",
      metaKind: "location",
      socialProof: "Hosted by Nana",
      expiresAt: Date.parse(end)
    });
  });

  it("shows an untouched UpFor as a real person opportunity, then expires with it", () => {
    const end = "2026-09-23T12:00:00.000Z";
    const card = pick({
      upFor: upFor({
        opportunities: [
          {
            id: "u1",
            ownerId: "ama",
            ownerName: "Ama",
            activityType: "food",
            activityLabel: "Food",
            endsAt: end
          },
          {
            id: "u2",
            ownerId: "kofi",
            ownerName: "Kofi",
            activityType: "coffee",
            activityLabel: "Coffee",
            endsAt: end
          }
        ]
      })
    });

    expect(card).toMatchObject({
      id: "upfor_opportunity",
      eyebrow: "HAPPENING NOW",
      title: "Ama is UpFor food",
      subtitle: "You can ask to join while it's live.",
      socialProof: "2 of your Muddies are UpFor something right now.",
      cta: "See UpFor",
      expiresAt: Date.parse(end)
    });
  });

  it("uses structured metadata for a decision rather than dressing the question as a date", () => {
    const card = pick({
      planDecisions: [
        {
          planId: "p3",
          planTitle: "Dinner",
          question: "Where should we eat?",
          voterCount: 4
        }
      ]
    });

    expect(card).toMatchObject({
      id: "plan_decision",
      eyebrow: "NEEDS YOUR ANSWER",
      subtitle: "Your vote is still missing.",
      meta: "Where should we eat?",
      metaKind: "decision",
      socialProof: "4 people have voted",
      cta: "Vote now"
    });
  });

  it("lets a checked-in Event Linkr offer die with the Event", () => {
    const end = "2026-09-23T12:30:00.000Z";
    const card = pick({
      eventLinkrOffer: {
        eventId: "e4",
        eventName: "Acoustic Night",
        endsAt: end,
        href: "/events?event=e4"
      }
    });

    expect(card).toMatchObject({
      id: "event_linkr_ready",
      title: "Meet people at Acoustic Night?",
      expiresAt: Date.parse(end)
    });
  });

  it("falls back to an emotionally useful UpFor prompt instead of filler", () => {
    const card = pick();
    expect(card).toMatchObject({
      id: "upfor_fallback",
      title: "What are you UpFor today?",
      subtitle: "Let your Muddies know what you feel like doing and see who wants in.",
      cta: "Open UpFor"
    });
  });
});
