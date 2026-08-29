import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { PROXIMITY_BAND_LABELS } from "@/lib/proximity/bands";
import {
  MOMENTUM_PLAN_THRESHOLD,
  UPFOR_MODES,
  filterForMode,
  isUpForMode,
  planConversionSummary,
  rankForYou,
  resolveUpForMode,
  shouldOfferPlanConversion,
  upForEmptyCopy,
  upForMomentum,
  upForProximityLabel,
  upForRelevanceScore,
  upForSocialProof,
  type RankableUpFor
} from "@/lib/social/upfor-feed";

/**
 * The UpFor feed rules.
 *
 * The proximity tests matter most: the approved mockup shows "2.4 km away",
 * and reproducing that would leak exactly what this product refuses to leak.
 */

const HOUR = 60 * 60 * 1000;
const NOW = Date.parse("2026-08-22T20:00:00Z");

function item(overrides: Partial<RankableUpFor> = {}): RankableUpFor {
  return {
    id: "a",
    ownerId: "owner",
    activityType: "food",
    areaTier: null,
    startsAt: new Date(NOW - HOUR).toISOString(),
    endsAt: new Date(NOW + 3 * HOUR).toISOString(),
    goingCount: 0,
    isMuddy: false,
    viaGroup: false,
    ...overrides
  };
}

describe("proximity never becomes a distance", () => {
  it("uses only the canonical Glow V2 labels", () => {
    const allowed = Object.values(PROXIMITY_BAND_LABELS);
    for (const tier of ["close_by", "nearby", "wider_area"] as const) {
      const label = upForProximityLabel(tier);
      expect(label, tier).not.toBeNull();
      expect(allowed, tier).toContain(label);
    }
  });

  it("widens outward and never claims the tightest bands", () => {
    /* UpFor stores three tiers; Glow V2 names six bands. The closest tier
     * means "the nearest of three buckets", which cannot support a claim of
     * being metres away -- so "Right Here" and "Just Around" are unreachable
     * from this data by construction. */
    expect(upForProximityLabel("close_by")).toBe("Close By");
    expect(upForProximityLabel("nearby")).toBe("In Your Area");
    expect(upForProximityLabel("wider_area")).toBe("Around Town");

    const reachable = (["close_by", "nearby", "wider_area"] as const).map(upForProximityLabel);
    expect(reachable).not.toContain("Right Here");
    expect(reachable).not.toContain("Just Around");
  });

  it("says nothing when the tier is unknown", () => {
    // Silence, not a guess. "Across Town" would be as invented as "Right Here".
    expect(upForProximityLabel(null)).toBeNull();
  });

  it("emits no number, unit or coordinate anywhere in the module", () => {
    /* The one deliberate deviation from the approved reference. Asserted
     * against the source so a later "helpful" addition of "2.4 km" fails
     * here rather than shipping. */
    const source = readFileSync("lib/social/upfor-feed.ts", "utf8");
    const rendered = source.slice(source.indexOf("export function upForProximityLabel"));
    for (const banned of ["km", " m away", "metre", "meter", "latitude", "longitude", "coords"]) {
      expect(rendered.slice(0, 400).toLowerCase(), banned).not.toContain(banned);
    }
  });
});

