import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

import { stripComments } from "@/lib/content/strip-comments";
import { SMART_CARD_APPROVED_STATES } from "@/lib/smart-card/catalog";
import { SMART_CARD_IDS } from "@/lib/smart-card/smart-card";

/**
 * Home has TWO adaptive cards, and this pins which one owns what.
 *
 *   CARD A  FirstMuddyCard / ActivationCard
 *           activation, relationship progression, Glow + location setup,
 *           first Muddy, the quiet-evening relationship action.
 *
 *   CARD B  SmartCardHero (V2)
 *           the cross-product opportunity / obligation / status layer.
 *
 *   NearbyHero is a third, separate surface.
 *
 * The failure mode this guards is two cards giving the same instruction at the
 * same time -- Activation saying "Turn on Glow" above a Smart Card saying
 * "Enable location", or Activation working a nearby relationship while the
 * Smart Card announces "Ama is Close By". Home already resolves that by
 * suppression, and dashboard-page.tsx documents each stand-down in place.
 *
 * These tests assert the OWNERSHIP BOUNDARY, not the visual design: a Smart
 * Card state must not exist for something Card A already owns.
 */

const ROOT = process.cwd();
/* Comments stripped: Home documents the OLD gate in prose so the change is
   legible to the next reader, and a "must not contain" assertion would
   otherwise be satisfied by an explanation of why that code is gone. */
const dashboard = stripComments(
  readFileSync(path.join(ROOT, "components", "dashboard", "dashboard-page.tsx"), "utf8")
);

/** States Card A owns outright. A Smart Card provider for these would duplicate. */
const CARD_A_OWNED = [
  "first_muddy",
  "activation",
  "turn_on_glow",
  "enable_location",
  "location_setup",
  "visibility_setup",
  "quiet_evening"
];

describe("Card A keeps its territory", () => {
  it("declares no Smart Card provider for an activation instruction", () => {
    const wired = SMART_CARD_IDS as readonly string[];
    const collisions = CARD_A_OWNED.filter((owned) => wired.includes(owned));
    expect(
      collisions,
      "these would put the same instruction on two Home cards at once"
    ).toEqual([]);
  });

  it("keeps permission and location states out of the WIRED set", () => {
    /* The approved catalog may plan a permissions family for later, but nothing
       in it may be wired while Activation owns setup. Catalog = roadmap;
       SMART_CARD_IDS = what actually renders. */
    const permissionStates = SMART_CARD_APPROVED_STATES.filter(
      (state) => state.family === "permissions"
    ).map((state) => state.id);
    const wired = SMART_CARD_IDS as readonly string[];
    expect(permissionStates.filter((id) => wired.includes(id))).toEqual([]);
  });
});

describe("Home composition still gates the Smart Card", () => {
  it("selects the Smart Card through the ARBITER, not by a list of ids", () => {
    /* The oldest condition named two ids -- safe_arrival and the Journey slot
       -- so twelve of fourteen built states were computed and discarded. Tier
       gating fixed that, but Card A and Card B still decided separately, so an
       obligation could lose to a nudge purely by surface. One arbiter now ranks
       both candidate spaces on one ladder. */
    expect(dashboard).toMatch(/homeCard\.winner\s*===\s*"card_b"\s*&&\s*smartCard/);
    expect(dashboard).toMatch(/arbitrateHomeCard\(\{/);
    expect(dashboard).not.toMatch(/smartCard\.id\s*===\s*"safe_arrival"\s*\|\|\s*composition\.showJourneyCard/);
  });

  it("feeds BOTH surfaces' candidates into the one arbiter", () => {
    /* FirstMuddyCard REPLACES ActivationCard, so both are passed: ranking only
       the second would let the first-Muddy payoff bypass arbitration entirely,
       which is the defect in a different place. */
    expect(dashboard).toMatch(/firstMuddyVisible:\s*Boolean\(firstMuddy\)/);
    expect(dashboard).toMatch(/activationState,/);
    expect(dashboard).toMatch(/smartCardId:\s*smartCard\?\.id\s*\?\?\s*null/);
  });

  it("renders no `deferred` second card -- there is only ever one", () => {
    /* Deferral existed so Card B could sit quietly beneath Card A. With one
       arbitrated winner there is nothing to sit beneath, and a surviving
       deferred prop would mean both surfaces were rendering again. */
    expect(dashboard).not.toMatch(/deferred=\{/);
  });

  it("renders V2, and does not leave V1 on screen beside it", () => {
    expect(dashboard).toMatch(/<SmartCardHeroV2\s/);
    expect(dashboard).not.toMatch(/<SmartCardHero\s/);
  });

  it("lets FirstMuddyCard replace ActivationCard rather than stack with it", () => {
    expect(dashboard).toMatch(/firstMuddy\s*\?\s*\(?\s*<FirstMuddyCard/);
    /* Still a replacement, now behind the arbiter: Card A renders only when it
       actually won the slot. */
    expect(dashboard).toMatch(
      /\)\s*:\s*homeCard\.winner\s*===\s*"card_a"\s*&&\s*activationState\s*\?\s*\(?\s*<ActivationCard/
    );
  });

  it("stands NearbyHero down while activation is teaching", () => {
    expect(dashboard).toMatch(/composition\.showNearby\s*\?/);
  });
});

describe("the catalog is a roadmap, not a claim of implementation", () => {
  it("wires strictly fewer states than the catalog approves", () => {
    expect(SMART_CARD_IDS.length).toBeLessThan(SMART_CARD_APPROVED_STATES.length);
  });

  it("wires nothing that the catalog has not approved", () => {
    const approved = new Set(SMART_CARD_APPROVED_STATES.map((state) => state.id));
    /* Wired ids and catalog ids use different granularity in places
       (nearby_muddies covers nearby_muddy), so this checks family coverage
       rather than demanding identical strings. */
    const families = new Set(SMART_CARD_APPROVED_STATES.map((state) => state.family));
    expect(families.size).toBeGreaterThan(0);
    expect(approved.size).toBeGreaterThan(SMART_CARD_IDS.length);
  });
});
