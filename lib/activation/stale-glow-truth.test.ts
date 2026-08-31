import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { stripComments } from "@/lib/content/strip-comments";
import {
  composeHome,
  proximityAllowsNearby,
  type HomeCompositionInputs
} from "@/lib/activation/home-composition";

/**
 * Unknown is not empty.
 *
 * Home said "Refresh your Glow" and, one line below, "No trusted Muddies
 * nearby" -- declaring a position too old to judge, then judging with it. A
 * stale fix means proximity is UNKNOWN, not that proximity was evaluated and
 * nobody qualified.
 */

const at = (over: Partial<HomeCompositionInputs> = {}): HomeCompositionInputs => ({
  activationState: "location_stale",
  acknowledgingFirstMuddy: false,
  milestones: new Set(["first_muddy_added", "first_message_sent"]),
  hasSafetyCard: false,
  upcomingPlanCount: 0,
  twoSidedConversationCount: 0,
  planParticipationCount: 0,
  muddyCount: 1,
  nextUnspokenMuddy: null,
  missingProfileItems: [],
  ...over
});

/** Established evidence, so maturity cannot be what hides Near. */
const established = { twoSidedConversationCount: 1 };

describe("a stale fix silences the Nearby surface at every maturity", () => {
  it("hides Near while activating", () => {
    const activating = at({ milestones: new Set(["first_muddy_added"]) });
    expect(composeHome(activating).showNearby).toBe(false);
  });

  it("hides Near at early value", () => {
    // THE REPORTED DEFECT: this branch excluded only `no_one_nearby`, so a
    // stale viewer got Near back the moment they reached first value.
    expect(composeHome(at()).showNearby).toBe(false);
  });

  it("hides Near for an established user", () => {
    /* Being experienced says nothing about whether the last fix is current.
     * The same contradiction was waiting in the mature branch. */
    expect(composeHome(at({ ...established })).showNearby).toBe(false);
  });

  it("hides Near when location was never set up", () => {
    expect(composeHome(at({ activationState: "muddies_no_location" })).showNearby).toBe(false);
  });

  it("hides Near while visibility is off", () => {
    /* Near's empty state answers "turn on your Glow" -- the same instruction
     * the card above is already giving, in weaker words. */
    expect(composeHome(at({ activationState: "visibility_off", ...established })).showNearby).toBe(
      false
    );
  });
});

describe("truth and maturity are separate dimensions", () => {
  it("asks one rule rather than each branch remembering the list", () => {
    expect(proximityAllowsNearby(at({ activationState: "location_stale" }))).toBe(false);
    expect(proximityAllowsNearby(at({ activationState: "muddy_nearby" }))).toBe(true);
    expect(proximityAllowsNearby(at({ activationState: null }))).toBe(true);
  });

  it("does not let maturity alone re-enable Near", () => {
    // Same stale state, three maturities, one answer.
    for (const over of [
      { milestones: new Set(["first_muddy_added"]) },
      {},
      { ...established, activationState: null as never }
    ]) {
      const composed = composeHome(at({ ...over, activationState: "location_stale" }));
      expect(composed.showNearby).toBe(false);
    }
  });

  it("restates no freshness threshold of its own", () => {
    /* The canonical 30-minute rule lives in the proximity module; Home only
     * consumes the state it produces. */
    const source = stripComments(readFileSync("lib/activation/home-composition.ts", "utf8"));
    expect(source).not.toContain("30 * 60 * 1000");
    expect(source).not.toContain("PROXIMITY_FRESH_MS");
  });
});

describe("the genuine states still work", () => {
  it("allows the real no-nearby surface once the fix is current", () => {
    const fresh = composeHome(at({ activationState: "no_one_nearby", ...established }));
    // The Glow card owns that message; Near stands down to avoid saying it twice.
    expect(fresh.showNearby).toBe(false);
    expect(fresh.showTrending).toBe(true);
  });

  it("shows the payoff when somebody is actually around", () => {
    expect(composeHome(at({ activationState: "muddy_nearby" })).showNearby).toBe(true);
    expect(composeHome(at({ activationState: "muddy_nearby", ...established })).showNearby).toBe(
      true
    );
  });

  it("shows Near on an ordinary Home with nothing to explain", () => {
    expect(composeHome(at({ activationState: null, ...established })).showNearby).toBe(true);
  });
});

describe("a stale fix blocks proximity, not the rest of Mad Buddy", () => {
  it("keeps the single next step available", () => {
    expect(composeHome(at()).nextBestAction).toBe("invite_muddy");
  });

  it("keeps the person and an action reachable", () => {
    /* Refreshing stays primary because it unblocks Glow; the relationship
     * returns as the secondary rather than disappearing, since neither Message
     * nor Make a Plan depends on knowing where anybody is. */
    const home = stripComments(readFileSync("components/dashboard/dashboard-page.tsx", "utf8"));
    expect(home).toContain("const staleRelationship");
    expect(home).toContain('activationState === "location_stale" ? relationshipFocus');
    expect(home).toContain("(focusedRelationship ?? staleRelationship)?.muddy ?? null");
  });

  it("keeps refreshing as the primary action", () => {
    const home = stripComments(readFileSync("components/dashboard/dashboard-page.tsx", "utf8"));
    const handler = home.slice(
      home.indexOf("const activationPrimaryAction"),
      home.indexOf("RSVP from the Home plan stack")
    );
    expect(handler).toContain('activationState === "location_stale"');
    expect(handler).toContain("updatePrivateLocation");
  });

  it("never blocks safety", () => {
    const home = stripComments(readFileSync("components/dashboard/dashboard-page.tsx", "utf8"));
    const at2 = home.indexOf("home-safe-arrival-heading");
    const gate = home.lastIndexOf("{hasSafeArrival ?", at2);
    expect(home.slice(gate, at2)).not.toContain("composition.");
  });

  it("never blocks real Plans", () => {
    const home = stripComments(readFileSync("components/dashboard/dashboard-page.tsx", "utf8"));
    const stack = home.indexOf("<PlanStack");
    const branch = home.lastIndexOf("agendaItems.length > 0", stack);
    expect(home.slice(branch, stack)).not.toContain("composition.");
  });
});

describe("the stale card says one thing", () => {
  const card = stripComments(readFileSync("components/activation/activation-card.tsx", "utf8"));
  const copy = card.slice(card.indexOf("location_stale: {"), card.indexOf("no_one_nearby: {"));

  it("asks for a refresh", () => {
    expect(copy).toContain("Refresh your Glow");
    expect(copy).toContain("Refresh Glow");
  });

  it("makes no claim about who is around", () => {
    for (const claim of ["nearby", "No Muddies", "nobody", "close by right now"]) {
      expect(copy).not.toContain(claim);
    }
  });

  it("does not tell somebody to turn on a Glow they already enabled", () => {
    expect(copy).not.toContain("Turn on your Glow");
    expect(copy).not.toContain("turn on visibility");
  });
});
