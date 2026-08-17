import { describe, expect, it } from "vitest";
import {
  hasReachedFirstValue,
  primaryActionFor,
  resolveActivationState,
  resumeState,
  shouldTeachGlow,
  actionForMuddy,
  type MuddyContext,
  type ActivationInputs
} from "@/lib/activation/state";

/**
 * Activation answers "what does this person need next", from the world as it
 * is -- never from a stored cursor that can disagree with reality.
 */

const base: ActivationInputs = {
  muddyCount: 0,
  pendingOutgoingCount: 0,
  locationGranted: false,
  /* Setup and freshness move together in the fixture's DEFAULT only.
   *
   * Every existing case here sets `locationGranted: true` to mean "location
   * works", and used to get a nearby verdict for free. The stale case is the
   * one place they diverge, and it has its own tests. */
  locationFreshForProximity: false,
  visibility: "visible",
  nearbyMuddyCount: 0,
  upcomingPlanCount: 0,
  milestones: new Set<string>()
};

const withState = (over: Partial<ActivationInputs>): ActivationInputs => ({ ...base, ...over });

describe("nothing works before the first Muddy", () => {
  it("leads with finding people when there are none", () => {
    expect(resolveActivationState(base)).toBe("no_muddies");
  });

  it("asks for people, not for a Plan", () => {
    // Pushing "Make a Plan" at somebody with nobody to invite asks for a
    // commitment the app has not earned.
    expect(primaryActionFor("no_muddies")).toBe("find_muddies");
  });

  it("does not ask for location before anyone can be seen", () => {
    // A permission prompt whose value cannot be demonstrated is a prompt
    // people decline. There is nobody to see yet.
    expect(resolveActivationState(base)).not.toBe("muddies_no_location");
  });

  it("does not teach Glow to an empty room", () => {
    // Explaining proximity with no Muddies is a tutorial about a concept whose
    // payoff cannot be observed, and it delays what actually unblocks them.
    expect(shouldTeachGlow(base)).toBe(false);
  });
});

describe("a request already sent is not nothing", () => {
  const waiting = withState({ pendingOutgoingCount: 1 });

  it("acknowledges the wait instead of repeating the first ask", () => {
    expect(resolveActivationState(waiting)).toBe("request_pending");
  });

  it("suggests widening the net, never nudging the same person again", () => {
    expect(primaryActionFor("request_pending")).toBe("find_muddies");
  });

  it("gives way the moment the request is accepted", () => {
    const accepted = withState({ pendingOutgoingCount: 0, muddyCount: 1 });
    expect(resolveActivationState(accepted)).not.toBe("request_pending");
  });
});

describe("visibility is not the same thing as permission", () => {
  /* New profiles are created `ghost`, and most production accounts still are.
   * Treating ghost as "a settled decision, leave them alone" sent exactly
   * those people to a state claiming nobody was around -- when the truth was
   * that they had never appeared themselves. */
  const ghostWithMuddy = withState({
    muddyCount: 1,
    locationGranted: true,
    visibility: "ghost"
  });

  it("names the real reason nobody can see them", () => {
    expect(resolveActivationState(ghostWithMuddy)).toBe("visibility_off");
  });

  it("does not pretend the area is empty", () => {
    expect(resolveActivationState(ghostWithMuddy)).not.toBe("no_one_nearby");
  });

  it("offers their own Glow rather than another location prompt", () => {
    expect(primaryActionFor("visibility_off")).toBe("enable_visibility");
  });

  it("still asks for location first when there is no fix at all", () => {
    // Permission is the prerequisite; visibility is the choice on top of it.
    const noFix = withState({ muddyCount: 1, locationGranted: false, visibility: "ghost" });
    expect(resolveActivationState(noFix)).toBe("muddies_no_location");
  });

  it("leaves a visible, located person alone", () => {
    const fine = withState({ muddyCount: 1, locationGranted: true, visibility: "visible" });
    expect(resolveActivationState(fine)).not.toBe("visibility_off");
  });
});

describe("the action for one specific Muddy", () => {
  const ctx = (over: Partial<MuddyContext> = {}): MuddyContext => ({
    hasSharedUpcomingPlan: false,
    hasExistingConversation: false,
    isNearby: false,
    ...over
  });

  it("opens something already arranged before suggesting anything", () => {
    expect(actionForMuddy(ctx({ hasSharedUpcomingPlan: true, isNearby: true }))).toBe("view_plan");
  });

  it("says hi to somebody you have never messaged", () => {
    // Waving at a person you have never spoken to is a gesture with no context.
    expect(actionForMuddy(ctx())).toBe("say_hi");
  });

  it("still says hi to a new Muddy who happens to be nearby", () => {
    expect(actionForMuddy(ctx({ isNearby: true }))).toBe("say_hi");
  });

  it("waves once you have spoken and they are around", () => {
    expect(actionForMuddy(ctx({ hasExistingConversation: true, isNearby: true }))).toBe("wave");
  });

  it("falls back to a message rather than demanding a plan", () => {
    // A commitment is more than the app should ask for by default.
    expect(actionForMuddy(ctx({ hasExistingConversation: true }))).toBe("message");
  });

  it("never proposes a plan as the opening move with one person", () => {
    for (const nearby of [true, false]) {
      for (const talked of [true, false]) {
        expect(actionForMuddy(ctx({ isNearby: nearby, hasExistingConversation: talked }))).not.toBe(
          "make_plan"
        );
      }
    }
  });
});

