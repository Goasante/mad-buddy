import { describe, expect, it } from "vitest";

import { smartCardTier } from "@/lib/smart-card/home-gate";
import type {
  EventLinkrOfferForCard,
  MuddyBirthdayForCard
} from "@/lib/smart-card/home-context";
import type { LinkrMutualForCard } from "@/lib/smart-card/linkr-context";
import { smartCardProviders, type SmartCardInput } from "@/lib/smart-card/providers";
import { resolveSmartCard } from "@/lib/smart-card/smart-card";

/**
 * FAMILY 3 -- the relationship states, and the consent boundaries they respect.
 *
 * These tests exist mostly to pin down what must NOT happen. Every state here
 * touches somebody other than the viewer, so each one is a chance to leak a
 * one-sided decision, a private date of birth, or a consent nobody gave. The
 * positive cases are easy; the refusals are the point.
 */

const NOW = new Date("2026-08-05T10:00:00.000Z");

const mutual = (over: Partial<LinkrMutualForCard> = {}): LinkrMutualForCard => ({
  userId: "u1",
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

describe("a mutual with a shared Event says where they met", () => {
  it("sits in tier 3 with the other relationship states", () => {
    expect(smartCardTier("linkr_mutual_event")).toBe(3);
  });

  it("names the Event the pair actually connected at", () => {
    const card = pick({ linkrMutuals: [mutual({ eventName: "Acoustic Night" })] });
    expect(card?.id).toBe("linkr_mutual_event");
    expect(card?.title).toBe("You connected at Acoustic Night");
    expect(card?.subtitle).toBe("You and Ama both chose to connect.");
  });

  it("offers a first message first, and a Plan only as the second step", () => {
    const card = pick({ linkrMutuals: [mutual({ eventName: "Acoustic Night" })] });
    expect(card?.cta).toBe("Say hi");
    expect(card?.secondaryAction).toEqual({ label: "Make a Plan", destination: "/plans" });
  });

  /**
   * The inference this state must never make. Event context is the PAIR's own
   * stored fact; a mutual with no Event on the connection gets the plain card,
   * however much Event history the two people might separately have.
   */
  it("falls back to the plain mutual when the connection carries no Event", () => {
    const card = pick({ linkrMutuals: [mutual({ eventName: null })] });
    expect(card?.id).toBe("linkr_mutual");
    expect(card?.title).toBe("You and Ama connected");
  });

  it("says nothing at all when the pair is already talking", () => {
    const card = pick({
      linkrMutuals: [mutual({ eventName: "Acoustic Night", hasConversation: true })]
    });
    expect(card?.id).not.toBe("linkr_mutual_event");
    expect(card?.id).not.toBe("linkr_mutual");
  });

  /**
   * The privacy line the whole Linkr family rests on. The provider only ever
   * sees mutual connections, so there is no shape of input that lets it
   * describe a one-sided click -- the collection it reads contains connections
   * and nothing else.
   */
  it("has no input that could express one-sided interest", () => {
    const card = pick({ linkrMutuals: [] });
    expect(card?.id).not.toBe("linkr_mutual_event");
    expect(card?.id).not.toBe("linkr_mutual");
  });
});

describe("Event Linkr is offered, never assumed", () => {
  const offer = (over: Partial<EventLinkrOfferForCard> = {}): EventLinkrOfferForCard => ({
    eventId: "e1",
    eventName: "Acoustic Night",
    href: "/events?event=e1",
    ...over
  });

  it("sits in tier 2 -- current, and only while the viewer is there", () => {
    expect(smartCardTier("event_linkr_ready")).toBe(2);
  });

  it("asks the question rather than announcing a decision", () => {
    const card = pick({ eventLinkrOffer: offer() });
    expect(card?.id).toBe("event_linkr_ready");
    expect(card?.title).toBe("Meet people at Acoustic Night?");
    expect(card?.subtitle).toBe("Choose whether to be discoverable to others here.");
  });

  /**
   * THE CHAIN. Going is not check-in, check-in is not consent, and consent is
   * not connection. The provider is handed an offer only when the Events
   * authority has already said "live check-in, no consent yet" -- so with no
   * offer present, no amount of Event agenda produces this card.
   */
  it("never appears without the Events authority having said so", () => {
    const goingSoon: SmartCardInput["agenda"] = [
      {
        kind: "event",
        id: "e1",
        title: "Acoustic Night",
        startsAt: new Date(NOW.getTime() + 30 * 60_000).toISOString(),
        endsAt: new Date(NOW.getTime() + 3 * 60 * 60_000).toISOString(),
        locationLabel: null,
        href: "/events?event=e1",
        isHost: false,
        myRsvp: "going",
        hostName: "Kofi",
        coverUrl: null,
        coverFocalX: null,
        coverFocalY: null
      }
    ];
    const card = pick({ agenda: goingSoon, eventLinkrOffer: null });
    expect(card?.id).not.toBe("event_linkr_ready");
  });

  it("points at the Event, where the real opt-in control lives", () => {
    const card = pick({ eventLinkrOffer: offer() });
    expect(card?.destination).toBe("/events?event=e1");
  });

  /**
   * The copy must not imply the viewer is already discoverable. "See how it
   * works" describes what the tap does; anything in the past tense would be a
   * claim about a consent they have not given.
   */
  it("uses a label that describes the tap, not a granted consent", () => {
    const card = pick({ eventLinkrOffer: offer() });
    expect(card?.cta).toBe("See how it works");
    expect(card?.subtitle).not.toMatch(/you are (open|discoverable)/i);
  });
});

describe("a Muddy birthday repeats a permitted fact, never a date", () => {
  const birthday = (over: Partial<MuddyBirthdayForCard> = {}): MuddyBirthdayForCard => ({
    userId: "u9",
    displayName: "Ama",
    ...over
  });

  it("sits in tier 3", () => {
    expect(smartCardTier("muddy_birthday")).toBe(3);
  });

  /**
   * The label describes the TAP. /notifications opens the notifications LIST;
   * the birthday row there opens the wish composer. So the button cannot say
   * "Send a message" -- it neither opens a composer nor sends anything, and
   * building a second birthday flow on Home to justify the shorter label would
   * be two surfaces answering one question.
   */
  it("names the person and describes what the tap actually opens", () => {
    const card = pick({ muddyBirthdays: [birthday()] });
    expect(card?.id).toBe("muddy_birthday");
    expect(card?.title).toBe("It's Ama's birthday 🎉");
    expect(card?.cta).toBe("Open birthday wishes");
    expect(card?.destination).toBe("/notifications");
    expect(card?.cta).not.toMatch(/^Send a message$/i);
  });

  it("counts a crowd without naming the rest of it", () => {
    const card = pick({ muddyBirthdays: [birthday(), birthday({ userId: "u10", displayName: "Kofi" })] });
    expect(card?.subtitle).toBe("2 of your Muddies are celebrating today.");
    expect(card?.subtitle).not.toContain("Kofi");
  });

  /**
   * The privacy invariant, enforced by the SHAPE of the input rather than by
   * the copy: there is no date of birth on MuddyBirthdayForCard, so no card
   * built from it can print one, and no provider can derive an age.
   */
  it("has no date of birth available to leak", () => {
    const card = pick({ muddyBirthdays: [birthday()] });
    const rendered = JSON.stringify(card);
    expect(rendered).not.toMatch(/\d{4}-\d{2}-\d{2}/);
    expect(Object.keys(birthday())).toEqual(["userId", "displayName"]);
  });

  it("stays silent when the ledger permitted nothing", () => {
    expect(pick({ muddyBirthdays: [] })?.id).not.toBe("muddy_birthday");
  });

  it("ranks someone else's birthday above the viewer's own", () => {
    const card = pick({
      muddyBirthdays: [birthday()],
      birthday: { birthdayToday: true, birthdayTomorrow: false }
    });
    expect(card?.id).toBe("muddy_birthday");
  });
});

describe("family 3 ranking against the states already proven", () => {
  it("keeps Safe Arrival above every relationship state", () => {
    const card = pick({
      safeArrival: { travelling: true, watcherCount: 2 },
      eventLinkrOffer: { eventId: "e1", eventName: "Acoustic Night", href: "/events?event=e1" },
      linkrMutuals: [mutual({ eventName: "Acoustic Night" })],
      muddyBirthdays: [{ userId: "u9", displayName: "Ama" }]
    });
    expect(card?.id).toBe("safe_arrival");
  });

  it("keeps a waiting Muddy request above a birthday", () => {
    const card = pick({
      incomingRequestCount: 1,
      muddyBirthdays: [{ userId: "u9", displayName: "Ama" }]
    });
    expect(card?.id).toBe("muddy_request");
  });

  it("prefers the Event-context mutual over the plain one", () => {
    const card = pick({
      linkrMutuals: [mutual({ userId: "u2", displayName: "Kofi" }), mutual({ eventName: "Acoustic Night" })]
    });
    expect(card?.id).toBe("linkr_mutual_event");
  });
});
