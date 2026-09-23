import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import type {
  BlockedFeatureForCard,
  EventLinkrOfferForCard,
  PlanChatDecisionForCard,
  PlanDecisionForCard
} from "@/lib/smart-card/home-context";
import type { LinkrMutualForCard } from "@/lib/smart-card/linkr-context";
import { smartCardProviders, type SmartCardInput } from "@/lib/smart-card/providers";
import { resolveSmartCard } from "@/lib/smart-card/smart-card";

/** Smart Cards depend on product eligibility, never ad-free entitlement. */

const NOW = new Date("2026-08-05T10:00:00.000Z");

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
  endsAt: "2026-08-05T14:00:00.000Z",
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

describe("Free Smart Card eligibility", () => {
  it("offers Event Linkr only when the checked-in consent offer exists", () => {
    expect(pick({ eventLinkrOffer: offer })?.id).toBe("event_linkr_ready");
    expect(pick({ eventLinkrOffer: null })?.id).not.toBe("event_linkr_ready");
    expect(pick({ eventLinkrOffer: offer })?.destination).toBe(offer.href);
  });

  it("offers profile recovery only for a feature blocked by its own requirements", () => {
    expect(pick({ blockedFeature: blocked })?.id).toBe("profile_blocking");
    expect(pick({ blockedFeature: blocked })?.title).toBe(blocked.requirement);
    expect(pick({ blockedFeature: null })?.id).not.toBe("profile_blocking");
  });

  it("always offers the ordinary UpFor fallback without an Access input", () => {
    expect(pick()).toMatchObject({
      id: "upfor_fallback",
      title: "What are you UpFor today?",
      destination: "/hangout-mode"
    });
  });

  it("preserves mutuals, pending requests, accepted coordination and Plan decisions", () => {
    expect(pick({ linkrMutuals: [mutual()] })?.id).toBe("linkr_mutual");
    expect(pick({ linkrMutuals: [mutual({ eventName: "Acoustic Night" })] })?.id).toBe("linkr_mutual_event");
    expect(pick({ upFor: ownedWithRequests })?.id).toBe("upfor_requests");
    expect(pick({ upFor: muddySideJoined("pending") })?.id).toBe("upfor_active_muddy");
    expect(pick({ upFor: muddySideJoined("accepted") })?.id).toBe("upfor_accepted");
    expect(pick({ planDecisions: [decision] })?.id).toBe("plan_decision");
    expect(pick({ planChatDecisions: [chatDecision] })?.id).toBe("plan_chat_decision");
    expect(pick({ incomingRequestCount: 1 })?.id).toBe("muddy_request");
    expect(pick({ muddyBirthdays: [{ userId: "u9", displayName: "Ama" }] })?.id).toBe("muddy_birthday");
  });

  it("keeps safety and existing commitment priority above new offers", () => {
    expect(pick({
      safeArrival: { travelling: true, watcherCount: 2 },
      upFor: muddySideJoined("accepted"),
      eventLinkrOffer: offer
    })?.id).toBe("safe_arrival");
    expect(pick({
      upFor: muddySideJoined("accepted"),
      linkrMutuals: [mutual()],
      eventLinkrOffer: offer
    })?.id).toBe("upfor_accepted");
  });

  it("does not query or carry advertising entitlement through Home Smart Cards", () => {
    for (const path of [
      "lib/smart-card/home-projection.ts",
      "lib/smart-card/home-context.ts",
      "lib/smart-card/providers.ts",
      "app/(app)/dashboard/page.tsx"
    ]) {
      const source = readFileSync(path, "utf8");
      expect(source).not.toMatch(/AccessForCard|canExpand|resolveAccessForUser|loadAccessForCard/);
    }
  });

  it.each([
    ["active", { hasAccess: true }],
    ["expired Welcome Access", { hasAccess: false }],
    ["no Access", { hasAccess: false }],
    ["unavailable", null]
  ])("%s ad-free state cannot alter any card", (_label, access) => {
    const shared = {
      eventLinkrOffer: offer,
      blockedFeature: blocked,
      linkrMutuals: [mutual()],
      upFor: ownedWithRequests,
      planDecisions: [decision],
      planChatDecisions: [chatDecision],
      muddyBirthdays: [{ userId: "u9", displayName: "Ama" }],
      incomingRequestCount: 1,
      safeArrival: { travelling: true, watcherCount: 1 }
    };
    // Extra runtime metadata is deliberately outside SmartCardInput.
    const withAdFreeMetadata = { ...shared, access };
    expect(buildAll(withAdFreeMetadata)).toEqual(buildAll(shared));
    expect(buildAll(shared).map((card) => card.id)).toEqual(expect.arrayContaining([
      "event_linkr_ready", "profile_blocking", "upfor_fallback", "safe_arrival"
    ]));
  });

  it("never sells or counts down in the Smart Card copy", () => {
    for (const card of buildAll({ eventLinkrOffer: offer, blockedFeature: blocked })) {
      const text = `${card.eyebrow ?? ""} ${card.title} ${card.subtitle} ${card.cta}`;
      expect(text, card.id).not.toMatch(/expired|upgrade|subscri|unlock|renew|trial ends|days left/i);
    }
  });
});
