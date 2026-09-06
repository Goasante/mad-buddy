import { describe, expect, it } from "vitest";

import { smartCardTier } from "@/lib/smart-card/home-gate";
import { smartCardProviders, type SmartCardInput } from "@/lib/smart-card/providers";
import { resolveSmartCard } from "@/lib/smart-card/smart-card";
import type { HomeUpForContext } from "@/lib/social/home-upfor-context";

/**
 * The UpFor family on Home's Smart Card.
 *
 * Every state reads one batched context and the canonical activity labels, so
 * these tests exercise the SELECTION and the COPY -- the two things a provider
 * actually decides. What they most guard is double-counting: an UpFor with
 * people waiting is an obligation, one with people confirmed is momentum, and
 * a single session must never produce both.
 */

const NOW = new Date("2026-08-05T10:00:00.000Z");

const owned = (over: Partial<HomeUpForContext["ownedLive"][number]> = {}) => ({
  id: "s1",
  activityType: "coffee" as const,
  activityLabel: "Coffee",
  startsAt: null,
  endsAt: null,
  pendingRequestCount: 0,
  acceptedCount: 0,
  ...over
});

const joined = (over: Partial<HomeUpForContext["joined"][number]> = {}) => ({
  id: "j1",
  ownerName: "Kofi",
  activityType: "gym" as const,
  activityLabel: "Gym",
  myStatus: "pending" as const,
  startsAt: null,
  endsAt: null,
  ...over
});

const context = (over: Partial<HomeUpForContext> = {}): HomeUpForContext => ({
  ownedLive: [],
  ownedScheduled: [],
  joined: [],
  ...over
});

function input(upFor: HomeUpForContext, over: Partial<SmartCardInput> = {}): SmartCardInput {
  return {
    now: NOW,
    // Journey complete and acknowledged so progression never masks the state
    // under test.
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
    upFor,
    ...over
  };
}

const pick = (upFor: HomeUpForContext, over: Partial<SmartCardInput> = {}) => {
  const built = input(upFor, over);
  return resolveSmartCard(smartCardProviders(built), {
    now: built.now.getTime(),
    acknowledgedIds: new Set(["journey_complete"])
  });
};

describe("no UpFor context yields no UpFor card", () => {
  it("falls back rather than inventing a state", () => {
    const built = input(context());
    const card = resolveSmartCard(smartCardProviders(built), {
      now: built.now.getTime(),
      acknowledgedIds: new Set(["journey_complete"])
    });
    expect(card?.id).toBe("upfor_fallback");
  });

  it("survives an absent context entirely", () => {
    // The batched read failing must cost one card, never the screen.
    const built = { ...input(context()), upFor: null };
    expect(
      resolveSmartCard(smartCardProviders(built), {
        now: built.now.getTime(),
        acknowledgedIds: new Set(["journey_complete"])
      })?.id
    ).toBe("upfor_fallback");
  });
});

describe("requests waiting are an obligation", () => {
  it("wins over every other UpFor state", () => {
    const card = pick(
      context({
        ownedLive: [owned({ pendingRequestCount: 3, acceptedCount: 2 })],
        joined: [joined({ myStatus: "accepted" })]
      })
    );
    expect(card?.id).toBe("upfor_requests");
    expect(smartCardTier("upfor_requests")).toBe(1);
  });

  it("counts people, not sessions", () => {
    const card = pick(
      context({
        ownedLive: [
          owned({ id: "a", pendingRequestCount: 2 }),
          owned({ id: "b", activityLabel: "Gym", pendingRequestCount: 1 })
        ]
      })
    );
    expect(card?.title).toContain("3 people");
  });

  it("names the activity when only one UpFor is waiting", () => {
    const card = pick(context({ ownedLive: [owned({ pendingRequestCount: 1 })] }));
    expect(card?.title).toBe("Someone wants to join your Coffee UpFor");
  });

  it("does not name one activity when several are waiting", () => {
    // "2 people want to join your Coffee UpFor" would be a lie when one of them
    // is asking about the Gym one.
    const card = pick(
      context({
        ownedLive: [
          owned({ id: "a", pendingRequestCount: 1 }),
          owned({ id: "b", activityLabel: "Gym", pendingRequestCount: 1 })
        ]
      })
    );
    expect(card?.title).toBe("2 people want to join your UpFors");
  });
});

