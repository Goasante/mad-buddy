import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { stripComments } from "@/lib/content/strip-comments";
import {
  composeHome,
  isEarlyActivation,
  earlyActivationHiddenActionHrefs,
  showsRealPlans,
  showsSafetyCard,
  type HomeCompositionInputs
} from "@/lib/activation/home-composition";

/**
 * One authority for the next step.
 *
 * A first-time user was told to "Turn on Glow" by the activation card and,
 * one scroll down, that "Visibility is paused" by the Near module -- two
 * systems explaining proximity in different words on the screen where the
 * concept is being introduced.
 */

const base: HomeCompositionInputs = {
  activationState: null,
  acknowledgingFirstMuddy: false,
  milestones: new Set<string>(),
  hasSafetyCard: false,
  twoSidedConversationCount: 0,
  planParticipationCount: 0,
  muddyCount: 1,
  nextUnspokenMuddy: null,
  missingProfileItems: [],
  unreadConversationCount: 0,
  upcomingPlanCount: 0
};
const at = (over: Partial<HomeCompositionInputs>) => ({ ...base, ...over });

describe("first Muddy, turn on Glow", () => {
  const home = composeHome(at({ acknowledgingFirstMuddy: true, activationState: "visibility_off" }));

  it("does not repeat the instruction in the Near module", () => {
    // "Turn visibility back on" under a card saying "Turn on Glow".
    expect(home.showNearby).toBe(false);
  });

  it("does not offer Trending immediately underneath", () => {
    expect(home.showTrending).toBe(false);
  });

  it("lets the screen breathe", () => {
    expect(home.showPlansEmpty).toBe(false);
    expect(home.showSuggestions).toBe(false);
    expect(home.showProfileReminder).toBe(false);
  });
});

describe("each early state keeps a single voice", () => {
  it.each([
    ["no_muddies"],
    ["request_pending"],
    ["muddies_no_location"],
    ["visibility_off"],
    ["location_stale"]
  ] as const)("%s suppresses the competing modules", (state) => {
    const home = composeHome(at({ activationState: state }));
    expect(home.showNearby).toBe(false);
    expect(home.showTrending).toBe(false);
  });

  it("does not duplicate the visibility warning", () => {
    // The card already says "Glow is ready / Turn on visibility".
    expect(composeHome(at({ activationState: "visibility_off" })).showNearby).toBe(false);
  });

  it("does not duplicate the location warning", () => {
    // The card already says "Refresh your Glow".
    expect(composeHome(at({ activationState: "location_stale" })).showNearby).toBe(false);
  });
});

describe("nobody nearby is said once", () => {
  const home = composeHome(at({ activationState: "no_one_nearby" }));

  it("lets one surface own the empty room", () => {
    /* The card frames it as success ("Glow is on"); Near's empty state frames
     * it as a shortage. Both at once is the app disagreeing with itself. */
    expect(home.showNearby).toBe(false);
  });

  it("welcomes the rest of Home back once first value is reached", () => {
    /* CONFIGURING GLOW IS NOT FIRST VALUE.
     *
     * This used to assert Home reopened here for everybody, which meant
     * "Complete Profile" returned the instant somebody flipped visibility --
     * the app treating a settings change as an arrival. It is first-VALUE
     * evidence that ends activation, not Glow being switched on. */
    const arrived = at({
      activationState: "no_one_nearby",
      milestones: new Set(["first_muddy_added", "first_wave_sent"]),
      // Mature Home now needs real usage, not one milestone: a replied-to
      // conversation is the evidence that separates using from arriving.
      twoSidedConversationCount: 1
    });
    expect(isEarlyActivation(arrived)).toBe(false);
    expect(composeHome(arrived).showTrending).toBe(true);
    expect(composeHome(arrived).showSuggestions).toBe(true);
    // ...and still exactly one surface saying the room is empty.
    expect(composeHome(arrived).showNearby).toBe(false);
  });

  it("keeps a brand-new user focused on the quiet evening", () => {
    const brandNew = at({
      activationState: "no_one_nearby",
      milestones: new Set(["first_muddy_added"])
    });
    expect(isEarlyActivation(brandNew)).toBe(true);
    // No "Complete Profile" the moment Glow is configured.
    expect(composeHome(brandNew).showProfileReminder).toBe(false);
    expect(composeHome(brandNew).showTrending).toBe(false);
    expect(composeHome(brandNew).showNearby).toBe(false);
  });
});

