import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  AVATAR_SIZE_BY_GLOW_SIZE,
  GLOW_SPARKS,
  glowLevelForBand,
  PROXIMITY_GLOW_CONFIG,
  PROXIMITY_GLOW_LEVELS,
  PROXIMITY_GLOW_SIZES,
  proximityGlowLabel,
  referenceGeometry,
  resolveGlowGeometry,
  type ProximityGlowLevel,
  type ProximityGlowSize
} from "@/lib/proximity/glow-config";
import {
  bandForDistance,
  PROXIMITY_BAND_LABELS,
  type ProximityBand
} from "@/lib/proximity/bands";

/**
 * The Proximity Glow port.
 *
 * The prototype at `Design Reference/MadBuddy_Proximity_Glow_Prototype.html` is
 * the specification, so several of these tests read it and assert that the
 * production table still agrees with it. That is deliberate: a port that
 * silently drifts from its reference is the exact failure this batch exists to
 * prevent, and a hand-copied number is the easiest thing in the world to get
 * wrong twice.
 */

const PROTOTYPE = readFileSync("Design Reference/MadBuddy_Proximity_Glow_Prototype.html", "utf8");

const SIZES = Object.keys(PROXIMITY_GLOW_SIZES) as ProximityGlowSize[];

// ---------------------------------------------------------------------------
// Distance -> state, including every boundary
// ---------------------------------------------------------------------------

/** The full pipeline a real reading takes: metres -> band -> Glow state. */
function glowForDistance(distanceMeters: number): ProximityGlowLevel | null {
  return glowLevelForBand(bandForDistance(distanceMeters));
}

describe("distance resolves to the approved six states", () => {
  it.each([
    [0, "right-here"],
    [50, "right-here"],
    [100, "right-here"],
    [101, "just-around"],
    [500, "just-around"],
    [501, "close-by"],
    [2_000, "close-by"],
    [2_001, "in-your-area"],
    [5_000, "in-your-area"],
    [5_001, "around-town"],
    [10_000, "around-town"],
    [10_001, "across-town"],
    [15_000, "across-town"]
  ] as const)("%dm renders %s", (meters, expected) => {
    expect(glowForDistance(meters)).toBe(expected);
  });

  it("renders no Glow past the 15km eligibility gate", () => {
    // Not a seventh, fainter state: someone outside range is dropped from the
    // response entirely, so presentation must not invent a state for them.
    expect(glowForDistance(15_001)).toBeNull();
    expect(glowForDistance(40_000)).toBeNull();
  });

  it("renders no Glow for an unusable reading", () => {
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, -1, -5_000]) {
      expect(glowForDistance(bad), String(bad)).toBeNull();
    }
  });

  it("renders no Glow when there is no proximity signal at all", () => {
    // Absent is not "far": chat, group and Plan avatars have no band and must
    // stay glow-free rather than all wearing the weakest state.
    expect(glowLevelForBand(null)).toBeNull();
    expect(glowLevelForBand(undefined)).toBeNull();
  });

  it("maps every band exactly once, so no two bands share a Glow", () => {
    const bands: ProximityBand[] = [
      "right_here",
      "around_you",
      "close_by",
      "nearby",
      "around_town",
      "further_away"
    ];
    const levels = bands.map((band) => glowLevelForBand(band));
    expect(levels).toEqual(PROXIMITY_GLOW_LEVELS);
    expect(new Set(levels).size).toBe(bands.length);
  });
});

// ---------------------------------------------------------------------------
// Fidelity to the approved prototype
// ---------------------------------------------------------------------------

