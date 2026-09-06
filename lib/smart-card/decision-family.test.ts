import { describe, expect, it } from "vitest";

import { smartCardTier } from "@/lib/smart-card/home-gate";
import type {
  PlanChatDecisionForCard,
  PlanDecisionForCard
} from "@/lib/smart-card/home-context";
import { smartCardProviders, type SmartCardInput } from "@/lib/smart-card/providers";
import { resolveSmartCard } from "@/lib/smart-card/smart-card";

/**
 * FAMILY 4 -- coordination, and the line that keeps Home from becoming an inbox.
 *
 * Every state here is built from a STRUCTURED decision: an open poll with the
 * viewer's answer missing. None of them is built from an unread count, a
 * message preview, or any classification of what a conversation is "about".
 * That is the distinction these tests exist to hold: Home surfaces decisions
 * somebody is blocked on, and says nothing about correspondence.
 */

const NOW = new Date("2026-08-05T10:00:00.000Z");

const decision = (over: Partial<PlanDecisionForCard> = {}): PlanDecisionForCard => ({
  planId: "p1",
  planTitle: "Friday Dinner",
  question: "Where should we eat?",
  voterCount: 4,
  ...over
});

const chatDecision = (
  over: Partial<PlanChatDecisionForCard> = {}
): PlanChatDecisionForCard => ({
  conversationId: "c1",
  planTitle: "Friday Dinner",
  question: "Which venue?",
  ...over
});

function input(over: Partial<SmartCardInput> = {}): SmartCardInput {
  return {
    now: NOW,
    journey: { completedCount: 8, totalCount: 8, currentStep: null, steps: [] },
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
    ...over
  };
}

const pick = (over: Partial<SmartCardInput> = {}) => {
  const built = input(over);
  return resolveSmartCard(smartCardProviders(built), {
    now: built.now.getTime(),
    acknowledgedIds: new Set(["journey_complete"])
  });
};

describe("a Plan decision is an answer only the viewer can give", () => {
  it("sits in tier 1 with the other obligations", () => {
    expect(smartCardTier("plan_decision")).toBe(1);
  });

  it("names the Plan and what is being decided", () => {
    const card = pick({ planDecisions: [decision()] });
    expect(card?.id).toBe("plan_decision");
    expect(card?.title).toBe("Friday Dinner needs a decision");
    expect(card?.meta).toBe("Where should we eat?");
  });

  it("reports progress honestly, in both directions", () => {
    expect(pick({ planDecisions: [decision({ voterCount: 4 })] })?.subtitle).toBe(
      "4 people have voted. Yours is still missing."
    );
    expect(pick({ planDecisions: [decision({ voterCount: 1 })] })?.subtitle).toBe(
      "1 person has voted. Yours is still missing."
    );
    expect(pick({ planDecisions: [decision({ voterCount: 0 })] })?.subtitle).toBe(
      "Nobody has voted yet. Yours would be the first."
    );
  });

  /**
   * The button says what the tap does. "Vote now" opens the canonical poll UI
   * where the vote is actually cast -- it does not mutate from Home, and it
   * does not claim to.
   */
  it("opens the canonical poll surface", () => {
    expect(pick({ planDecisions: [decision()] })?.cta).toBe("Vote now");
    expect(pick({ planDecisions: [decision()] })?.destination).toBe("/plans");
  });

  /**
   * The eligibility rule, expressed as the only thing a pure provider can
   * check: an empty list. A closed poll, a poll the viewer already answered and
   * a poll on a Plan they cannot see are all filtered by the reader before
   * reaching here, so each produces no card.
   */
  it("says nothing when no decision is outstanding", () => {
    expect(pick({ planDecisions: [] })?.id).not.toBe("plan_decision");
  });
});

