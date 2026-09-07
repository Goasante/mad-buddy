import { describe, expect, it } from "vitest";

import type {
  AccessForCard,
  BlockedFeatureForCard,
  EventLinkrOfferForCard,
  PlanChatDecisionForCard,
  PlanDecisionForCard
} from "@/lib/smart-card/home-context";
import type { LinkrMutualForCard } from "@/lib/smart-card/linkr-context";
import { smartCardProviders, type SmartCardInput } from "@/lib/smart-card/providers";
import { resolveSmartCard } from "@/lib/smart-card/smart-card";

/**
 * ENTITLEMENT ON HOME, and the line it must not cross.
 *
 * The rule is `lib/access/guard.ts`'s rule, applied to what Home SAYS rather
 * than to what the server allows: EXPIRY STOPS THE NEXT EXPANSION, IT NEVER
 * DESTROYS AN EXISTING COMMITMENT.
 *
 * So the interesting tests here are almost all negative. It is easy to gate a
 * feature; the hard part -- and the part a paywall usually gets wrong -- is that
 * an expired account must keep seeing the people it already matched with, the
 * UpFor it already joined, the Plan it already made and the message somebody
 * already sent. Those are not upsell opportunities. They are the person's life.
 */

const NOW = new Date("2026-08-05T10:00:00.000Z");

const HAS_ACCESS: AccessForCard = { canExpand: true };
const NO_ACCESS: AccessForCard = { canExpand: false };
/* Expired Welcome Access resolves to exactly the same answer as no access --
   the resolver reports only CURRENTLY valid sources, and Home is given nothing
   with which to describe what ended. It is kept as a separate constant because
   the scenarios below are about a person mid-life, not about a flag. */
const EXPIRED_WELCOME: AccessForCard = { canExpand: false };

const mutual = (over: Partial<LinkrMutualForCard> = {}): LinkrMutualForCard => ({
  userId: "u1",
  connectionId: "conn-1",
  displayName: "Ama",
  photo: null,
  hasConversation: false,
  ...over
});

const offer: EventLinkrOfferForCard = {
  eventId: "e1",
  eventName: "Acoustic Night",
  href: "/events?event=e1"
};

const blocked: BlockedFeatureForCard = {
  feature: "Linkr",
  requirement: "Add a profile photo in your profile before using Linkr.",
  href: "/profile"
};

const decision: PlanDecisionForCard = {
  planId: "p1",
  planTitle: "Friday Dinner",
  question: "Where should we eat?",
  voterCount: 4
};

const chatDecision: PlanChatDecisionForCard = {
  conversationId: "c1",
  planTitle: "Friday Dinner",
  question: "Which venue?"
};

/** An UpFor the viewer OWNS, with people waiting: an existing commitment. */
const ownedWithRequests: NonNullable<SmartCardInput["upFor"]> = {
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
  joined: [],
  opportunities: []
};

/**
 * UpFors somebody ELSE owns that the viewer already joined: the Muddy side.
 *
 * Two shapes, because the product distinguishes them and both are commitments:
 * a request still awaiting the owner's answer (`upfor_active_muddy`) and one
 * already accepted (`upfor_accepted`). Neither may be gated.
 */
