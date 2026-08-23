import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { stripComments } from "@/lib/content/strip-comments";
import { deriveHomeMaturity, type HomeMaturityInputs } from "@/lib/activation/home-maturity";
import {
  composeHome,
  selectNextBestAction,
  type HomeCompositionInputs
} from "@/lib/activation/home-composition";

/**
 * First value is not maturity.
 *
 * Home was binary: focused while activating, then the whole dashboard the
 * instant one message landed. Sending a first hello unlocked Trending, a
 * Journey campaign, three feature tiles and two profile prompts at once --
 * the product answering a greeting with a catalogue.
 */

const maturity = (over: Partial<HomeMaturityInputs> = {}): HomeMaturityInputs => ({
  milestones: new Set<string>(),
  twoSidedConversationCount: 0,
  planParticipationCount: 0,
  muddyCount: 0,
  ...over
});

const home = (over: Partial<HomeCompositionInputs> = {}): HomeCompositionInputs => ({
  activationState: "no_one_nearby",
  acknowledgingFirstMuddy: false,
  milestones: new Set(["first_muddy_added", "first_message_sent"]),
  hasSafetyCard: false,
  upcomingPlanCount: 0,
  twoSidedConversationCount: 0,
  planParticipationCount: 0,
  muddyCount: 1,
  nextUnspokenMuddy: null,
  missingProfileItems: [],
  unreadConversationCount: 0,
  ...over
});

describe("the three steps", () => {
  it("is activating before any real value", () => {
    expect(deriveHomeMaturity(maturity({ milestones: new Set(["first_muddy_added"]) }))).toBe(
      "activating"
    );
  });

  it("is early_value after one direct message", () => {
    /* THE MISSING STEP. Graduated from onboarding, not into the whole
     * product. */
    const sent = maturity({
      milestones: new Set(["first_muddy_added", "first_message_sent"]),
      muddyCount: 1
    });
    expect(deriveHomeMaturity(sent)).toBe("early_value");
  });

  it("stays early_value while the conversation is one-sided", () => {
    const oneSided = maturity({
      milestones: new Set(["first_muddy_added", "first_message_sent"]),
      twoSidedConversationCount: 0
    });
    expect(deriveHomeMaturity(oneSided)).toBe("early_value");
  });

  it("becomes established once somebody replies", () => {
    // A reply is the loop closing; one person talking is not.
    const replied = maturity({
      milestones: new Set(["first_muddy_added", "first_message_sent"]),
      twoSidedConversationCount: 1
    });
    expect(deriveHomeMaturity(replied)).toBe("established");
  });

  it("becomes established once a Plan exists", () => {
    expect(deriveHomeMaturity(maturity({ planParticipationCount: 1 }))).toBe("established");
  });
});

describe("what maturity must never be inferred from", () => {
  it("is not a Muddy count", () => {
    /* Twenty Muddies and no conversation is a big list, not experience. */
    expect(deriveHomeMaturity(maturity({ muddyCount: 20 }))).toBe("activating");
  });

  it("is not profile completion", () => {
    const tidy = maturity({ milestones: new Set(["profile_completed", "privacy_setup_completed"]) });
    expect(deriveHomeMaturity(tidy)).toBe("activating");
  });

  it("is not a status on its own", () => {
    /* Already flagged as a taxonomy concern: broadcasting is expression, not
     * interaction. It may end activation, but it must not prove maturity. */
    const status = maturity({
      milestones: new Set(["first_muddy_added", "first_status_created"]),
      muddyCount: 3
    });
    expect(deriveHomeMaturity(status)).toBe("early_value");
  });

  it("uses no score, weight or ranking", () => {
    const source = stripComments(readFileSync("lib/activation/home-maturity.ts", "utf8"));
    for (const banned of ["score", "weight", "Math.random", "sort("]) {
      expect(source).not.toContain(banned);
    }
  });
});

describe("historical accounts are not re-onboarded", () => {
  it("reads a long-standing user as established without the new milestone", () => {
    /* The milestone only exists from the day it was added. Requiring it would
     * re-onboard the product's most experienced people -- exactly what the
     * future Experience Migration must not do. */
    const veteran = maturity({
      milestones: new Set(["first_muddy_added"]),
      twoSidedConversationCount: 4,
      planParticipationCount: 2,
      muddyCount: 12
    });
    expect(deriveHomeMaturity(veteran)).toBe("established");
  });

  it("checks real activity before it checks milestones", () => {
    const source = stripComments(readFileSync("lib/activation/home-maturity.ts", "utf8"));
    const derive = source.slice(source.indexOf("export function deriveHomeMaturity"));
    expect(derive.indexOf("looksEstablished")).toBeLessThan(derive.indexOf("reachedFirstValue"));
  });

  it("needs no onboarding cursor", () => {
    const source = stripComments(readFileSync("lib/activation/home-maturity.ts", "utf8"));
    for (const stored of ["onboarding_step", "cursor", "hasSeen", "acknowledged_at"]) {
      expect(source).not.toContain(stored);
    }
  });
});