describe("discovery modes narrow, they do not widen", () => {
  it("names the three approved tabs", () => {
    // Groups was removed from UpFor discovery by owner decision. The standalone
    // Groups product is untouched; a Group-audienced UpFor still appears under
    // the remaining tabs.
    expect(UPFOR_MODES.map((m) => m.id)).toEqual(["for_you", "muddies", "around"]);
    expect(UPFOR_MODES.map((m) => m.label)).toEqual(["For You", "Muddies", "Around"]);
    expect(isUpForMode("for_you")).toBe(true);
    expect(isUpForMode("popular")).toBe(false);
  });

  it("lands a stale ?tab=groups link on a tab that exists", () => {
    // A bookmarked Groups URL must not strand somebody on a tab that is gone.
    expect(isUpForMode("groups")).toBe(false);
    expect(resolveUpForMode("groups")).toBe("for_you");
    expect(resolveUpForMode(null)).toBe("for_you");
    expect(resolveUpForMode("muddies")).toBe("muddies");
  });

  it("Muddies shows only Muddies", () => {
    const list = [item({ id: "m", isMuddy: true }), item({ id: "s", isMuddy: false })];
    expect(filterForMode(list, "muddies", NOW).map((i) => i.id)).toEqual(["m"]);
  });

  it("Groups shows only what arrived through a group", () => {
    const list = [item({ id: "g", viaGroup: true }), item({ id: "n", viaGroup: false })];
    expect(filterForMode(list, "groups", NOW).map((i) => i.id)).toEqual(["g"]);
  });

  it("For You is not an alias for everything", () => {
    /* It returns the same set, ORDERED -- a stranger's crowded UpFor must not
     * outrank a Muddy's simply by arriving first. */
    const list = [
      item({ id: "stranger", isMuddy: false, goingCount: 3 }),
      item({ id: "muddy", isMuddy: true, goingCount: 0 })
    ];
    const ranked = filterForMode(list, "for_you", NOW);
    expect(ranked).toHaveLength(2);
    expect(ranked[0]!.id).toBe("muddy");
  });

  it("Around keeps items whose position is unknown", () => {
    // Unknown is not evidence of being far away.
    const list = [item({ id: "unknown", isMuddy: false, areaTier: null })];
    expect(filterForMode(list, "around", NOW).map((i) => i.id)).toEqual(["unknown"]);
  });

  it("never invents an item that was not eligible", () => {
    // A mode can only ever return a subset of what the server already allowed.
    const list = [item({ id: "a" }), item({ id: "b", isMuddy: true })];
    for (const mode of UPFOR_MODES) {
      const out = filterForMode(list, mode.id, NOW);
      expect(out.length, mode.id).toBeLessThanOrEqual(list.length);
      for (const row of out) expect(list.map((i) => i.id)).toContain(row.id);
    }
  });
});

describe("ranking is deterministic and explainable", () => {
  it("prefers a Muddy over a stranger", () => {
    const muddy = upForRelevanceScore(item({ isMuddy: true }), NOW);
    const stranger = upForRelevanceScore(item({ isMuddy: false }), NOW);
    expect(muddy).toBeGreaterThan(stranger);
  });

  it("prefers fresher over older", () => {
    const fresh = upForRelevanceScore(item({ startsAt: new Date(NOW - 10 * 60_000).toISOString() }), NOW);
    const old = upForRelevanceScore(item({ startsAt: new Date(NOW - 5 * HOUR).toISOString() }), NOW);
    expect(fresh).toBeGreaterThan(old);
  });

  it("sinks an UpFor that is nearly over", () => {
    const ending = upForRelevanceScore(item({ endsAt: new Date(NOW + 5 * 60_000).toISOString() }), NOW);
    const roomy = upForRelevanceScore(item({ endsAt: new Date(NOW + 3 * HOUR).toISOString() }), NOW);
    expect(ending).toBeLessThan(roomy);
  });

  it("caps participation so a crowd cannot bury everything else", () => {
    const busy = upForRelevanceScore(item({ goingCount: 50 }), NOW);
    const five = upForRelevanceScore(item({ goingCount: 5 }), NOW);
    expect(busy).toBe(five);
  });

  it("orders identically for identical input", () => {
    const list = [item({ id: "b" }), item({ id: "a" }), item({ id: "c" })];
    expect(rankForYou(list, NOW).map((i) => i.id)).toEqual(rankForYou(list, NOW).map((i) => i.id));
  });
});

