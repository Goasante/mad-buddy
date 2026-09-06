import { describe, expect, it } from "vitest";

import {
  ALWAYS_ELIGIBLE_MAX_TIER,
  HOME_EXCLUDED_SMART_CARD_IDS,
  homeOwnerFor,
  shouldShowSmartCardOnHome,
  smartCardTier
} from "@/lib/smart-card/home-gate";
import { SMART_CARD_IDS, resolveSmartCard, type SmartCardProvider } from "@/lib/smart-card/smart-card";

const gate = (id: (typeof SMART_CARD_IDS)[number], earlyActivation: boolean, cardAVisible = false) =>
  shouldShowSmartCardOnHome({ id, earlyActivation, cardAVisible });

describe("every wired state resolves to a real tier", () => {
  it.each(SMART_CARD_IDS)("%s has a tier from the approved catalog", (id) => {
    const tier = smartCardTier(id);
    expect(tier).toBeGreaterThanOrEqual(0);
    expect(tier).toBeLessThanOrEqual(6);
  });

  it("places safety, obligation and live context in the always-eligible tiers", () => {
    expect(smartCardTier("safe_arrival")).toBe(0);
    expect(smartCardTier("plan_rsvp")).toBe(1);
    expect(smartCardTier("plan_starting")).toBe(2);
    expect(smartCardTier("event_live")).toBe(2);
    // Pluralised wired id, singular catalog entry -- resolved by alias, not by
    // a second tier definition that could drift.
    expect(smartCardTier("nearby_muddies")).toBe(2);
  });

  it("places progression and fallback above the always-eligible line", () => {
    for (const id of ["journey", "journey_complete", "buddy_progress", "achievement", "birthday", "weekend_plans"] as const) {
      expect(smartCardTier(id)).toBeGreaterThan(ALWAYS_ELIGIBLE_MAX_TIER);
    }
    expect(smartCardTier("upfor_fallback")).toBe(6);
  });
});

describe("tier 0 is never gated and never quiet", () => {
  it("shows Safe Arrival during early activation, at full volume", () => {
    expect(gate("safe_arrival", true, true)).toEqual({ eligible: true, deferred: false, tier: 0 });
  });

  it("keeps safety authority even when Card A is on screen", () => {
    // Deferring safety would make a live journey look like a suggestion.
    expect(gate("safe_arrival", false, true).deferred).toBe(false);
  });
});

describe("tiers 1 and 2 always reach Home, quietly beside Card A", () => {
  it.each(["plan_rsvp", "plan_starting", "event_live"] as const)(
    "%s is eligible during early activation",
    (id) => {
      expect(gate(id, true).eligible).toBe(true);
    }
  );

  it("keeps 'starts soon' at tier 4, not tier 2", () => {
    /* The catalog draws the line at HAPPENING vs APPROACHING, consistently for
       both Events and Plans: event_live is tier 2, event_starting and
       plan_upcoming are tier 4. An Event an hour away is a commitment, but it
       is not a reason to interrupt somebody who has not yet made a first
       connection. */
    expect(smartCardTier("event_starting")).toBe(4);
    expect(gate("event_starting", true).eligible).toBe(false);
    expect(gate("event_starting", false).eligible).toBe(true);
  });

  it("defers to Card A rather than competing with it", () => {
    expect(gate("plan_rsvp", true, true)).toMatchObject({ eligible: true, deferred: true });
    expect(gate("event_live", false, true)).toMatchObject({ eligible: true, deferred: true });
  });

  it("takes the full treatment when Card A is absent", () => {
    expect(gate("plan_rsvp", false, false).deferred).toBe(false);
  });
});

describe("tiers 3-6 wait until activation has stopped teaching", () => {
  it.each(["birthday", "weekend_plans", "journey", "buddy_progress", "upfor_fallback"] as const)(
    "%s is suppressed during early activation",
    (id) => {
      expect(gate(id, true).eligible).toBe(false);
    }
  );

  it.each(["journey", "buddy_progress", "upfor_fallback"] as const)(
    "%s returns once Home is mature",
    (id) => {
      expect(gate(id, false).eligible).toBe(true);
    }
  );

  it("never marks a suppressed card as deferred", () => {
    // `deferred` describes how an eligible card renders. A suppressed card is
    // not rendered at all, so reporting it as deferred would invite a caller to
    // show it quietly instead of not showing it.
    expect(gate("journey", true, true)).toEqual({ eligible: false, deferred: false, tier: 5 });
  });
});

describe("Home does not select what another surface owns", () => {
  it("names NearbyHero and the Activation card as the owners", () => {
    expect(homeOwnerFor("nearby_muddies")).toBe("NearbyHero");
    expect(homeOwnerFor("suggestions")).toBe("ActivationCard");
    expect(homeOwnerFor("plan_rsvp")).toBeNull();
  });

  it("exports exactly those two for the engine's exclusion list", () => {
    expect([...HOME_EXCLUDED_SMART_CARD_IDS].sort()).toEqual(["nearby_muddies", "suggestions"]);
  });

  it("keeps looking instead of resolving an excluded state", () => {
    /* The behaviour that matters: if the highest-ranked state belongs to
       another surface, Home must get the next best CARD B state -- not null,
       and not a card the client then throws away, which would blank Home
       exactly when it had something to say. */
    const providers: SmartCardProvider[] = [
      { id: "nearby_muddies", build: () => card("nearby_muddies") },
      { id: "plan_starting", build: () => card("plan_starting") }
    ];
    const resolved = resolveSmartCard(providers, {
      now: Date.now(),
      excludedIds: HOME_EXCLUDED_SMART_CARD_IDS
    });
    expect(resolved?.id).toBe("plan_starting");
  });

  it("still resolves the excluded state for surfaces that DO own it", () => {
    // NearbyHero and the provider suite must keep seeing it.
    const providers: SmartCardProvider[] = [{ id: "nearby_muddies", build: () => card("nearby_muddies") }];
    expect(resolveSmartCard(providers, { now: Date.now() })?.id).toBe("nearby_muddies");
  });
});

function card(id: (typeof SMART_CARD_IDS)[number]) {
  return {
    id,
    priority: 0,
    illustration: "people" as const,
    title: id,
    subtitle: "",
    cta: "Open",
    destination: "/"
  };
}
