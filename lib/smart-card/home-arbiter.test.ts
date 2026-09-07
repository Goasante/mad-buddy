import { describe, expect, it } from "vitest";

import type { ActivationState } from "@/lib/activation/state";
import {
  arbitrateHomeCard,
  cardACandidateTier,
  cardBCandidateTier,
  FIRST_MUDDY_TIER,
  HOME_TIE_BREAK
} from "@/lib/smart-card/home-arbiter";
import type { SmartCardId } from "@/lib/smart-card/smart-card";

/**
 * ONE CARD MUST NOT MEAN HALF THE INTELLIGENCE DISAPPEARED.
 *
 * Home shows a single adaptive card. Before the arbiter, Card A and Card B each
 * decided independently: Card A rendered whenever it had anything at all to
 * say, and Card B was gated behind it and then merely deferred. A tier-1
 * obligation could therefore lose to a tier-4 nudge because of which surface
 * owned it, not because of what the person needed.
 *
 * These cases hold the combined ranking, and hold the two properties that make
 * it trustworthy: it is DETERMINISTIC (same inputs, same card, no rotation),
 * and it never lets an obligation lose to a nudge.
 */

const arb = (input: {
  activationState?: ActivationState | null;
  firstMuddyVisible?: boolean;
  smartCardId?: SmartCardId | null;
  earlyActivation?: boolean;
}) =>
  arbitrateHomeCard({
    activationState: input.activationState ?? null,
    firstMuddyVisible: input.firstMuddyVisible ?? false,
    smartCardId: input.smartCardId ?? null,
    earlyActivation: input.earlyActivation ?? false
  });

describe("the arbiter ranks both surfaces on one ladder", () => {
  it("THE REPORTED DEFECT: an owed answer beats an activation nudge", () => {
    /* Somebody is waiting on this person (tier 1) while Card A wants to talk
       about a stale location (tier 5). Before the arbiter Card A rendered and
       Card B was deferred underneath it. */
    const result = arb({ activationState: "location_stale", smartCardId: "plan_rsvp" });

    expect(result.winner).toBe("card_b");
    expect(result.tier).toBe(1);
    expect(result.reason).toBe("card_b_higher_tier");
  });

  it("an incoming Muddy request beats no_muddies -- it is what SOLVES it", () => {
    const result = arb({
      activationState: "no_muddies",
      smartCardId: "muddy_request",
      earlyActivation: true
    });

    expect(result.winner).toBe("card_b");
    expect(result.tier).toBe(1);
  });

  it("safety outranks everything Card A can say", () => {
    const result = arb({ activationState: "no_muddies", smartCardId: "safe_arrival" });

    expect(result.winner).toBe("card_b");
    expect(result.tier).toBe(0);
  });

  it("safety reaches even the newest viewer", () => {
    const result = arb({
      activationState: "no_muddies",
      smartCardId: "safe_arrival",
      earlyActivation: true
    });

    expect(result.winner).toBe("card_b");
  });

  it("live coordination beats critical activation", () => {
    const result = arb({ activationState: "visibility_off", smartCardId: "plan_starting" });

    expect(result.winner).toBe("card_b");
    expect(result.tier).toBe(2);
  });

  it("critical activation beats social momentum", () => {
    // Card A tier 3, Card B tier 4.
    const result = arb({ activationState: "no_muddies", smartCardId: "event_starting" });

    expect(result.winner).toBe("card_a");
    expect(result.tier).toBe(3);
    expect(result.reason).toBe("card_a_higher_tier");
  });

  it("critical activation beats a fallback", () => {
    const result = arb({ activationState: "muddies_no_location", smartCardId: "journey" });

    expect(result.winner).toBe("card_a");
    expect(result.tier).toBe(3);
  });

  it("a weak Card A state loses to a stronger Card B one", () => {
    // upcoming_plan is tier 6; four surfaces already name the actual Plan.
    const result = arb({ activationState: "upcoming_plan", smartCardId: "plan_rsvp" });

    expect(result.winner).toBe("card_b");
  });
});