describe("a Plan Chat decision is structured, never message text", () => {
  it("sits in tier 2 -- coordination happening now", () => {
    expect(smartCardTier("plan_chat_decision")).toBe(2);
  });

  it("says what is being decided, using the poll's own question", () => {
    const card = pick({ planChatDecisions: [chatDecision()] });
    expect(card?.id).toBe("plan_chat_decision");
    expect(card?.title).toBe("Friday Dinner is deciding");
    expect(card?.subtitle).toBe("Which venue?");
  });

  it("still works when the Plan title is unavailable", () => {
    const card = pick({ planChatDecisions: [chatDecision({ planTitle: null })] });
    expect(card?.title).toBe("A Plan is deciding");
  });

  /**
   * The inbox line. This card is built from a poll, so there is no shape of
   * input that can make it say "3 unread messages" -- the provider is never
   * handed a count, a preview, or a message body.
   */
  it("cannot express an unread count", () => {
    const card = pick({ planChatDecisions: [chatDecision()] });
    const rendered = JSON.stringify(card);
    expect(rendered).not.toMatch(/unread/i);
    expect(Object.keys(chatDecision())).toEqual(["conversationId", "planTitle", "question"]);
  });

  it("says nothing when no poll is open", () => {
    expect(pick({ planChatDecisions: [] })?.id).not.toBe("plan_chat_decision");
  });
});

/**
 * THE RANKING CONFLICTS the programme asked for by name. Each is a pair that
 * could plausibly be ordered either way, decided once here so the answer cannot
 * drift when a later state is added between them.
 */
describe("deterministic conflicts", () => {
  const safeArrival = { travelling: true, watcherCount: 1 };
  const rsvpAgenda: SmartCardInput["agenda"] = [
    {
      kind: "plan",
      id: "p9",
      title: "Sunday Brunch",
      startsAt: new Date(NOW.getTime() + 26 * 60 * 60_000).toISOString(),
      endsAt: null,
      startAt: new Date(NOW.getTime() + 26 * 60 * 60_000).toISOString(),
      organiserName: "Kofi",
      myRsvp: "invited",
      invitedCount: 3,
      goingCount: 1,
      maybeCount: 0,
      placeText: null,
      category: null,
      coverImageUrl: null,
      attendees: []
    }
  ];

  it("Safe Arrival outranks a Plan decision", () => {
    expect(pick({ safeArrival, planDecisions: [decision()] })?.id).toBe("safe_arrival");
  });

  it("Plan RSVP outranks a Plan decision", () => {
    const card = pick({ agenda: rsvpAgenda, planDecisions: [decision()] });
    expect(card?.id).toBe("plan_rsvp");
  });

  it("a Plan decision outranks a Linkr mutual", () => {
    const card = pick({
      planDecisions: [decision()],
      linkrMutuals: [
        { userId: "u1", displayName: "Ama", photo: null, hasConversation: false, eventName: null }
      ]
    });
    expect(card?.id).toBe("plan_decision");
  });

  it("an UpFor request outranks a Plan Chat decision", () => {
    const card = pick({
      planChatDecisions: [chatDecision()],
      upFor: {
        ownedLive: [
          {
            id: "s1",
            activityType: "coffee",
            activityLabel: "Coffee",
            startsAt: null,
            endsAt: null,
            pendingRequestCount: 2,
            acceptedCount: 0
          }
        ],
        ownedScheduled: [],
        joined: []
      }
    });
    expect(card?.id).toBe("upfor_requests");
  });

  it("a Plan decision outranks the Journey", () => {
    const card = pick({
      planDecisions: [decision()],
      journey: {
        completedCount: 3,
        totalCount: 8,
        currentStep: {
          id: "add_first_muddy",
          title: "Add your first Muddy",
          description: "Connect with someone you know.",
          state: "current",
          unlockCondition: "",
          destination: "/friends",
          guide: null
        },
        steps: []
      }
    });
    expect(card?.id).toBe("plan_decision");
  });

  it("a Plan Chat decision outranks a Muddy birthday", () => {
    const card = pick({
      planChatDecisions: [chatDecision()],
      muddyBirthdays: [{ userId: "u9", displayName: "Ama" }]
    });
    expect(card?.id).toBe("plan_chat_decision");
  });
});