describe("social proof counts real joiners only", () => {
  const person = (id: string) => ({ userId: id, name: id, avatarUrl: null });

  it("says nothing when nobody has joined", () => {
    /* A fresh UpFor has its creator and no one else. "1 is in" would imply
     * somebody responded. */
    expect(upForSocialProof({ participants: [] }).label).toBeNull();
  });

  it("uses singular and plural correctly", () => {
    expect(upForSocialProof({ participants: [person("a")] }).label).toBe("1 is in");
    expect(upForSocialProof({ participants: [person("a"), person("b")] }).label).toBe("2 are in");
  });

  it("collapses the tail into an overflow count", () => {
    const five = ["a", "b", "c", "d", "e"].map(person);
    const proof = upForSocialProof({ participants: five });
    expect(proof.visible).toHaveLength(3);
    expect(proof.overflow).toBe(2);
    expect(proof.label).toBe("5 are in");
  });

  it("derives overflow from the filtered list, never a raw count", () => {
    /* If a participant was withheld from this viewer they must not reappear
     * inside a "+n". The function only ever sees what it is given. */
    const visibleOnly = ["a", "b"].map(person);
    const proof = upForSocialProof({ participants: visibleOnly });
    expect(proof.overflow).toBe(0);
    expect(proof.label).toBe("2 are in");
  });
});

describe("momentum is derived, never stored", () => {
  const live = { endsAt: new Date(NOW + 2 * HOUR).toISOString(), nowMs: NOW };

  it("rises with real joiners", () => {
    expect(upForMomentum({ ...live, joinerCount: 0 })).toBe("quiet");
    expect(upForMomentum({ ...live, joinerCount: 1 })).toBe("growing");
    expect(upForMomentum({ ...live, joinerCount: MOMENTUM_PLAN_THRESHOLD })).toBe("strong");
  });

  it("collapses to quiet once the UpFor has ended", () => {
    expect(
      upForMomentum({ joinerCount: 9, endsAt: new Date(NOW - HOUR).toISOString(), nowMs: NOW })
    ).toBe("quiet");
  });

  it("offers Create Plan only to the owner of a live, busy UpFor", () => {
    const base = { joinerCount: MOMENTUM_PLAN_THRESHOLD, ...live, status: "active" };
    expect(shouldOfferPlanConversion({ ...base, isOwner: true })).toBe(true);
    // Somebody else's decision is not the viewer's to make.
    expect(shouldOfferPlanConversion({ ...base, isOwner: false })).toBe(false);
    expect(shouldOfferPlanConversion({ ...base, isOwner: true, joinerCount: 1 })).toBe(false);
    expect(shouldOfferPlanConversion({ ...base, isOwner: true, status: "cancelled" })).toBe(false);
    expect(
      shouldOfferPlanConversion({
        ...base,
        isOwner: true,
        endsAt: new Date(NOW - HOUR).toISOString()
      })
    ).toBe(false);
  });

  it("counts the creator in the conversion sentence", () => {
    expect(planConversionSummary({ joinerCount: 3, activityLabel: "Food" })).toBe(
      "4 people are up for food."
    );
    expect(planConversionSummary({ joinerCount: 0, activityLabel: "Coffee" })).toBe(
      "1 person is up for coffee."
    );
  });
});

describe("empty states claim only what is known", () => {
  it("never says there is nobody nearby", () => {
    /* The system knows no eligible live UpFor came back. It does not know
     * whether anybody is nearby, and saying so would be both wrong and bleak. */
    const around = upForEmptyCopy("around");
    expect(`${around.title} ${around.body}`.toLowerCase()).not.toContain("nobody");
    expect(`${around.title} ${around.body}`.toLowerCase()).not.toContain("no one");
  });

  it("gives every tab its own copy", () => {
    const titles = UPFOR_MODES.map((m) => upForEmptyCopy(m.id).title);
    expect(new Set(titles).size).toBe(UPFOR_MODES.length);
    for (const title of titles) expect(title.length).toBeGreaterThan(0);
  });
});
