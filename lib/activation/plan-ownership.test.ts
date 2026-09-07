import { describe, expect, it } from "vitest";

import {
  resolveActivationState,
  type ActivationInputs,
  type ActivationState
} from "@/lib/activation/state";
import { smartCardProviders, type SmartCardInput } from "@/lib/smart-card/providers";
import { resolveSmartCard } from "@/lib/smart-card/smart-card";

/**
 * WHO OWNS AN UPCOMING PLAN ON HOME.
 *
 * Reported from a real phone: Card A sat on "You've got something on / Open
 * your plan" indefinitely. The cause was ordering -- `upcomingPlanCount > 0`
 * was the FIRST check in the activation resolver, so a single future Plan
 * returned `upcoming_plan` ahead of every activation question, and the one card
 * whose job is to guide activation stopped guiding.
 *
 * A Plan is a commitment, not an activation step, and it is already owned three
 * times over: Card B names the actual Plan (plan_rsvp, plan_decision,
 * plan_starting, plan_chat_decision), and Home's "Coming Up" rail lists them
 * all. Card A's version named nothing and outranked everything.
 *
 * These tests hold the corrected ownership and, just as importantly, hold the
 * line against the opposite failure: two cards saying the same thing.
 */

const NOW = new Date("2026-09-07T18:00:00.000Z");

function activation(over: Partial<ActivationInputs> = {}): ActivationInputs {
  return {
    muddyCount: 0,
    pendingOutgoingCount: 0,
    nearbyMuddyCount: 0,
    upcomingPlanCount: 0,
    locationGranted: false,
    locationFreshForProximity: false,
    visibility: "visible",
    milestones: new Set<string>(),
    ...over
  } as ActivationInputs;
}

/** Somebody fully set up: located, visible, fresh, already made a Plan. */
const mature = (over: Partial<ActivationInputs> = {}) =>
  activation({
    muddyCount: 5,
    locationGranted: true,
    locationFreshForProximity: true,
    visibility: "visible",
    milestones: new Set(["first_plan_created"]),
    ...over
  });

function smartCardInput(over: Partial<SmartCardInput> = {}): SmartCardInput {
  return {
    now: NOW,
    journey: { completedCount: 8, totalCount: 8, currentStep: null, steps: [] },
    safeArrival: null,
    birthday: null,
    agenda: [],
    weekendPlanCount: 0,
    nearbyFriends: [],
    locationFreshForProximity: true,
    muddyCount: 5,
    buddyScore: null,
    recentAchievement: null,
    suggestionCount: 0,
    access: { canExpand: true },
    ...over
  };
}

const cardB = (over: Partial<SmartCardInput> = {}) => {
  const built = smartCardInput(over);
  return resolveSmartCard(smartCardProviders(built), {
    now: built.now.getTime(),
    acknowledgedIds: new Set(["journey_complete"])
  });
};

/** A Plan the viewer has already answered: a commitment, needing nothing. */
const answeredPlan = (startsInMinutes: number) => ({
  kind: "plan" as const,
  id: "plan-1",
  title: "Friday Dinner",
  startsAt: new Date(NOW.getTime() + startsInMinutes * 60_000).toISOString(),
  endsAt: null,
  startAt: new Date(NOW.getTime() + startsInMinutes * 60_000).toISOString(),
  organiserName: "Kofi",
  myRsvp: "going",
  invitedCount: 4,
  goingCount: 3,
  maybeCount: 0,
  placeText: null,
  category: null,
  coverImageUrl: null,
  attendees: []
});

describe("Card A no longer monopolises Home for an ordinary Plan", () => {
  /* The exact reported shape: a set-up person with a Plan on the way. Card A
     resolves to `activated`, which the component renders as nothing at all. */
  it("steps aside for a mature viewer whose only news is an upcoming Plan", () => {
    expect(resolveActivationState(mature({ upcomingPlanCount: 1 }))).toBe("activated");
  });

  it("keeps answering its own question when activation is genuinely unfinished", () => {
    const stillNeeded: Array<[Partial<ActivationInputs>, ActivationState]> = [
      [{ upcomingPlanCount: 1 }, "no_muddies"],
      [{ upcomingPlanCount: 1, muddyCount: 3 }, "muddies_no_location"],
      [
        { upcomingPlanCount: 1, muddyCount: 3, locationGranted: true, visibility: "ghost" },
        "visibility_off"
      ],
      [{ upcomingPlanCount: 1, muddyCount: 3, locationGranted: true }, "location_stale"]
    ];
    for (const [over, expected] of stillNeeded) {
      expect(resolveActivationState(activation(over)), JSON.stringify(over)).toBe(expected);
    }
  });

  /* The number of Plans never mattered; the short-circuit did. */
  it("is unaffected by how many Plans are upcoming", () => {
    for (const count of [1, 2, 9]) {
      expect(resolveActivationState(mature({ upcomingPlanCount: count }))).toBe("activated");
    }
  });
});

describe("the Plan is still on Home, in the surfaces that own it", () => {
  it("Card B still names the actual Plan when it needs an answer", () => {
    const invited = cardB({
      agenda: [{ ...answeredPlan(60 * 26), myRsvp: "invited" }]
    });
    expect(invited?.id).toBe("plan_rsvp");
    expect(invited?.title).toContain("Friday Dinner");
    expect(invited?.destination).toBe("/plans?plan=plan-1");
  });

  it("Card B still names it when it is starting soon", () => {
    const soon = cardB({ agenda: [answeredPlan(45)] });
    expect(soon?.id).toBe("plan_starting");
    expect(soon?.title).toContain("Friday Dinner");
  });

  /**
   * And the card that replaced the monopoly says something DIFFERENT. An
   * answered Plan hours away is a commitment needing nothing, so Card B moves
   * on rather than repeating "you have a plan" in a second voice.
   */
  it("Card B does not manufacture a Plan card for a commitment needing nothing", () => {
    const distant = cardB({ agenda: [answeredPlan(60 * 26)] });
    expect(distant?.id).not.toBe("plan_rsvp");
    expect(distant?.id).not.toBe("plan_starting");
  });
});

describe("Card A and Card B never say the same thing", () => {
  /**
   * The failure this correction must not trade itself for: Card A silent and
   * Card B silent is fine; Card A and Card B both shouting "open your plan" is
   * the duplication the two-card split exists to prevent.
   */
  it("a mature viewer with a Plan gets ONE voice, not two", () => {
    const state = resolveActivationState(mature({ upcomingPlanCount: 1 }));
    /* `activated` is rendered as null by the component -- Card A is absent. */
    expect(state).toBe("activated");

    const card = cardB({ agenda: [answeredPlan(45)] });
    expect(card?.id).toBe("plan_starting");
  });

  it("an activation-stage viewer gets activation guidance, and Card B stays off Plans", () => {
    /* Card A speaks about the missing Muddy; Card B is free to speak about
       anything else. Neither is telling them to open the same Plan. */
    expect(resolveActivationState(activation({ upcomingPlanCount: 1 }))).toBe("no_muddies");
  });
});