describe("momentum and obligation are never the same card", () => {
  it("reports momentum only once nobody is waiting", () => {
    const card = pick(context({ ownedLive: [owned({ acceptedCount: 2, pendingRequestCount: 0 })] }));
    expect(card?.id).toBe("upfor_momentum");
    expect(card?.subtitle).toBe("2 Muddies are in.");
  });

  it("prefers the obligation while both are true of one session", () => {
    /* Accepted AND pending on the same UpFor: the owner still owes somebody an
       answer, so the tier-1 state wins and momentum stays silent rather than
       both describing the same session. */
    const card = pick(context({ ownedLive: [owned({ acceptedCount: 2, pendingRequestCount: 1 })] }));
    expect(card?.id).toBe("upfor_requests");
  });

  it("speaks naturally about a single yes", () => {
    const card = pick(context({ ownedLive: [owned({ acceptedCount: 1 })] }));
    expect(card?.subtitle).toBe("One Muddy is in. It only takes one.");
  });
});

describe("the viewer's own request states", () => {
  it("celebrates being accepted", () => {
    const card = pick(context({ joined: [joined({ myStatus: "accepted" })] }));
    expect(card?.id).toBe("upfor_accepted");
    expect(card?.title).toBe("Kofi said yes");
    expect(card?.subtitle).toBe("You are going to gym.");
  });

  it("reports a pending request honestly", () => {
    const card = pick(context({ joined: [joined({ myStatus: "pending" })] }));
    expect(card?.id).toBe("upfor_active_muddy");
    expect(card?.title).toBe("Kofi is UpFor gym");
    expect(card?.meta).toBe("Waiting on them");
  });

  it("puts an acceptance above a still-pending ask", () => {
    const card = pick(
      context({ joined: [joined({ id: "a", myStatus: "pending" }), joined({ id: "b", myStatus: "accepted" })] })
    );
    expect(card?.id).toBe("upfor_accepted");
  });
});

describe("scheduled UpFors", () => {
  it("announces one starting within three hours", () => {
    const card = pick(
      context({ ownedScheduled: [owned({ startsAt: "2026-08-05T11:00:00.000Z", acceptedCount: 2 })] })
    );
    expect(card?.id).toBe("owned_upfor_starting");
    expect(card?.subtitle).toBe("2 Muddies are in.");
  });

  it("keeps a distant one at the lower tier", () => {
    const card = pick(context({ ownedScheduled: [owned({ startsAt: "2026-08-06T18:00:00.000Z" })] }));
    expect(card?.id).toBe("upfor_scheduled");
    expect(smartCardTier("upfor_scheduled")).toBe(4);
  });

  it("supports more than one scheduled UpFor", () => {
    // Nothing assumes a single active session.
    const card = pick(
      context({
        ownedScheduled: [
          owned({ id: "a", startsAt: "2026-08-06T18:00:00.000Z" }),
          owned({ id: "b", activityLabel: "Gym", startsAt: "2026-08-07T18:00:00.000Z" })
        ]
      })
    );
    expect(card?.subtitle).toBe("2 UpFors scheduled.");
  });

  it("says nothing about visibility it cannot promise", () => {
    const card = pick(context({ ownedScheduled: [owned({ startsAt: "2026-08-06T18:00:00.000Z" })] }));
    // A scheduled UpFor is invisible to everyone until it starts; the copy must
    // not imply Muddies can see it yet.
    expect(card?.subtitle).toBe("Nobody sees it until it starts.");
  });
});

describe("artwork is truthful or absent", () => {
  it("uses approved activity art where the photograph matches", () => {
    const card = pick(context({ ownedLive: [owned({ activityType: "coffee", acceptedCount: 1 })] }));
    expect(card?.media?.url).toContain("coffee");
  });

  it("falls back to the branded treatment rather than dressing up an activity", () => {
    /* No approved photograph depicts a gym session, and borrowing the picnic
       one would be a small lie. The branded card is a real design. */
    const card = pick(
      context({ ownedLive: [owned({ activityType: "gym", activityLabel: "Gym", acceptedCount: 1 })] })
    );
    expect(card?.id).toBe("upfor_momentum");
    expect(card?.media).toBeUndefined();
  });
});

describe("every UpFor state routes somewhere real", () => {
  it.each([
    [context({ ownedLive: [owned({ pendingRequestCount: 1 })] }), "upfor_requests"],
    [context({ ownedLive: [owned({ acceptedCount: 1 })] }), "upfor_momentum"],
    [context({ joined: [joined({ myStatus: "accepted" })] }), "upfor_accepted"],
    [context({ joined: [joined({ myStatus: "pending" })] }), "upfor_active_muddy"],
    [context({ ownedScheduled: [owned({ startsAt: "2026-08-05T11:00:00.000Z" })] }), "owned_upfor_starting"],
    [context({ ownedScheduled: [owned({ startsAt: "2026-08-08T11:00:00.000Z" })] }), "upfor_scheduled"]
  ])("%#: resolves to %s with a real destination", (ctx, expected) => {
    const card = pick(ctx as HomeUpForContext);
    expect(card?.id).toBe(expected);
    expect(card?.destination).toBe("/hangout-mode");
    expect(card?.cta.length).toBeGreaterThan(0);
  });
});
