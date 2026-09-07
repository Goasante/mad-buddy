import { describe, expect, it } from "vitest";

import { SMART_CARD_APPROVED_STATES } from "@/lib/smart-card/catalog";
import {
  SMART_CARD_STATE_OWNERSHIP,
  classificationTotals
} from "@/lib/smart-card/catalog-classification";
import { homeOwnerFor } from "@/lib/smart-card/home-gate";
import { SMART_CARD_IDS } from "@/lib/smart-card/smart-card";

/**
 * THE CLASSIFICATION IS CHECKED AGAINST THE CODE, not maintained by hand.
 *
 * A written-down matrix rots the moment a provider is added, and a rotted one is
 * worse than none: it is a document that confidently says the wrong thing. So
 * the claim "CARD_B_WIRED" is verified against SMART_CARD_IDS, "CARD_A_OWNED"
 * and "NEARBY_HERO_OWNED" against the engine's own exclusion map, and every
 * approved state must appear exactly once.
 */

const approvedIds = SMART_CARD_APPROVED_STATES.map((state) => state.id);
const wired = new Set<string>(SMART_CARD_IDS as readonly string[]);

/* Two catalog entries share one wired provider: the catalog splits the live
   Safe Arrival journey into overdue/action, the product renders one card. */
const SHARED_PROVIDER: Record<string, string> = {
  safe_arrival_overdue: "safe_arrival",
  safe_arrival_action: "safe_arrival"
};

describe("every approved state is classified exactly once", () => {
  it("covers all 55 approved states", () => {
    expect(approvedIds).toHaveLength(55);
    const missing = approvedIds.filter((id) => !SMART_CARD_STATE_OWNERSHIP[id]);
    expect(missing, `unclassified: ${missing.join(", ")}`).toEqual([]);
  });

  it("classifies nothing that is not an approved state", () => {
    const approved = new Set(approvedIds);
    const extra = Object.keys(SMART_CARD_STATE_OWNERSHIP).filter((id) => !approved.has(id as (typeof approvedIds)[number]));
    expect(extra, `not in catalog: ${extra.join(", ")}`).toEqual([]);
  });

  it("gives every classification a reason", () => {
    for (const [id, entry] of Object.entries(SMART_CARD_STATE_OWNERSHIP)) {
      expect(entry.reason.length, `${id} needs a reason`).toBeGreaterThan(20);
    }
  });
});

describe("the classification agrees with the engine", () => {
  it("every CARD_B_WIRED state really has a provider", () => {
    for (const id of approvedIds) {
      const entry = SMART_CARD_STATE_OWNERSHIP[id];
      if (entry.ownership !== "CARD_B_WIRED") continue;
      const providerId = SHARED_PROVIDER[id] ?? id;
      expect(wired.has(providerId), `${id} claims wired but has no provider`).toBe(true);
    }
  });

  it("no state claims to be unwired while a provider exists for it", () => {
    for (const id of approvedIds) {
      const entry = SMART_CARD_STATE_OWNERSHIP[id];
      if (entry.ownership === "CARD_B_WIRED") continue;
      /* The two surface-owned states DO have providers -- they are excluded at
         selection rather than absent -- so they are the allowed exception. */
      const excludedAtSelection =
        entry.ownership === "NEARBY_HERO_OWNED" ||
        (entry.ownership === "CARD_A_OWNED" && wired.has(id));
      if (excludedAtSelection) continue;
      expect(wired.has(id), `${id} claims ${entry.ownership} but IS wired`).toBe(false);
    }
  });

  it("states owned by another Home surface are the ones the engine excludes", () => {
    for (const id of approvedIds) {
      const entry = SMART_CARD_STATE_OWNERSHIP[id];
      if (!wired.has(id)) continue;
      const owner = homeOwnerFor(id as never);
      if (owner === "NearbyHero") expect(entry.ownership).toBe("NEARBY_HERO_OWNED");
      if (owner === "ActivationCard") expect(entry.ownership).toBe("CARD_A_OWNED");
    }
  });
});

describe("the closeout totals", () => {
  it("add up to the whole catalog", () => {
    const totals = classificationTotals();
    const sum = Object.values(totals).reduce((a, b) => a + b, 0);
    expect(sum).toBe(55);
  });

  it("match the numbers reported in CONTINUATION.md and PR #27", () => {
    /* Pinned so a future provider cannot change the published totals silently:
       whoever adds one must update the report in the same commit. */
    expect(classificationTotals()).toEqual({
      CARD_B_WIRED: 29,
      CARD_A_OWNED: 6,
      NEARBY_HERO_OWNED: 2,
      OTHER_SURFACE: 7,
      NO_AUTHORITY: 10,
      PRODUCT_PAUSED: 1,
      LOW_VALUE_DUPLICATE: 0
    });
  });

  /**
   * The distinction the first closeout blurred. "Another surface already says
   * this" is a finished answer; "nothing can answer this truthfully" is a gap.
   * Reporting them as one number described settled ownership as missing work.
   */
  it("keeps settled ownership separate from real authority gaps", () => {
    const totals = classificationTotals();
    const settled =
      totals.CARD_A_OWNED + totals.NEARBY_HERO_OWNED + totals.OTHER_SURFACE + totals.PRODUCT_PAUSED;
    expect(settled).toBe(16);
    expect(totals.NO_AUTHORITY).toBe(10);
    expect(settled + totals.NO_AUTHORITY + totals.CARD_B_WIRED).toBe(55);
  });
});