describe("the payoff opens Home back up", () => {
  const home = composeHome(at({ activationState: "muddy_nearby" }));

  it("shows the real nearby surface", () => {
    // NearbyHero owns the payoff; the activation card is the one standing down.
    expect(home.showNearby).toBe(true);
  });

  it("lets ordinary content return beneath it", () => {
    expect(home.showTrending).toBe(true);
  });
});

describe("a returning user keeps their ordinary Home", () => {
  it("is not judged by how many Muddies they have", () => {
    /* MILESTONE EVIDENCE, NOT A COUNT. Somebody with one Muddy may have been
     * here for months. Hiding their Home would punish a small circle. */
    const veteran = at({
      activationState: "visibility_off",
      milestones: new Set(["first_muddy_added", "first_plan_created"]),
      planParticipationCount: 1
    });
    expect(isEarlyActivation(veteran)).toBe(false);
    // Home opens for them: a small circle is not inexperience.
    expect(composeHome(veteran).showTrending).toBe(true);
    /* Near is the exception, and not because of maturity: while visibility is
     * off, its empty state would answer "turn on your Glow" -- the same
     * instruction the card above is already giving. Proximity truth is a
     * separate dimension from how much Home somebody gets. */
    expect(composeHome(veteran).showNearby).toBe(false);
    expect(composeHome({ ...veteran, activationState: null }).showNearby).toBe(true);
  });

  it.each([["first_wave_sent"], ["first_plan_created"], ["first_status_created"]])(
    "treats %s as having arrived somewhere",
    (milestone) => {
      const arrived = at({
        activationState: "location_stale",
        milestones: new Set(["first_muddy_added", milestone])
      });
      expect(isEarlyActivation(arrived)).toBe(false);
    }
  );

  it("still counts somebody who only added a Muddy as early", () => {
    // Adding a Muddy is not yet value -- nothing has happened between them.
    const justAdded = at({
      activationState: "visibility_off",
      milestones: new Set(["first_muddy_added"])
    });
    expect(isEarlyActivation(justAdded)).toBe(true);
  });

  it("gives a fully activated Home everything", () => {
    // Established evidence, not merely "no activation state".
    const home = composeHome(at({ activationState: null, twoSidedConversationCount: 1 }));
    /* Every MODULE flag on. nextBestAction is deliberately excluded: it is a
     * value, not a visibility flag, and null there means "an established Home
     * needs no growth nudge" -- which is the correct answer, not an absence. */
    const { nextBestAction, ...modules } = home;
    expect(Object.values(modules).every(Boolean)).toBe(true);
    expect(nextBestAction).toBeNull();
  });
});

describe("only one activation system guides at a time", () => {
  const early = at({ acknowledgingFirstMuddy: true, activationState: "visibility_off" });

  it("stands the Journey card down during early activation", () => {
    /* THE MAGENTA SURFACE. The Journey card's own source calls it "the
     * activation card", and its `turn_on_visibility` step reads "Turn On
     * Visibility / Choose when Muddies can see you're nearby" pointing at
     * /settings/glow-visibility -- directly beneath a card saying "Turn on
     * Glow" pointing at /settings. Same instruction, two destinations. */
    expect(composeHome(early).showJourneyCard).toBe(false);
  });

  it("brings it back once activation recedes", () => {
    expect(composeHome(at({ activationState: null })).showJourneyCard).toBe(true);
    expect(composeHome(at({ activationState: "muddy_nearby" })).showJourneyCard).toBe(true);
  });

  it("never covers a live Safe Arrival", () => {
    /* Safety is a different card and is gated on its own id, so suppressing
     * the Journey card cannot hide somebody's journey. */
    const home = stripComments(readFileSync("components/dashboard/dashboard-page.tsx", "utf8"));
    expect(home).toContain('smartCard.id === "safe_arrival" || composition.showJourneyCard');
  });

  it("suppresses rather than merely dimming", () => {
    // A quieter card giving a competing instruction is still competing.
    const home = stripComments(readFileSync("components/dashboard/dashboard-page.tsx", "utf8"));
    const at2 = home.indexOf("<SmartCardHero");
    expect(home.lastIndexOf("composition.showJourneyCard", at2)).toBeGreaterThan(-1);
  });
});