describe("location is asked when it finally pays off", () => {
  it("asks once a Muddy exists", () => {
    expect(resolveActivationState(withState({ muddyCount: 1 }))).toBe("muddies_no_location");
  });

  it("makes enabling location the action, not a Plan", () => {
    expect(primaryActionFor("muddies_no_location")).toBe("enable_location");
  });

  it("offers rather than nags somebody who is invisible", () => {
    /* THIS RULE CHANGED, deliberately.
     *
     * It used to assert that a ghost user skipped the location prompt
     * entirely, on the reasoning that ghost is a settled decision. But new
     * profiles are CREATED ghost -- most production accounts still are -- so
     * that rule silently excluded the majority of new people from Glow ever
     * being explained, and dropped them into a state claiming the area was
     * empty.
     *
     * Permission and visibility are now separate questions. A ghost user with
     * no location fix is asked for permission (below); one who has a fix is
     * offered their own Glow. Neither nags: both are offers they can decline,
     * and declining leaves the rest of the app working. */
    const ghostNoFix = withState({ muddyCount: 3, visibility: "ghost" });
    expect(resolveActivationState(ghostNoFix)).toBe("muddies_no_location");

    const ghostWithFix = withState({ muddyCount: 3, visibility: "ghost", locationGranted: true });
    expect(resolveActivationState(ghostWithFix)).toBe("visibility_off");
  });
});

describe("the payoff moment", () => {
  const nearby = withState({
    muddyCount: 4,
    locationGranted: true,
    // A nearby verdict needs a CURRENT fix, not merely a working one.
    locationFreshForProximity: true,
    nearbyMuddyCount: 1
  });

  it("leads with the person who is actually around", () => {
    expect(resolveActivationState(nearby)).toBe("muddy_nearby");
  });

  it("offers a wave, not a Plan", () => {
    // Somebody is nearby NOW. Asking for a Plan skips saying hello.
    expect(primaryActionFor("muddy_nearby")).toBe("wave");
  });
});

describe("nobody around is an ordinary evening, not a failure", () => {
  const quiet = withState({
    muddyCount: 4,
    locationGranted: true,
    // "Nobody is around" is a claim about the world, so it requires a fix
    // current enough to make it. See the stale-location tests.
    locationFreshForProximity: true,
    nearbyMuddyCount: 0
  });

  it("is its own state rather than looking broken", () => {
    expect(resolveActivationState(quiet)).toBe("no_one_nearby");
  });

  it("is where a Plan genuinely is the right ask", () => {
    // Nobody to wave at, so arranging something for later is the useful move.
    expect(primaryActionFor("no_one_nearby")).toBe("make_plan");
  });
});

describe("an arranged Plan outranks discovery", () => {
  it("leads with the Plan even when somebody is nearby", () => {
    const both = withState({
      muddyCount: 4,
      locationGranted: true,
      nearbyMuddyCount: 2,
      upcomingPlanCount: 1
    });
    expect(resolveActivationState(both)).toBe("upcoming_plan");
  });

  it("leads with the Plan even with no Muddies at all", () => {
    // Being invited to something counts, whoever arranged it.
    expect(resolveActivationState(withState({ upcomingPlanCount: 1 }))).toBe("upcoming_plan");
  });

  it("points at the Plan rather than making another one", () => {
    expect(primaryActionFor("upcoming_plan")).toBe("view_plan");
  });
});

describe("Glow is taught contextually", () => {
  it("teaches once somebody has a Muddy", () => {
    expect(shouldTeachGlow(withState({ muddyCount: 1 }))).toBe(true);
  });

  it("stops teaching once they have set their visibility", () => {
    expect(
      shouldTeachGlow(withState({ muddyCount: 1, milestones: new Set(["first_glow_enabled"]) }))
    ).toBe(false);
  });

  it("is never a gate between onboarding and finding people", () => {
    // The zero-Muddy state must remain reachable and unblocked.
    const fresh = withState({ muddyCount: 0 });
    expect(shouldTeachGlow(fresh)).toBe(false);
    expect(resolveActivationState(fresh)).toBe("no_muddies");
  });
});

describe("first value is doing something, not filling a form", () => {
  it("does not count a completed profile", () => {
    const setupOnly = new Set(["account_created", "profile_completed", "privacy_setup_completed"]);
    expect(hasReachedFirstValue(setupOnly)).toBe(false);
  });

  it("does not count a Muddy with no interaction", () => {
    expect(hasReachedFirstValue(new Set(["first_muddy_added"]))).toBe(false);
  });

  it("counts a Muddy plus a wave", () => {
    expect(hasReachedFirstValue(new Set(["first_muddy_added", "first_wave_sent"]))).toBe(true);
  });

  it("counts a Muddy plus a Plan", () => {
    expect(hasReachedFirstValue(new Set(["first_muddy_added", "first_plan_created"]))).toBe(true);
  });

  it("does not count an interaction with nobody connected", () => {
    expect(hasReachedFirstValue(new Set(["first_wave_sent"]))).toBe(false);
  });
});

describe("returning half-activated", () => {
  it("resumes from reality, not a saved step", () => {
    // Added a Muddy on another device, returns a week later: met by the state
    // the account is actually in.
    const returning = withState({ muddyCount: 2, locationGranted: false });
    expect(resumeState(returning)).toBe(resolveActivationState(returning));
    expect(resumeState(returning)).toBe("muddies_no_location");
  });

  it("cannot strand somebody in a step they already passed", () => {
    // Every input combination resolves to a real state; there is no dead end.
    for (const muddyCount of [0, 1, 5]) {
      for (const locationGranted of [true, false]) {
        for (const nearbyMuddyCount of [0, 2]) {
          for (const upcomingPlanCount of [0, 1]) {
            const state = resolveActivationState(
              withState({ muddyCount, locationGranted, nearbyMuddyCount, upcomingPlanCount })
            );
            expect(typeof primaryActionFor(state)).toBe("string");
          }
        }
      }
    }
  });
});
