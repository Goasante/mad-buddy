import { describe, expect, it } from "vitest";

import { smartCardTier } from "@/lib/smart-card/home-gate";
import type { LinkrMutualForCard } from "@/lib/smart-card/linkr-context";
import { smartCardProviders, type SmartCardInput } from "@/lib/smart-card/providers";
import { resolveSmartCard } from "@/lib/smart-card/smart-card";

/**
 * Relationship states, and the boundary they must not cross.
 *
 * Card A owns the FIRST Muddy and cold-start discovery. These states are about
 * people the viewer already has a relationship with -- somebody waiting on an
 * answer, or a Linkr match both people chose -- so they add to Home rather than
 * repeating what the Activation card is already saying.
 */

const NOW = new Date("2026-08-05T10:00:00.000Z");

const mutual = (over: Partial<LinkrMutualForCard> = {}): LinkrMutualForCard => ({
  userId: "u1",
  connectionId: "conn-1",
  displayName: "Ama",
  photo: null,
  hasConversation: false,
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
    /* Entitlement KNOWN and present, so the two expansion-only states are
       eligible and these cases measure the state itself rather than the gate.
       Entitlement is exercised deliberately in access-entitlement.test.ts. */
    access: { canExpand: true },
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

describe("a waiting Muddy request is an obligation", () => {
  it("sits in tier 1", () => {
    expect(smartCardTier("muddy_request")).toBe(1);
  });

  it("speaks in people, not counts of nothing", () => {
    expect(pick({ incomingRequestCount: 1 })?.title).toBe("Someone wants to be your Muddy");
    expect(pick({ incomingRequestCount: 3 })?.title).toBe("3 people want to be your Muddies");
  });

  it("says nothing when nobody is waiting", () => {
    expect(pick({ incomingRequestCount: 0 })?.id).not.toBe("muddy_request");
  });

  it("yields to a Plan that needs an answer", () => {
    /* Both are obligations; the Plan has a time attached and the request does
       not, which is the whole reason muddy_request sits last in tier 1. */
    const card = pick({
      incomingRequestCount: 2,
      agenda: [
        {
          kind: "plan",
          id: "p1",
          title: "Dinner Friday",
          startAt: "2026-08-05T18:00:00.000Z",
          startsAt: "2026-08-05T18:00:00.000Z",
          endAt: "2026-08-05T20:00:00.000Z",
          endsAt: "2026-08-05T20:00:00.000Z",
          organiserName: "Ama",
          myRsvp: "invited",
          invitedCount: 2,
          goingCount: 1,
          maybeCount: 0,
          placeText: null,
          category: null,
          coverImageUrl: null,
          attendees: []
        } as unknown as SmartCardInput["agenda"][number]
      ]
    });
    expect(card?.id).toBe("plan_rsvp");
  });
});

describe("Linkr surfaces only what both people chose", () => {
  it("sits in tier 3, above opportunities and below what is happening", () => {
    expect(smartCardTier("linkr_mutual")).toBe(3);
  });

  it("names the connection as mutual", () => {
    const card = pick({ linkrMutuals: [mutual()] });
    expect(card?.id).toBe("linkr_mutual");
    expect(card?.title).toBe("You and Ama connected");
    expect(card?.eyebrow).toBe("YOU BOTH CONNECTED");
  });

  it("stays silent once the pair are already talking", () => {
    /* A conversation that exists is not a moment. Nagging about it would make
       Home feel like an inbox with an opinion. */
    expect(pick({ linkrMutuals: [mutual({ hasConversation: true })] })?.id).not.toBe("linkr_mutual");
  });

  it("counts only the connections still waiting for a first message", () => {
    const card = pick({
      linkrMutuals: [
        mutual({ userId: "a" }),
        mutual({ userId: "b", displayName: "Kofi" }),
        mutual({ userId: "c", hasConversation: true })
      ]
    });
    expect(card?.subtitle).toBe("2 Linkr connections are waiting for a first message.");
  });

  it("offers a first message rather than a recommendation", () => {
    // Never "people you might like" -- only somebody who already chose back.
    const card = pick({ linkrMutuals: [mutual()] });
    expect(card?.cta).toBe("Say hi");
    expect(card?.destination).toBe("/linkr?connection=conn-1");
  });

  it("uses the person's own photo when there is one", () => {
    const card = pick({ linkrMutuals: [mutual({ photo: "https://example.test/ama.jpg" })] });
    expect(card?.media?.url).toBe("https://example.test/ama.jpg");
    expect(card?.media?.alt).toBe("Ama");
  });
});

describe("Card A keeps the states it owns", () => {
  it("declares no first-Muddy provider", () => {
    // FirstMuddyCard owns that moment; a second card saying it would be the app
    // repeating itself exactly when it should feel warm.
    const built = input({ muddyCount: 0 });
    expect(smartCardProviders(built).some((provider) => provider.id === ("first_muddy" as never))).toBe(
      false
    );
  });

  it("does not answer a request the Activation card is already working", () => {
    /* request_pending is an EARLY activation state, so Home's tier gate keeps
       Card B quiet there; muddy_request is for a viewer whose Home has moved
       on. The gate is asserted in home-gate.test.ts -- what matters here is
       that the provider itself is about INCOMING requests, never the viewer's
       own outgoing one. */
    const card = pick({ incomingRequestCount: 1 });
    expect(card?.subtitle).toBe("They are waiting to hear back from you.");
  });
});
