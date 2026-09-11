import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  AVATAR_SIZE_BY_GLOW_SIZE,
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
import { bandForDistance, type ProximityBand } from "@/lib/proximity/bands";

const SIZES = Object.keys(PROXIMITY_GLOW_SIZES) as ProximityGlowSize[];

describe("distance resolves to the corrected public glow stages", () => {
  const glowForDistance = (distanceMeters: number): ProximityGlowLevel | null =>
    glowLevelForBand(bandForDistance(distanceMeters));

  it.each([
    [0, "right-here"],
    [100, "right-here"],
    [101, "just-around"],
    [500, "just-around"],
    [501, "close-by"],
    [2_000, "close-by"],
    [2_001, "in-your-area"],
    [5_000, "in-your-area"],
    [5_001, "around-town"],
    [10_000, "around-town"],
    [10_001, "around-town"],
    [15_000, "around-town"],
    [15_001, null]
  ] as const)("%dm renders %s", (meters, expected) => {
    expect(glowForDistance(meters)).toBe(expected);
  });

  it("maps the two broad in-range backend bands to one public Nearby glow", () => {
    expect(glowLevelForBand("around_town")).toBe("around-town");
    expect(glowLevelForBand("further_away")).toBe("around-town");
  });

  it("does not render an outside-range Glow after the 15 km Nearby gate", () => {
    expect(glowLevelForBand("outside_range")).toBeNull();
  });

  it("still maps every band deterministically", () => {
    const bands: ProximityBand[] = [
      "right_here",
      "around_you",
      "close_by",
      "nearby",
      "around_town",
      "further_away",
      "outside_range"
    ];
    expect(bands.map((band) => glowLevelForBand(band))).toEqual([
      "right-here",
      "just-around",
      "close-by",
      "in-your-area",
      "around-town",
      "around-town",
      null
    ]);
  });
});

describe("Magnetic Pulse progression", () => {
  const ordered = PROXIMITY_GLOW_LEVELS.map((level) => PROXIMITY_GLOW_CONFIG[level]);

  it("uses the approved six public stage names", () => {
    expect(ordered.map((config) => config.label)).toEqual([
      "Just Around",
      "Very Close",
      "Close",
      "In Area",
      "Nearby",
      "Far"
    ]);
    for (const level of PROXIMITY_GLOW_LEVELS) {
      expect(proximityGlowLabel(level)).toBe(PROXIMITY_GLOW_CONFIG[level].label);
    }
  });

  it("gets smaller, softer and slower as distance grows", () => {
    for (let index = 1; index < ordered.length; index += 1) {
      const closer = ordered[index - 1]!;
      const further = ordered[index]!;
      expect(further.ring, further.level).toBeLessThan(closer.ring);
      expect(further.outer, further.level).toBeLessThan(closer.outer);
      expect(further.blur, further.level).toBeLessThan(closer.blur);
      expect(further.strength, further.level).toBeLessThan(closer.strength);
      expect(further.pulseSeconds, further.level).toBeGreaterThan(closer.pulseSeconds);
    }
  });

  it("puts the requested 1.7s / 2.15s cadence on Just Around, the strongest stage", () => {
    const justAround = PROXIMITY_GLOW_CONFIG["right-here"];
    expect(justAround.label).toBe("Just Around");
    expect(justAround.pulseSeconds).toBe(1.7);
    expect(justAround.layers.sweepSeconds).toBe(2.15);
    expect(justAround.layers.pulseCount).toBe(3);
    expect(justAround.strength).toBe(1);
  });

  it("keeps Very Close below Just Around", () => {
    const justAround = PROXIMITY_GLOW_CONFIG["right-here"];
    const veryClose = PROXIMITY_GLOW_CONFIG["just-around"];
    expect(veryClose.label).toBe("Very Close");
    expect(veryClose.pulseSeconds).toBeGreaterThan(justAround.pulseSeconds);
    expect(veryClose.layers.sweepSeconds!).toBeGreaterThan(justAround.layers.sweepSeconds!);
    expect(veryClose.strength).toBeLessThan(justAround.strength);
  });

  it("builds intensity through rings instead of particles or decorative orbits", () => {
    expect(ordered.map((config) => config.layers.pulseCount)).toEqual([3, 3, 2, 2, 1, 1]);
    const serialized = JSON.stringify(PROXIMITY_GLOW_CONFIG);
    for (const retired of ["sparkOpacity", "ringStyle", "ringSpin", '"orbit"', '"dotted"', '"dashed"']) {
      expect(serialized).not.toContain(retired);
    }
  });

  it("only rotates a highlight where the state is close enough to benefit from it", () => {
    expect(PROXIMITY_GLOW_CONFIG["right-here"].layers.sweepSeconds).not.toBeNull();
    expect(PROXIMITY_GLOW_CONFIG["just-around"].layers.sweepSeconds).not.toBeNull();
    expect(PROXIMITY_GLOW_CONFIG["close-by"].layers.sweepSeconds).not.toBeNull();
    expect(PROXIMITY_GLOW_CONFIG["in-your-area"].layers.sweepSeconds).toBeNull();
    expect(PROXIMITY_GLOW_CONFIG["around-town"].layers.sweepSeconds).toBeNull();
    expect(PROXIMITY_GLOW_CONFIG["across-town"].layers.sweepSeconds).toBeNull();
  });
});