describe("Moments waits for the relationship loop", () => {
  it("does not render during early activation", () => {
    expect(composeHome(at({ activationState: "visibility_off" })).showMoments).toBe(false);
  });

  it("returns for a mature Home", () => {
    expect(composeHome(at({ activationState: null })).showMoments).toBe(true);
  });

  it("stays behind its own feature flag as well", () => {
    // Composition narrows; it must not force a disabled feature on.
    const home = stripComments(readFileSync("components/dashboard/dashboard-page.tsx", "utf8"));
    expect(home).toContain("momentsEnabled && composition.showMoments");
  });
});

describe("UpFor is not taught before Glow", () => {
  it("is hidden while the first Glow step is outstanding", () => {
    /* "Let your Muddies know you are free right now" needs somebody able to
     * see you. Teaching it here explains a feature whose value depends on the
     * step still being asked for. */
    const early = at({ acknowledgingFirstMuddy: true, activationState: "visibility_off" });
    expect(earlyActivationHiddenActionHrefs(early)).toContain("/hangout-mode");
  });

  it("keeps the actions that grow the circle", () => {
    const early = at({ activationState: "no_muddies" });
    const hidden = earlyActivationHiddenActionHrefs(early);
    expect(hidden).not.toContain("/invites");
    expect(hidden).not.toContain("/friends?tab=add");
  });

  it("returns once activation recedes", () => {
    expect(earlyActivationHiddenActionHrefs(at({ activationState: null }))).toEqual([]);
  });

  it("reuses the rail's existing filter rather than a second mechanism", () => {
    const home = stripComments(readFileSync("components/dashboard/dashboard-page.tsx", "utf8"));
    expect(home).toContain("earlyActivationHiddenActionHrefs(compositionInputs)");
    expect(home).toContain("...hiddenQuickActionHrefs");
  });

  it("points at the href the rail actually links to", () => {
    // A stale href would silently filter nothing.
    const home = stripComments(readFileSync("components/dashboard/dashboard-page.tsx", "utf8"));
    expect(home).toContain('href: "/hangout-mode", label: "UpFor"');
  });
});

describe("safety outranks activation; discovery does not", () => {
  it("keeps a live Safe Arrival during the earliest state", () => {
    const travelling = at({ activationState: "no_muddies", hasSafetyCard: true });
    expect(showsSafetyCard(travelling)).toBe(true);
  });

  it("does not let composition suppress it", () => {
    /* The worst outcome of showing it early is a busier screen; the worst
     * outcome of hiding it is somebody not knowing a person is travelling. */
    const home = stripComments(readFileSync("components/dashboard/dashboard-page.tsx", "utf8"));
    const safeArrivalAt = home.indexOf("home-safe-arrival-heading");
    const gate = home.lastIndexOf("{hasSafeArrival ?", safeArrivalAt);
    expect(gate).toBeGreaterThan(-1);
    expect(home.slice(gate, safeArrivalAt)).not.toContain("composition.");
  });
});

describe("real commitments are never destroyed", () => {
  it("shows a plan somebody actually made, even on day one", () => {
    const newWithPlan = at({ activationState: "visibility_off", upcomingPlanCount: 1 });
    expect(showsRealPlans(newWithPlan)).toBe(true);
  });

  it("suppresses only the empty placeholder", () => {
    const early = at({ activationState: "visibility_off" });
    expect(composeHome(early).showPlansEmpty).toBe(false);
    expect(showsRealPlans(early)).toBe(false);
  });

  it("keeps the real-plan branch independent of composition", () => {
    // The PlanStack branch must not be gated on a composition flag.
    const home = stripComments(readFileSync("components/dashboard/dashboard-page.tsx", "utf8"));
    const stack = home.indexOf("<PlanStack");
    const branch = home.lastIndexOf("agendaItems.length > 0", stack);
    expect(home.slice(branch, stack)).not.toContain("composition.");
  });
});

describe("composition never reads copy", () => {
  const source = stripComments(readFileSync("lib/activation/home-composition.ts", "utf8"));

  it("decides from state, not from headlines", () => {
    /* Reading a headline back out to decide layout makes the words
     * load-bearing: rewording a sentence would silently change the page. */
    for (const copy of ["Turn on Glow", "Visibility is paused", "Glow is on", "headline"]) {
      expect(source).not.toContain(copy);
    }
  });

  it("uses the canonical activation vocabulary", () => {
    expect(source).toContain("ActivationState");
    expect(source).toContain("hasReachedFirstValue");
  });

  it("does not gate MATURITY on a raw Muddy count", () => {
    /* The rule is about what ends the training-wheel Home, not about every
     * mention of the field. Maturity must never key on circle size -- somebody
     * with twenty Muddies and no conversation is not experienced. Choosing
     * WHICH growth action to offer legitimately does look at it: with one
     * Muddy, inviting beats searching. */
    const maturity = stripComments(readFileSync("lib/activation/home-maturity.ts", "utf8"));
    const derive = maturity.slice(maturity.indexOf("export function deriveHomeMaturity"));
    expect(derive).not.toContain("muddyCount");
    const established = maturity.slice(
      maturity.indexOf("function looksEstablished"),
      maturity.indexOf("export function deriveHomeMaturity")
    );
    expect(established).not.toContain("input.muddyCount");
  });
});

