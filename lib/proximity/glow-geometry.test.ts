import { describe, expect, it } from "vitest";

import {
  PROXIMITY_GLOW_CONFIG,
  PROXIMITY_GLOW_SIZES,
  glowLevelForBand,
  type ProximityGlowLevel,
  type ProximityGlowSize
} from "@/lib/proximity/glow-config";
import { PROXIMITY_BAND_LABELS, type ProximityBand } from "@/lib/proximity/bands";

/**
 * PROXIMITY GLOW GEOMETRY — the deterministic half of the investigation.
 *
 * BACKGROUND. A device-side report described the Glow ring as off-centre
 * against the avatar. A browser measurement of the shared primitive found
 * dx = 0 and dy = 0, so the report was NOT reproduced, and the standing
 * instruction is that no speculative CSS change may be made on the strength of
 * an unreproduced symptom.
 *
 * WHAT THIS FILE IS FOR. Everything about the Glow's geometry that can be
 * decided without a browser, pinned so that if the ring ever DOES drift, the
 * cause is narrowed to rendering rather than to configuration -- and so a
 * future edit cannot introduce an asymmetry here silently.
 *
 * The properties below are the ones a centring bug would have to violate:
 *
 *   - every size is SQUARE (one avatarPx, so width can never differ from
 *     height -- the classic source of a ring that looks nudged)
 *   - every level's ring and outer are single radii, applied uniformly, so
 *     there is no per-axis value that could differ
 *   - `outer` always exceeds `ring`, so the aura surrounds rather than
 *     crops the ring
 *   - every band maps to exactly one level, and every level is configured
 *
 * What it deliberately does NOT do is assert pixel positions: those need a
 * real layout engine, and the browser measurement already covered them.
 */

const ALL_SIZES: ProximityGlowSize[] = ["sm", "md", "lg", "hero"];

const ALL_BANDS: ProximityBand[] = [
  "right_here",
  "around_you",
  "close_by",
  "nearby",
  "around_town",
  "further_away",
  "outside_range"
];

/** The sizes the real surfaces actually pass, so the harness covers them. */
const SIZES_IN_USE: Record<string, ProximityGlowSize> = {
  // components/dashboard/dashboard-page.tsx
  home: "sm",
  // components/friends/muddies-closest-rail.tsx and muddies-grid.tsx
  muddiesRail: "lg",
  muddiesGrid: "lg",
  // components/friends/muddy-profile-page.tsx
  muddyProfile: "hero"
};

describe("every Glow size is square", () => {
  /* A RING THAT LOOKS OFF-CENTRE IS USUALLY A BOX THAT IS NOT SQUARE. One
     `avatarPx` per size makes that impossible by construction: there is no
     second number to disagree with the first. */
  it("describes each size with a single dimension", () => {
    for (const size of ALL_SIZES) {
      const config = PROXIMITY_GLOW_SIZES[size];
      expect(config, `${size} has no size config`).toBeTruthy();
      expect(typeof config.avatarPx).toBe("number");
      expect(config.avatarPx).toBeGreaterThan(0);
      // If a width/height pair is ever introduced, this is where it shows up.
      expect(Object.keys(config).sort()).toEqual(["avatarPx", "blurFloor"]);
    }
  });

  it("covers every size the real surfaces ask for", () => {
    for (const [surface, size] of Object.entries(SIZES_IN_USE)) {
      expect(PROXIMITY_GLOW_SIZES[size], `${surface} uses an unconfigured size`).toBeTruthy();
    }
  });

  it("grows monotonically, so the hierarchy survives at every size", () => {
    const pixels = ALL_SIZES.map((size) => PROXIMITY_GLOW_SIZES[size].avatarPx);
    const sorted = [...pixels].sort((a, b) => a - b);
    expect(pixels).toEqual(sorted);
    expect(new Set(pixels).size, "two sizes render identically").toBe(pixels.length);
  });
});

describe("every Glow level is uniformly round", () => {
  const levels = Object.keys(PROXIMITY_GLOW_CONFIG) as ProximityGlowLevel[];

  it("uses one radius per ring, never a per-axis pair", () => {
    for (const level of levels) {
      const config = PROXIMITY_GLOW_CONFIG[level];
      expect(typeof config.ring, `${level}.ring is not a single number`).toBe("number");
      expect(typeof config.outer, `${level}.outer is not a single number`).toBe("number");
      // An x/y pair here would be the one way configuration could offset a ring.
      expect(config).not.toHaveProperty("ringX");
      expect(config).not.toHaveProperty("ringY");
      expect(config).not.toHaveProperty("offsetX");
      expect(config).not.toHaveProperty("offsetY");
    }
  });

  it("keeps the aura outside the ring at every level", () => {
    for (const level of levels) {
      const { ring, outer } = PROXIMITY_GLOW_CONFIG[level];
      expect(outer, `${level} has an aura inside its own ring`).toBeGreaterThan(ring);
    }
  });

  it("gives every level a positive, finite geometry", () => {
    for (const level of levels) {
      const config = PROXIMITY_GLOW_CONFIG[level];
      for (const key of ["ring", "outer", "blur", "strength"] as const) {
        expect(Number.isFinite(config[key]), `${level}.${key} is not finite`).toBe(true);
        expect(config[key], `${level}.${key} is not positive`).toBeGreaterThan(0);
      }
    }
  });
});

describe("every proximity band resolves to exactly one configured level", () => {
  it("maps all six in-range bands, and nothing else", () => {
    for (const band of ALL_BANDS) {
      const level = glowLevelForBand(band);
      if (band === "outside_range") {
        /* Deliberately no Glow: somebody past the gate is excluded from the
           response entirely, so a faint ring would be presentation inventing a
           state the data never claimed. */
        expect(level, "outside_range grew a Glow").toBeNull();
        continue;
      }
      expect(level, `${band} resolves to no level`).toBeTruthy();
      expect(
        PROXIMITY_GLOW_CONFIG[level as ProximityGlowLevel],
        `${band} resolves to an unconfigured level`
      ).toBeTruthy();
    }
  });

  it("has a label for every band the product can show", () => {
    for (const band of ALL_BANDS) {
      expect(PROXIMITY_BAND_LABELS[band], `${band} has no label`).toBeTruthy();
    }
  });

  it("gets stronger as somebody gets closer", () => {
    /* The ordering that makes the Glow mean something. Right Here must not be
       fainter than Across Town. */
    const ordered: ProximityBand[] = [
      "right_here",
      "around_you",
      "close_by",
      "nearby",
      "around_town",
      "further_away"
    ];
    const strengths = ordered.map((band) => {
      const level = glowLevelForBand(band) as ProximityGlowLevel;
      return PROXIMITY_GLOW_CONFIG[level].strength;
    });
    for (let i = 1; i < strengths.length; i += 1) {
      expect(
        strengths[i],
        `${ordered[i]} glows at least as strongly as ${ordered[i - 1]}`
      ).toBeLessThanOrEqual(strengths[i - 1]);
    }
  });
});