describe("geometry and sizes remain production-safe", () => {
  it.each(SIZES)("keeps every state ordered at %s", (size) => {
    const geometries = PROXIMITY_GLOW_LEVELS.map((level) => resolveGlowGeometry(level, size));
    for (let index = 1; index < geometries.length; index += 1) {
      expect(geometries[index]!.ring).toBeLessThan(geometries[index - 1]!.ring);
      expect(geometries[index]!.outer).toBeLessThan(geometries[index - 1]!.outer);
    }
  });

  it("maps every Glow size to a real avatar size", () => {
    for (const size of SIZES) expect(AVATAR_SIZE_BY_GLOW_SIZE[size]).toBeTruthy();
  });

  it("keeps the aura outside the avatar and inside its published box", () => {
    for (const size of SIZES) {
      for (const level of PROXIMITY_GLOW_LEVELS) {
        const geometry = resolveGlowGeometry(level, size);
        expect(geometry.ring).toBeGreaterThan(geometry.avatar);
        expect(geometry.box).toBeGreaterThanOrEqual(geometry.ring);
        expect(geometry.box).toBeGreaterThanOrEqual(geometry.outer);
      }
    }
  });

  it("keeps animated pulse paint inside the 28px clipped-row reservation at real Muddies sizes", () => {
    for (const size of ["md", "lg"] as const) {
      for (const level of PROXIMITY_GLOW_LEVELS) {
        const geometry = resolveGlowGeometry(level, size);
        const peak = geometry.core * PROXIMITY_GLOW_CONFIG[level].layers.pulseScale;
        const overhang = (peak - geometry.avatar) / 2;
        expect(overhang, `${level}/${size}`).toBeLessThanOrEqual(28);
      }
    }
  });

  it("keeps the reference geometry available to the dev comparison harness", () => {
    for (const level of PROXIMITY_GLOW_LEVELS) {
      const reference = referenceGeometry(level);
      expect(reference.avatar).toBe(104);
      expect(reference.ring).toBe(PROXIMITY_GLOW_CONFIG[level].ring);
      expect(reference.outer).toBe(PROXIMITY_GLOW_CONFIG[level].outer);
    }
  });
});

describe("brand and motion safeguards", () => {
  const css = readFileSync("components/glow/proximity-glow.module.css", "utf8");

  it("uses the Mad Buddy palette, not neon or purple", () => {
    expect(css).toContain("--glow-brand: 232 140 43");
    expect(css).toContain("--glow-maroon: 78 4 1");
    expect(css).toContain("--glow-paper: 254 251 243");
    expect(css).not.toMatch(/167 139 250|139 92 246|#a78bfa|#8b5cf6/i);
  });

  it("uses Safari-safe modern rgb variable syntax for the pulse layers", () => {
    expect(css).toContain("rgb(var(--glow-brand) / var(--glow-halo-alpha))");
    expect(css).toContain("rgb(var(--glow-brand) / 0.86)");
    expect(css).not.toContain("rgba(var(--glow-brand),");
  });

  it("has a CSS reduced-motion stop as a second line of defence", () => {
    expect(css).toContain("@media (prefers-reduced-motion: reduce)");
    expect(css).toContain("animation: none !important");
  });

  it("animates transform/opacity rather than layout geometry", () => {
    const keyframes = css.slice(css.indexOf("@keyframes magnetic-pulse"));
    expect(keyframes).not.toMatch(/\b(width|height|top|left|margin|padding):/);
    expect(keyframes).toContain("transform:");
    expect(keyframes).toContain("opacity:");
  });
});