describe("Home applies the decision rather than re-deriving it", () => {
  const home = stripComments(readFileSync("components/dashboard/dashboard-page.tsx", "utf8"));

  it("computes the composition once, from one set of inputs", () => {
    // The inputs are hoisted so the quick-action filter and the module flags
    // cannot disagree about what state the screen is in.
    expect(home).toContain("composeHome(compositionInputs)");
    expect(home.split("composeHome(").length - 1).toBe(1);
    expect(home.split("const compositionInputs").length - 1).toBe(1);
  });

  it("gates the competing modules on it", () => {
    expect(home).toContain("composition.showNearby ?");
    expect(home).toContain("composition.showTrending ?");
  });

  it("keeps the activation-focused quick actions", () => {
    // These point at the same goal the card does, so they reinforce it.
    expect(home).toContain("<FirstTimeQuickActions");
  });
});

/**
 * A waiting person outranks a setup nudge (MB-GOD-052).
 *
 * Home could not see unread messages at all: the count lived only in the
 * navigation badge, so a returning user was offered "Complete your profile,
 * 3 steps left" while a real message sat unanswered one tap away. Measured
 * across four account states, Home WITH an unread message and Home WITHOUT one
 * rendered identically.
 *
 * The rule is suppression, not a new module — Home does not gain an inbox, a
 * count or a preview. It simply stops asking for administration at the moment
 * somebody is waiting for a reply.
 */
describe("unread suppresses setup, and nothing else", () => {
  /* Established: real activity, so this lands in the mature branch where the
     profile reminder and Journey card are both on. */
  const established = {
    activationState: null,
    twoSidedConversationCount: 2,
    planParticipationCount: 1,
    muddyCount: 3
  } as const;

  it("shows setup nudges when nobody is waiting", () => {
    // The control. Without this, the assertion below could pass on a
    // composition that never showed these at all.
    const quiet = composeHome(at({ ...established, unreadConversationCount: 0 }));
    expect(quiet.showProfileReminder).toBe(true);
    expect(quiet.showJourneyCard).toBe(true);
  });

  it("suppresses the profile reminder and Journey card while someone waits", () => {
    const waiting = composeHome(at({ ...established, unreadConversationCount: 1 }));
    expect(waiting.showProfileReminder).toBe(false);
    expect(waiting.showJourneyCard).toBe(false);
  });

  it("leaves live social content untouched", () => {
    /* DELIBERATELY NARROW. An imminent Plan still outranks an unread message —
       a Plan has a time attached and a message does not — and proximity is a
       live fact in its own right. Only setup yields. */
    const quiet = composeHome(at({ ...established, unreadConversationCount: 0 }));
    const waiting = composeHome(at({ ...established, unreadConversationCount: 1 }));
    expect(waiting.showNearby).toBe(quiet.showNearby);
    expect(waiting.showTrending).toBe(quiet.showTrending);
    expect(waiting.showMoments).toBe(quiet.showMoments);
    expect(waiting.nextBestAction).toBe(quiet.nextBestAction);
  });

  it("does not fire on a zero or negative count", () => {
    // A guard on `> 0`, not on truthiness: a stale or malformed count must not
    // silently hide the profile nudge forever.
    expect(composeHome(at({ ...established, unreadConversationCount: 0 })).showProfileReminder).toBe(true);
    expect(composeHome(at({ ...established, unreadConversationCount: -1 })).showProfileReminder).toBe(true);
  });

  it("applies in the no_one_nearby branch too", () => {
    /* That branch returns its own composition rather than falling through, so
       it was a second way for the setup nudge to survive an unread message. */
    const waiting = composeHome(at({
      ...established,
      activationState: "no_one_nearby",
      milestones: new Set(["first_muddy_added", "first_message_sent"]),
      unreadConversationCount: 1
    }));
    expect(waiting.showProfileReminder).toBe(false);
  });
});