const muddySideJoined = (
  myStatus: "pending" | "accepted"
): NonNullable<SmartCardInput["upFor"]> => ({
  ownedLive: [],
  opportunities: [],
  ownedScheduled: [],
  joined: [
    {
      id: "j1",
      ownerId: "owner-kofi",
      ownerIsCertainMuddy: true,
      coordinatedSinceAccepted: false,
      ownerName: "Kofi",
      activityType: "coffee",
      activityLabel: "Coffee",
      myStatus,
      startsAt: null,
      endsAt: null
    }
  ]
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

/** Every state a given input can produce, so continuity can be asserted in bulk. */
const buildAll = (over: Partial<SmartCardInput> = {}) => {
  const built = input(over);
  return smartCardProviders(built)
    .map((provider) => provider.build())
    .filter((card): card is NonNullable<typeof card> => card !== null);
};

describe("HAS ACCESS — everything behaves exactly as before", () => {
  it("offers Event Linkr to a checked-in viewer", () => {
    expect(pick({ eventLinkrOffer: offer, access: HAS_ACCESS })?.id).toBe("event_linkr_ready");
  });

  it("offers the blocked-profile fix", () => {
    expect(pick({ blockedFeature: blocked, access: HAS_ACCESS })?.id).toBe("profile_blocking");
  });

  it("asks the ordinary UpFor question in the fallback", () => {
    const card = pick({ access: HAS_ACCESS });
    expect(card?.id).toBe("upfor_fallback");
    expect(card?.title).toBe("What are you UpFor today?");
    expect(card?.destination).toBe("/hangout-mode");
  });
});

describe("NO ACCESS — expansions stop", () => {
  /**
   * The server refuses the Event Linkr opt-in without Access, so offering it
   * would send somebody to a door that will not open.
   */
  it("does not offer Event Linkr discovery", () => {
    const card = pick({ eventLinkrOffer: offer, access: NO_ACCESS });
    expect(card?.id).not.toBe("event_linkr_ready");
  });

  /**
   * profile_blocking promises that finishing the profile makes you
   * discoverable. Without Access that promise does not come true, so the card
   * would be asking for work that changes nothing.
   */
  it("does not ask for profile work that would not make them discoverable", () => {
    const card = pick({ blockedFeature: blocked, access: NO_ACCESS });
    expect(card?.id).not.toBe("profile_blocking");
  });

  /**
   * The fallback is the LAST provider, so it can never return null -- Home
   * would blank. It changes what it says instead, and says something true.
   */
  it("still fills the fallback slot, with honest copy", () => {
    const card = pick({ access: NO_ACCESS });
    expect(card?.id).toBe("upfor_fallback");
    expect(card?.title).toBe("Catch up with your Muddies");
    expect(card?.destination).toBe("/friends");
  });

  /**
   * Copy discipline from the Access constitution: never imply Mad Buddy itself
   * has ended, never count down, never sell.
   */
  it("never implies the whole product has ended, and never sells", () => {
    for (const card of buildAll({ access: NO_ACCESS })) {
      const text = `${card.eyebrow ?? ""} ${card.title} ${card.subtitle} ${card.cta}`;
      expect(text, card.id).not.toMatch(/expired|upgrade|subscri|unlock|renew|trial ends|days left/i);
    }
  });
});

describe("NO ACCESS — existing commitments are untouched", () => {
  it("keeps an existing Linkr mutual, and its Event context", () => {
    const plain = pick({ linkrMutuals: [mutual()], access: NO_ACCESS });
    expect(plain?.id).toBe("linkr_mutual");
    expect(plain?.cta).toBe("Say hi");

    const withEvent = pick({
      linkrMutuals: [mutual({ eventName: "Acoustic Night" })],
      access: NO_ACCESS
    });
    expect(withEvent?.id).toBe("linkr_mutual_event");
  });

  it("keeps an UpFor the viewer owns and the people waiting on it", () => {
    const card = pick({ upFor: ownedWithRequests, access: NO_ACCESS });
    expect(card?.id).toBe("upfor_requests");
  });

  it("keeps a Muddy-side UpFor the viewer already joined, pending or accepted", () => {
    expect(pick({ upFor: muddySideJoined("pending"), access: NO_ACCESS })?.id).toBe(
      "upfor_active_muddy"
    );
    expect(pick({ upFor: muddySideJoined("accepted"), access: NO_ACCESS })?.id).toBe(
      "upfor_accepted"
    );
  });

  it("keeps Plan obligations, decisions and Plan Chat coordination", () => {
    expect(pick({ planDecisions: [decision], access: NO_ACCESS })?.id).toBe("plan_decision");
    expect(pick({ planChatDecisions: [chatDecision], access: NO_ACCESS })?.id).toBe(
      "plan_chat_decision"
    );
  });

  it("keeps safety at full authority", () => {
    const card = pick({
      safeArrival: { travelling: true, watcherCount: 2 },
      access: NO_ACCESS
    });
    expect(card?.id).toBe("safe_arrival");
  });

  it("keeps Muddy requests, birthdays and Journey", () => {
    expect(pick({ incomingRequestCount: 1, access: NO_ACCESS })?.id).toBe("muddy_request");
    expect(pick({ muddyBirthdays: [{ userId: "u9", displayName: "Ama" }], access: NO_ACCESS })?.id).toBe(
      "muddy_birthday"
    );
  });

  /**
   * The blanket assertion. Only the two expansion states may differ between an
   * entitled and an unentitled viewer; every other state must produce an
   * identical card. Written as a diff so a future gate added to the wrong
   * provider fails here rather than in production.
   */
  it("gates ONLY the expansion states, and nothing else", () => {
    const shared: Partial<SmartCardInput> = {
      linkrMutuals: [mutual({ eventName: "Acoustic Night" })],
      upFor: ownedWithRequests,
      planDecisions: [decision],
      planChatDecisions: [chatDecision],
      muddyBirthdays: [{ userId: "u9", displayName: "Ama" }],
      incomingRequestCount: 1,
      eventLinkrOffer: offer,
      blockedFeature: blocked,
      safeArrival: { travelling: true, watcherCount: 1 }
    };

    const entitled = new Map(
      buildAll({ ...shared, access: HAS_ACCESS }).map((card) => [card.id, JSON.stringify(card)])
    );
    const unentitled = new Map(
      buildAll({ ...shared, access: NO_ACCESS }).map((card) => [card.id, JSON.stringify(card)])
    );

    const missing = [...entitled.keys()].filter((id) => !unentitled.has(id));
    expect(missing.sort()).toEqual(["event_linkr_ready", "profile_blocking"]);

    /* Everything both viewers see must be BYTE-IDENTICAL, except the fallback,
       whose whole job is to say something different when there is nothing to
       expand into. */
    for (const [id, json] of entitled) {
      if (id === "event_linkr_ready" || id === "profile_blocking" || id === "upfor_fallback") continue;
      expect(unentitled.get(id), `${id} changed for an unentitled viewer`).toBe(json);
    }
  });
});

describe("EXPIRED ACCESS WITH AN EXISTING COMMITMENT", () => {
  /**
   * The scenario the guard was written for: Welcome Access ran out while the
   * person was mid-life. Their world must not shrink.
   */
  it("still shows the mutual they matched with before it expired", () => {
    const card = pick({
      linkrMutuals: [mutual({ displayName: "Ama", eventName: "Acoustic Night" })],
      access: EXPIRED_WELCOME
    });
    expect(card?.id).toBe("linkr_mutual_event");
    expect(card?.title).toBe("You connected at Acoustic Night");
    expect(card?.cta).toBe("Say hi");
  });

  it("still shows the UpFor they were already running", () => {
    expect(pick({ upFor: ownedWithRequests, access: EXPIRED_WELCOME })?.id).toBe("upfor_requests");
  });

  it("still shows the UpFor they had already joined", () => {
    expect(pick({ upFor: muddySideJoined("pending"), access: EXPIRED_WELCOME })?.id).toBe(
      "upfor_active_muddy"
    );
    expect(pick({ upFor: muddySideJoined("accepted"), access: EXPIRED_WELCOME })?.id).toBe(
      "upfor_accepted"
    );
  });

  it("ranks an existing commitment above the fallback, as it always did", () => {
    const card = pick({
      upFor: muddySideJoined("accepted"),
      linkrMutuals: [mutual()],
      access: EXPIRED_WELCOME
    });
    /* Tier 2 beats tier 3 beats the fallback -- entitlement changed nothing
       about the ordering, only about which expansions exist. */
    expect(card?.id).toBe("upfor_accepted");
  });

  it("does not offer the new expansion", () => {
    expect(pick({ eventLinkrOffer: offer, access: EXPIRED_WELCOME })?.id).not.toBe(
      "event_linkr_ready"
    );
  });
});

describe("UNKNOWN entitlement — expansion fails CLOSED, continuity fails OPEN", () => {
  /**
   * The boundary this suite exists to hold, and it is not the obvious one.
   *
   * "Fail open" is the right instinct for a screen, and the wrong one for an
   * OFFER. If entitlement cannot be resolved, advertising Event Linkr discovery
   * promises a door the server may refuse, and telling somebody that finishing
   * their profile will make them discoverable may simply be untrue. Suppressing
   * an offer costs a card; making a false promise costs trust.
   *
   * Continuity is safe regardless, and structurally so: no continuity provider
   * reads the access flag at all.
   */
  const UNKNOWN: Array<[string, Partial<SmartCardInput>]> = [
    ["absent", {}],
    ["explicitly null", { access: null }]
  ];

  for (const [label, unknown] of UNKNOWN) {
    it(`${label} entitlement suppresses the expansion offers`, () => {
      expect(pick({ ...unknown, eventLinkrOffer: offer })?.id).not.toBe("event_linkr_ready");
      expect(pick({ ...unknown, blockedFeature: blocked })?.id).not.toBe("profile_blocking");
    });

    it(`${label} entitlement still fills the fallback with free-core copy`, () => {
      const card = pick(unknown);
      expect(card).not.toBeNull();
      expect(card?.id).toBe("upfor_fallback");
      expect(card?.title).toBe("Catch up with your Muddies");
    });

    it(`${label} entitlement leaves the existing social world untouched`, () => {
      expect(pick({ ...unknown, linkrMutuals: [mutual()] })?.id).toBe("linkr_mutual");
      expect(pick({ ...unknown, upFor: ownedWithRequests })?.id).toBe("upfor_requests");
      expect(pick({ ...unknown, upFor: muddySideJoined("accepted") })?.id).toBe("upfor_accepted");
      expect(pick({ ...unknown, planDecisions: [decision] })?.id).toBe("plan_decision");
      expect(
        pick({ ...unknown, safeArrival: { travelling: true, watcherCount: 1 } })?.id
      ).toBe("safe_arrival");
    });
  }

  /**
   * Byte identity against the KNOWN no-access viewer. Unknown and no-access
   * must be indistinguishable on screen: anything else would leak the state of
   * the entitlement system into somebody's Home.
   */
  it("is byte-identical to a known no-access viewer", () => {
    const shared: Partial<SmartCardInput> = {
      linkrMutuals: [mutual({ eventName: "Acoustic Night" })],
      upFor: ownedWithRequests,
      planDecisions: [decision],
      planChatDecisions: [chatDecision],
      muddyBirthdays: [{ userId: "u9", displayName: "Ama" }],
      incomingRequestCount: 1,
      eventLinkrOffer: offer,
      blockedFeature: blocked,
      safeArrival: { travelling: true, watcherCount: 1 }
    };
    const known = buildAll({ ...shared, access: NO_ACCESS }).map((c) => JSON.stringify(c));
    const unknown = buildAll({ ...shared, access: null }).map((c) => JSON.stringify(c));
    expect(unknown).toEqual(known);
  });
});
