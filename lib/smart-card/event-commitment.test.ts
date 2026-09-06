import { describe, expect, it } from "vitest";

import { shouldShowSmartCardOnHome, smartCardTier } from "@/lib/smart-card/home-gate";
import { smartCardProviders, type SmartCardInput } from "@/lib/smart-card/providers";
import { resolveSmartCard } from "@/lib/smart-card/smart-card";
import type { UpcomingAgendaItem } from "@/lib/social/upcoming-agenda-projection";

/**
 * "Starts soon" means two different things.
 *
 * Hosting an Event, or having said you are going, is a COMMITMENT with a time
 * attached -- the same shape as a Plan starting soon. Being merely interested
 * is consideration. One provider treating both the same either interrupted a
 * brand-new viewer about an Event they bookmarked, or buried an Event they are
 * hosting in forty minutes. The split is by canonical agenda fields; nothing
 * re-queries Events.
 */

const NOW = new Date("2026-08-05T10:00:00.000Z");

const event = (over: Partial<Extract<UpcomingAgendaItem, { kind: "event" }>> = {}) =>
  ({
    kind: "event",
    id: "e1",
    title: "Acoustic Night",
    startsAt: "2026-08-05T10:45:00.000Z",
    endsAt: "2026-08-05T14:00:00.000Z",
    locationLabel: "Osu",
    href: "/events?event=e1",
    isHost: false,
    myRsvp: "interested",
    hostName: "Nana",
    coverUrl: null,
    coverFocalX: null,
    coverFocalY: null,
    ...over
  }) as UpcomingAgendaItem;

function input(agenda: UpcomingAgendaItem[], over: Partial<SmartCardInput> = {}): SmartCardInput {
  return {
    now: NOW,
    journey: { completedCount: 8, totalCount: 8, currentStep: null, steps: [] },
    safeArrival: null,
    birthday: null,
    agenda,
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

const pick = (agenda: UpcomingAgendaItem[], over: Partial<SmartCardInput> = {}) => {
  const built = input(agenda, over);
  return resolveSmartCard(smartCardProviders(built), {
    now: built.now.getTime(),
    acknowledgedIds: new Set(["journey_complete"])
  });
};

describe("commitment and consideration are different states", () => {
  it("puts hosting at tier 2", () => {
    expect(smartCardTier("event_commitment_starting")).toBe(2);
  });

  it("keeps interested-only at tier 4", () => {
    expect(smartCardTier("event_starting")).toBe(4);
  });

  it("treats going as a commitment", () => {
    const card = pick([event({ myRsvp: "going" })]);
    expect(card?.id).toBe("event_commitment_starting");
  });

  it("treats hosting as a commitment even without an RSVP row", () => {
    // A host does not RSVP to their own Event.
    const card = pick([event({ isHost: true, myRsvp: null })]);
    expect(card?.id).toBe("event_commitment_starting");
  });

  it("treats interested as consideration", () => {
    const card = pick([event({ myRsvp: "interested" })]);
    expect(card?.id).toBe("event_starting");
  });

  it("says nothing about an Event the viewer declined", () => {
    expect(pick([event({ myRsvp: "not_going" })])?.id).not.toBe("event_commitment_starting");
  });
});

describe("the gate follows the split", () => {
  it("reaches a viewer still in early activation when they committed", () => {
    /* Somebody hosting in forty minutes needs to know, even on their first
       week. This is the whole reason the state was split. */
    expect(
      shouldShowSmartCardOnHome({
        id: "event_commitment_starting",
        earlyActivation: true,
        cardAVisible: true
      })
    ).toMatchObject({ eligible: true, deferred: true });
  });

  it("does not interrupt early activation for a bookmark", () => {
    expect(
      shouldShowSmartCardOnHome({ id: "event_starting", earlyActivation: true, cardAVisible: true }).eligible
    ).toBe(false);
  });

  it("returns the interested Event once Home is mature", () => {
    expect(
      shouldShowSmartCardOnHome({ id: "event_starting", earlyActivation: false, cardAVisible: false }).eligible
    ).toBe(true);
  });
});

describe("copy tells the truth about the viewer's role", () => {
  it("names hosting explicitly", () => {
    const card = pick([event({ isHost: true, myRsvp: null })]);
    expect(card?.eyebrow).toBe("YOU ARE HOSTING");
    expect(card?.title).toBe("You are hosting Acoustic Night");
    expect(card?.subtitle).toContain("counting on you");
  });

  it("does not claim hosting for an attendee", () => {
    const card = pick([event({ myRsvp: "going" })]);
    expect(card?.eyebrow).toBe("STARTING SOON");
    expect(card?.title).toBe("Acoustic Night");
  });
});

describe("a live Event still outranks one starting soon", () => {
  it("prefers what is happening now", () => {
    const live = event({
      id: "live",
      startsAt: "2026-08-05T09:00:00.000Z",
      endsAt: "2026-08-05T13:00:00.000Z",
      myRsvp: "going"
    });
    const card = pick([event({ myRsvp: "going" }), live]);
    expect(card?.id).toBe("event_live");
  });
});

describe("covers come from the agenda's batched signing", () => {
  it("uses the signed cover and its focal point", () => {
    const card = pick([
      event({ myRsvp: "going", coverUrl: "https://signed.test/cover.jpg", coverFocalX: 0.3, coverFocalY: 0.7 })
    ]);
    expect(card?.media?.url).toBe("https://signed.test/cover.jpg");
    expect(card?.media?.focalX).toBe(0.3);
  });

  it("falls back to the branded treatment with no cover", () => {
    expect(pick([event({ myRsvp: "going" })])?.media).toBeUndefined();
  });
});