describe("exactly one card, and never nothing by accident", () => {
  it("renders nothing only when NEITHER surface has a candidate", () => {
    const result = arb({ activationState: "activated", smartCardId: null });

    expect(result.winner).toBe("none");
    expect(result.reason).toBe("no_candidates");
  });

  it("Card A wins uncontested when Card B has no candidate", () => {
    const result = arb({ activationState: "no_muddies", smartCardId: null });

    expect(result.winner).toBe("card_a");
    expect(result.reason).toBe("card_a_only");
  });

  it("Card B wins uncontested when Card A is fully activated", () => {
    const result = arb({ activationState: "activated", smartCardId: "linkr_mutual" });

    expect(result.winner).toBe("card_b");
    expect(result.reason).toBe("card_b_only");
  });

  it("never returns both surfaces at once", () => {
    const states: Array<ActivationState | null> = [
      null,
      "activated",
      "no_muddies",
      "request_pending",
      "visibility_off",
      "muddies_no_location",
      "location_stale",
      "no_one_nearby",
      "muddy_nearby",
      "upcoming_plan"
    ];
    const cards: Array<SmartCardId | null> = [
      null,
      "safe_arrival" as SmartCardId,
      "plan_rsvp" as SmartCardId,
      "plan_starting" as SmartCardId,
      "linkr_mutual" as SmartCardId,
      "event_starting" as SmartCardId,
      "journey" as SmartCardId
    ];

    for (const activationState of states) {
      for (const smartCardId of cards) {
        for (const earlyActivation of [true, false]) {
          const result = arb({ activationState, smartCardId, earlyActivation });
          expect(["card_a", "card_b", "none"]).toContain(result.winner);
        }
      }
    }
  });
});

describe("the decision is deterministic", () => {
  it("the same inputs produce the same card every time", () => {
    const input = {
      activationState: "no_muddies" as const,
      firstMuddyVisible: false,
      smartCardId: "plan_rsvp" as SmartCardId,
      earlyActivation: true
    };
    const runs = Array.from({ length: 25 }, () => arbitrateHomeCard(input));

    expect(new Set(runs.map((run) => run.winner)).size).toBe(1);
    expect(new Set(runs.map((run) => run.tier)).size).toBe(1);
  });

  it("a tie resolves the same way every time, never by rotation", () => {
    // Both tier 3: no_muddies against linkr_mutual.
    const result = arb({ activationState: "no_muddies", smartCardId: "linkr_mutual" });

    expect(result.reason).toBe("tie_broken");
    expect(result.winner).toBe(HOME_TIE_BREAK);
    expect(arb({ activationState: "no_muddies", smartCardId: "linkr_mutual" }).winner).toBe(
      result.winner
    );
  });
});

describe("early activation restrains, but never suppresses an obligation", () => {
  it("a weak Card B state does not interrupt a new viewer", () => {
    expect(cardBCandidateTier({ smartCardId: "journey" as SmartCardId, earlyActivation: true })).toBeNull();
  });

  it("the same state is available once activation is no longer the guide", () => {
    expect(cardBCandidateTier({ smartCardId: "journey" as SmartCardId, earlyActivation: false })).toBe(5);
  });

  it("tiers 0 through 2 are exempt from the restraint", () => {
    for (const id of ["safe_arrival", "plan_rsvp", "plan_starting"] as SmartCardId[]) {
      expect(cardBCandidateTier({ smartCardId: id, earlyActivation: true })).not.toBeNull();
    }
  });
});

describe("Card A candidacy", () => {
  it("FirstMuddyCard replaces the activation state rather than stacking with it", () => {
    expect(
      cardACandidateTier({ activationState: "no_one_nearby", firstMuddyVisible: true })
    ).toBe(FIRST_MUDDY_TIER);
  });

  it("`activated` is not a candidate -- Card A renders nothing", () => {
    expect(cardACandidateTier({ activationState: "activated", firstMuddyVisible: false })).toBeNull();
  });

  it("every activation state that renders has a tier", () => {
    const states: Array<Exclude<ActivationState, "activated">> = [
      "no_muddies",
      "request_pending",
      "visibility_off",
      "muddies_no_location",
      "location_stale",
      "no_one_nearby",
      "muddy_nearby",
      "upcoming_plan"
    ];
    for (const state of states) {
      expect(cardACandidateTier({ activationState: state, firstMuddyVisible: false })).not.toBeNull();
    }
  });
});