describe("the config matches the approved prototype", () => {
  /** Pull the four custom properties the prototype sets for one state. */
  function prototypeValues(level: ProximityGlowLevel) {
    const rule = new RegExp(`\\.${level}\\{([^}]*)\\}`).exec(PROTOTYPE);
    expect(rule, `prototype defines .${level}`).toBeTruthy();
    const body = rule![1];
    const read = (name: string) => {
      const match = new RegExp(`--${name}:\\s*([0-9.]+)`).exec(body);
      expect(match, `.${level} sets --${name}`).toBeTruthy();
      return Number(match![1]);
    };
    return {
      ring: read("ring"),
      outer: read("outer"),
      blur: read("blur"),
      strength: read("strength"),
      pulse: read("pulse")
    };
  }

  it.each(PROXIMITY_GLOW_LEVELS)("%s keeps the prototype geometry", (level) => {
    const reference = prototypeValues(level);
    const config = PROXIMITY_GLOW_CONFIG[level];

    expect(config.ring).toBe(reference.ring);
    expect(config.outer).toBe(reference.outer);
    expect(config.blur).toBe(reference.blur);
    expect(config.strength).toBe(reference.strength);
    expect(config.pulseSeconds).toBe(reference.pulse);
  });

  it("reproduces the reference geometry exactly, unscaled", () => {
    // The 1:1 comparison the harness shows. Scaled sizes are approximations of
    // these; this is the approved geometry itself.
    for (const level of PROXIMITY_GLOW_LEVELS) {
      const reference = prototypeValues(level);
      const geometry = referenceGeometry(level);
      expect(geometry.ring, level).toBe(reference.ring);
      expect(geometry.outer, level).toBe(reference.outer);
      expect(geometry.blur, level).toBe(reference.blur);
      // The prototype's own core/field/spark constants.
      expect(geometry.core, level).toBe(118);
      expect(geometry.field, level).toBe(220);
      expect(geometry.sparkRadius, level).toBe(94);
    }
  });

  it("keeps the prototype spark count", () => {
    const sparks = (PROTOTYPE.match(/<i style="--a:/g) ?? []).length;
    expect(GLOW_SPARKS).toHaveLength(sparks);
  });

  it("uses the prototype state names", () => {
    for (const level of PROXIMITY_GLOW_LEVELS) {
      expect(PROTOTYPE).toContain(`'${level}'`);
      expect(PROTOTYPE).toContain(proximityGlowLabel(level));
    }
  });
});

// ---------------------------------------------------------------------------
// Perceptual separation -- the point of the redesign
// ---------------------------------------------------------------------------

describe("the six states are perceptually separated", () => {
  const ordered = PROXIMITY_GLOW_LEVELS.map((level) => PROXIMITY_GLOW_CONFIG[level]);

  it("decreases monotonically in radius, luminosity and blur", () => {
    for (let i = 1; i < ordered.length; i += 1) {
      const closer = ordered[i - 1];
      const further = ordered[i];
      expect(further.ring, further.level).toBeLessThan(closer.ring);
      expect(further.outer, further.level).toBeLessThan(closer.outer);
      expect(further.blur, further.level).toBeLessThan(closer.blur);
      expect(further.strength, further.level).toBeLessThan(closer.strength);
    }
  });

  it("slows the pulse monotonically as distance grows", () => {
    // Animation energy carries the hierarchy as much as radius does: Right Here
    // breathes roughly five times faster than Across Town.
    for (let i = 1; i < ordered.length; i += 1) {
      expect(ordered[i].pulseSeconds, ordered[i].level).toBeGreaterThan(
        ordered[i - 1].pulseSeconds
      );
    }
  });

  it("separates the extremes by far more than a border width", () => {
    // The failure this redesign fixes: six states that differed only by a
    // couple of pixels and a little opacity. Fixed thresholds so a future
    // "tidy-up" that flattens the scale fails here rather than in review.
    const closest = PROXIMITY_GLOW_CONFIG["right-here"];
    const furthest = PROXIMITY_GLOW_CONFIG["across-town"];

    expect(closest.strength / furthest.strength).toBeGreaterThan(5);
    expect(closest.blur / furthest.blur).toBeGreaterThan(5);
    expect(furthest.pulseSeconds / closest.pulseSeconds).toBeGreaterThan(4);
    expect(closest.outer - furthest.outer).toBeGreaterThan(50);
  });

  it("sheds layers as distance grows, rather than only fading them", () => {
    // Selective removal IS the design. A state that drew every layer at lower
    // opacity would collapse the six back into one.
    const layerCount = (level: ProximityGlowLevel) => {
      const { layers } = PROXIMITY_GLOW_CONFIG[level];
      return (
        Number(layers.radial) +
        Number(layers.sparkOpacity > 0) +
        Number(layers.orbit) +
        Number(layers.ring2 !== "none")
      );
    };

    expect(layerCount("right-here")).toBe(3);
    expect(layerCount("just-around")).toBe(2);
    expect(layerCount("close-by")).toBe(2);
    expect(layerCount("in-your-area")).toBe(1);
    expect(layerCount("across-town")).toBe(0);

    // Only the closest state pays for the expensive conic field.
    const withRadial = PROXIMITY_GLOW_LEVELS.filter(
      (level) => PROXIMITY_GLOW_CONFIG[level].layers.radial
    );
    expect(withRadial).toEqual(["right-here"]);

    // Sparks are limited to the two closest states, so a long list cannot
    // spawn nine animated nodes per row.
    const withSparks = PROXIMITY_GLOW_LEVELS.filter(
      (level) => PROXIMITY_GLOW_CONFIG[level].layers.sparkOpacity > 0
    );
    expect(withSparks).toEqual(["right-here", "just-around", "close-by"]);
  });

  it("gives the broad-area states their own ring treatment", () => {
    expect(PROXIMITY_GLOW_CONFIG["around-town"].layers.ringStyle).toBe("dashed");
    expect(PROXIMITY_GLOW_CONFIG["across-town"].layers.ringStyle).toBe("dotted");
    expect(PROXIMITY_GLOW_CONFIG["across-town"].layers.coreBloom).toBe("faint");
  });
});

// ---------------------------------------------------------------------------
// Size variants
// ---------------------------------------------------------------------------

describe("size variants preserve the hierarchy", () => {
  it.each(SIZES)("keeps every state ordered at %s", (size) => {
    const geometries = PROXIMITY_GLOW_LEVELS.map((level) => resolveGlowGeometry(level, size));
    for (let i = 1; i < geometries.length; i += 1) {
      expect(geometries[i].ring).toBeLessThan(geometries[i - 1].ring);
      expect(geometries[i].outer).toBeLessThan(geometries[i - 1].outer);
    }
  });

  it("keeps the extremes clearly distinguishable even at sm", () => {
    // The acceptance criterion, asserted rather than eyeballed: if the smallest
    // variant ever collapses the scale, this fails.
    const closest = resolveGlowGeometry("right-here", "sm");
    const furthest = resolveGlowGeometry("across-town", "sm");
    expect(closest.outer - furthest.outer).toBeGreaterThan(15);
    expect(closest.blur).toBeGreaterThan(furthest.blur * 2);
  });

  it("never lets the weakest state round away to nothing", () => {
    for (const size of SIZES) {
      expect(resolveGlowGeometry("across-town", size).blur).toBeGreaterThanOrEqual(3);
    }
  });

  it("scales proportionally against the size it actually renders at", () => {
    // hero is the reference scale for the prototype ratios; every smaller size
    // is a strict scale-down of the same geometry, not a re-tuned table.
    for (const size of SIZES) {
      const { avatarPx } = PROXIMITY_GLOW_SIZES[size];
      const geometry = resolveGlowGeometry("right-here", size);
      const expectedRing = (PROXIMITY_GLOW_CONFIG["right-here"].ring * avatarPx) / 104;
      expect(geometry.ring).toBeCloseTo(expectedRing, 1);
      // The ring always clears the avatar it surrounds.
      expect(geometry.ring).toBeGreaterThan(avatarPx);
    }
  });

  it("reserves room for the animation peak, not just the static layers", () => {
    // The bug this guards: Right Here's expanding wave scales ring2 to 1.13,
    // which reaches ~232px against a 220px static field. A box sized to the
    // field cropped the most dramatic state in any surface that clips.
    for (const size of SIZES) {
      for (const level of PROXIMITY_GLOW_LEVELS) {
        const geometry = resolveGlowGeometry(level, size);
        const { layers } = PROXIMITY_GLOW_CONFIG[level];

        const ring2Peak =
          layers.ring2 === "expanding"
            ? geometry.outer * 1.13
            : layers.ring2 === "soft-pulse"
              ? geometry.outer * 1.04
              : geometry.outer;

        expect(geometry.box, `${level}/${size} contains ring2`).toBeGreaterThanOrEqual(ring2Peak);
        expect(geometry.box, `${level}/${size} contains core`).toBeGreaterThanOrEqual(
          geometry.core * 1.08
        );
        expect(geometry.box, `${level}/${size} contains field`).toBeGreaterThanOrEqual(
          geometry.field
        );
        expect(geometry.box, `${level}/${size} contains ring`).toBeGreaterThanOrEqual(geometry.ring);
      }
    }
  });

  it("only grows the box where a layer actually needs it", () => {
    // A blanket oversize would push neighbouring avatars apart for nothing.
    // Only Right Here's expanding wave reaches past the static field.
    expect(resolveGlowGeometry("right-here", "hero").box).toBeGreaterThan(
      resolveGlowGeometry("right-here", "hero").field
    );
    for (const level of ["close-by", "in-your-area", "around-town", "across-town"] as const) {
      const geometry = resolveGlowGeometry(level, "hero");
      expect(geometry.box, level).toBe(geometry.field);
    }
  });

  it("maps every Glow size to a real avatar size", () => {
    for (const size of SIZES) {
      expect(AVATAR_SIZE_BY_GLOW_SIZE[size]).toBeTruthy();
    }
  });
});

// ---------------------------------------------------------------------------
// Copy and privacy
// ---------------------------------------------------------------------------

describe("user-facing copy", () => {
  it("uses the six approved names", () => {
    expect(PROXIMITY_GLOW_LEVELS.map(proximityGlowLabel)).toEqual([
      "Right Here",
      "Just Around",
      "Close By",
      "In Your Area",
      "Around Town",
      "Across Town"
    ]);
  });

  it("agrees with the band table, so no surface can disagree with another", () => {
    // Two copies of the copy is how the badge and the Glow start naming the
    // same state differently.
    const bands: ProximityBand[] = [
      "right_here",
      "around_you",
      "close_by",
      "nearby",
      "around_town",
      "further_away"
    ];
    for (const band of bands) {
      const level = glowLevelForBand(band)!;
      expect(PROXIMITY_BAND_LABELS[band]).toBe(proximityGlowLabel(level));
    }
  });

  it("never exposes a distance, a unit or a travel time", () => {
    for (const level of PROXIMITY_GLOW_LEVELS) {
      const config = PROXIMITY_GLOW_CONFIG[level];
      for (const copy of [config.label, config.description]) {
        expect(copy, copy).not.toMatch(/\d/);
        expect(copy, copy).not.toMatch(/\b(m|km|mi|metres|meters|miles|minutes?|mins?)\b/i);
        expect(copy, copy).not.toMatch(/\b(walk|walking|drive|driving|away)\b/i);
      }
    }
  });
});