describe("EARLY_VALUE Home opens gradually", () => {
  const composed = composeHome(home());

  it("suppresses Trending", () => {
    expect(composed.showTrending).toBe(false);
  });

  it("suppresses the Journey campaign", () => {
    expect(composed.showJourneyCard).toBe(false);
  });

  it("suppresses the three-tile Suggestions rail", () => {
    expect(composed.showSuggestions).toBe(false);
  });

  it("suppresses Moments and the empty-Plans placeholder", () => {
    expect(composed.showMoments).toBe(false);
    expect(composed.showPlansEmpty).toBe(false);
  });

  it("shows at most one next step", () => {
    expect(composed.nextBestAction).toBe("invite_muddy");
    // The rail and the single action must never both appear.
    expect(composed.showSuggestions).toBe(false);
  });

  it("shows no profile campaign at all", () => {
    // Neither surface: the ask arrives through nextBestAction when it is the
    // most useful thing, and not while the circle is still one person.
    expect(composed.showProfileReminder).toBe(false);
    expect(composed.showJourneyCard).toBe(false);
  });

  it("keeps the nearby payoff when somebody is actually around", () => {
    expect(composeHome(home({ activationState: "muddy_nearby" })).showNearby).toBe(true);
  });
});

describe("safety and real commitments always survive", () => {
  it("keeps Safe Arrival eligible at every maturity", () => {
    // Composition never gates it; it has its own signal.
    const dashboard = stripComments(readFileSync("components/dashboard/dashboard-page.tsx", "utf8"));
    const at = dashboard.indexOf("home-safe-arrival-heading");
    const gate = dashboard.lastIndexOf("{hasSafeArrival ?", at);
    expect(dashboard.slice(gate, at)).not.toContain("composition.");
  });

  it("never suppresses a real Plan", () => {
    const dashboard = stripComments(readFileSync("components/dashboard/dashboard-page.tsx", "utf8"));
    const stack = dashboard.indexOf("<PlanStack");
    const branch = dashboard.lastIndexOf("agendaItems.length > 0", stack);
    expect(dashboard.slice(branch, stack)).not.toContain("composition.");
  });
});

describe("the single next step is chosen by a rule", () => {
  it("offers an invite while the circle is one person", () => {
    // The people most likely to say yes are already known off the app.
    expect(selectNextBestAction(home({ muddyCount: 1 }))).toBe("invite_muddy");
  });

  it("uses an existing relationship before growing the circle", () => {
    /* CIRCLE-AWARE. Somebody who added three people and messaged one does not
     * need a fourth -- two of their Muddies are still unspoken. Saying hello to
     * one of them is worth more than another invitation. */
    const withUnspoken = home({
      muddyCount: 3,
      nextUnspokenMuddy: { id: "b", displayName: "Ama", avatarUrl: null }
    });
    expect(selectNextBestAction(withUnspoken)).toBe("say_hi_to_muddy");
  });

  it("never lets profile administration outrank relationships", () => {
    /* Several relationships already underway and nothing additive to say: the
     * hero carries the conversation and Make a Plan. Profile completion is
     * administration and is reachable from Profile whenever somebody wants it. */
    expect(selectNextBestAction(home({ muddyCount: 9, missingProfileItems: ["photo"] }))).toBeNull();
  });

  it("offers nothing when the circle is already in use", () => {
    // Null is a legitimate answer; whitespace beats a filler card.
    expect(selectNextBestAction(home({ muddyCount: 9, missingProfileItems: [] }))).toBeNull();
  });

  it("is deterministic", () => {
    const input = home({
      muddyCount: 3,
      nextUnspokenMuddy: { id: "b", displayName: "Ama", avatarUrl: null }
    });
    for (let i = 0; i < 5; i += 1) expect(selectNextBestAction(input)).toBe("say_hi_to_muddy");
  });
});

describe("two profile prompts are impossible", () => {
  it("drops the Journey card whenever the banner has something to say", () => {
    /* Both were separately correct and together were the app asking twice:
     * "Complete Profile / 20% / 8 steps" above "Complete your profile / Add
     * your photo". The banner wins -- it names ONE next detail. */
    const mature = home({
      twoSidedConversationCount: 1,
      activationState: null,
      nextUnspokenMuddy: null,
      missingProfileItems: ["photo"]
    });
    const composed = composeHome(mature);
    expect(composed.showProfileReminder && composed.showJourneyCard).toBe(false);
    expect(composed.showJourneyCard).toBe(false);
  });

  it("holds on the quiet-evening Home too", () => {
    const quiet = home({ twoSidedConversationCount: 1, missingProfileItems: ["photo"] });
    const composed = composeHome(quiet);
    expect(composed.showProfileReminder && composed.showJourneyCard).toBe(false);
  });

  it("restores the Journey card when the profile is complete", () => {
    const done = home({ twoSidedConversationCount: 1, activationState: null });
    expect(composeHome(done).showJourneyCard).toBe(true);
  });
});
