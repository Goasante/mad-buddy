/**
 * Canonical presentation authority for Mad Buddy proximity.
 *
 * The server still decides the user's privacy-safe `ProximityBand`. This file
 * only decides how that band looks. It never receives coordinates, exact
 * distance or accuracy, and it cannot widen the 15 km eligibility gate.
 *
 * MAGNETIC PULSE replaces the former spark/orbit treatment with a restrained
 * stack of concentric transform/opacity pulses plus an optional rotating sweep.
 * The closest states add energy by adding rings, brightness and speed; the
 * furthest states remove layers instead of turning into decorative noise.
 */

import type { ProximityBand } from "@/lib/proximity/bands";

export type ProximityGlowLevel =
  | "right-here"
  | "just-around"
  | "close-by"
  | "in-your-area"
  | "around-town"
  | "across-town";

/** Ordered closest-first. */
export const PROXIMITY_GLOW_LEVELS: readonly ProximityGlowLevel[] = [
  "right-here",
  "just-around",
  "close-by",
  "in-your-area",
  "around-town",
  "across-town"
] as const;

const GLOW_LEVEL_BY_BAND: Record<ProximityBand, ProximityGlowLevel | null> = {
  right_here: "right-here",
  around_you: "just-around",
  close_by: "close-by",
  nearby: "in-your-area",
  around_town: "around-town",
  further_away: "across-town",
  outside_range: null
};

export function glowLevelForBand(
  band: ProximityBand | null | undefined
): ProximityGlowLevel | null {
  if (!band) return null;
  return GLOW_LEVEL_BY_BAND[band] ?? null;
}

export type MagneticPulseMode = "breathe" | "pulse" | "pulse-hot";

export type GlowLayers = {
  /** 1-3 concentric expanding rings. No spark particles or decorative dots. */
  pulseCount: 1 | 2 | 3;
  /** Far uses a quiet breath; closer states use progressively firmer expansion. */
  pulseMode: MagneticPulseMode;
  /** Peak transform scale of a pulse ring. */
  pulseScale: number;
  /** Alpha of the leading pulse ring before strength is applied. */
  pulseAlpha: number;
  /** Alpha of the stationary halo immediately around the avatar. */
  haloAlpha: number;
  /** Rotating conic highlight. Zero means the sweep is not rendered at all. */
  sweepOpacity: number;
  /** Seconds per revolution when the sweep is present. */
  sweepSeconds: number | null;
  /** Solid ring width at the avatar edge. Kept for geometry tests and sizing. */
  ringWidth: number;
};

export type ProximityGlowConfig = {
  level: ProximityGlowLevel;
  label: string;
  description: string;
  /** Reference diameter for the primary pulse ring at a 104 px avatar. */
  ring: number;
  /** Reference diameter for the furthest visible pulse extent. */
  outer: number;
  /** Reference soft halo blur radius. */
  blur: number;
  /** Overall luminous strength, 0-1. */
  strength: number;
  /** Primary pulse/breath period. */
  pulseSeconds: number;
  layers: GlowLayers;
};

/**
 * Magnetic Pulse progression.
 *
 * Mad Buddy already has a state tighter than the supplied prototype's closest
 * "Just Around" slot: `Right Here` (<=100 m at high confidence). The existing
 * state vocabulary and thresholds stay untouched. The requested Just Around
 * timing is therefore kept exactly at 1.70 s / 2.15 s, while Right Here is
 * allowed to be slightly faster and brighter so the real six-state ordering
 * remains monotonic.
 *
 * Geometry stays close to the existing production footprint so Muddies/Home do
 * not reflow and their already-proven bloom reservation remains sufficient.
 */
export const PROXIMITY_GLOW_CONFIG: Record<ProximityGlowLevel, ProximityGlowConfig> = {
  "right-here": {
    level: "right-here",
    label: "Right Here",
    description: "Immediate surroundings",
    ring: 154,
    outer: 205,
    blur: 31,
    strength: 1,
    pulseSeconds: 1.45,
    layers: {
      pulseCount: 3,
      pulseMode: "pulse-hot",
      pulseScale: 1.52,
      pulseAlpha: 0.44,
      haloAlpha: 0.94,
      sweepOpacity: 1,
      sweepSeconds: 1.9,
      ringWidth: 2
    }
  },
  "just-around": {
    level: "just-around",
    label: "Just Around",
    description: "Very local",
    ring: 148,
    outer: 188,
    blur: 25,
    strength: 0.9,
    pulseSeconds: 1.7,
    layers: {
      pulseCount: 3,
      pulseMode: "pulse-hot",
      pulseScale: 1.48,
      pulseAlpha: 0.4,
      haloAlpha: 0.86,
      sweepOpacity: 0.98,
      sweepSeconds: 2.15,
      ringWidth: 1.75
    }
  },
  "close-by": {
    level: "close-by",
    label: "Close By",
    description: "Within your local vicinity",
    ring: 140,
    outer: 174,
    blur: 19,
    strength: 0.72,
    pulseSeconds: 3.35,
    layers: {
      pulseCount: 2,
      pulseMode: "pulse",
      pulseScale: 1.4,
      pulseAlpha: 0.26,
      haloAlpha: 0.6,
      sweepOpacity: 0.52,
      sweepSeconds: 7,
      ringWidth: 1.5
    }
  },
  "in-your-area": {
    level: "in-your-area",
    label: "In Your Area",
    description: "Same general part of town",
    ring: 134,
    outer: 164,
    blur: 13,
    strength: 0.5,
    pulseSeconds: 4.1,
    layers: {
      pulseCount: 2,
      pulseMode: "pulse",
      pulseScale: 1.34,
      pulseAlpha: 0.21,
      haloAlpha: 0.42,
      sweepOpacity: 0,
      sweepSeconds: null,
      ringWidth: 1.5
    }
  },
  "around-town": {
    level: "around-town",
    label: "Around Town",
    description: "Somewhere around the wider town",
    ring: 130,
    outer: 158,
    blur: 8,
    strength: 0.32,
    pulseSeconds: 5,
    layers: {
      pulseCount: 1,
      pulseMode: "pulse",
      pulseScale: 1.28,
      pulseAlpha: 0.15,
      haloAlpha: 0.32,
      sweepOpacity: 0,
      sweepSeconds: null,
      ringWidth: 1.25
    }
  },
  "across-town": {
    level: "across-town",
    label: "Across Town",
    description: "Within your broader city area",
    ring: 126,
    outer: 152,
    blur: 5,
    strength: 0.16,
    pulseSeconds: 6.2,
    layers: {
      pulseCount: 1,
      pulseMode: "breathe",
      pulseScale: 1.08,
      pulseAlpha: 0.1,
      haloAlpha: 0.18,
      sweepOpacity: 0,
      sweepSeconds: null,
      ringWidth: 1
    }
  }
};

export function proximityGlowLabel(level: ProximityGlowLevel): string {
  return PROXIMITY_GLOW_CONFIG[level].label;
}

export const PROXIMITY_GLOW_REFERENCE_AVATAR_PX = 104;

export type ProximityGlowSize = "sm" | "md" | "lg" | "hero";

export const PROXIMITY_GLOW_SIZES: Record<
  ProximityGlowSize,
  { avatarPx: number; blurFloor: number }
> = {
  sm: { avatarPx: 40, blurFloor: 3 },
  md: { avatarPx: 56, blurFloor: 3.5 },
  lg: { avatarPx: 76, blurFloor: 4 },
  hero: { avatarPx: 96, blurFloor: 5 }
};

export const AVATAR_SIZE_BY_GLOW_SIZE: Record<
  ProximityGlowSize,
  "sm" | "md" | "lg" | "xl"
> = {
  sm: "sm",
  md: "md",
  lg: "lg",
  hero: "xl"
};

export type ResolvedGlowGeometry = {
  ring: number;
  outer: number;
  blur: number;
  core: number;
  field: number;
  box: number;
  sparkRadius: number;
  avatar: number;
};

const PROTOTYPE_CORE_PX = 118;
const PROTOTYPE_FIELD_PX = 220;
/**
 * Retained in the resolved shape for dev/runtime harness compatibility. The
 * Magnetic Pulse renderer has no sparks and never reads this value.
 */
const LEGACY_SPARK_RADIUS_PX = 94;

export function resolveGlowGeometry(
  level: ProximityGlowLevel,
  size: ProximityGlowSize
): ResolvedGlowGeometry {
  const config = PROXIMITY_GLOW_CONFIG[level];
  const { avatarPx, blurFloor } = PROXIMITY_GLOW_SIZES[size];
  const scale = avatarPx / PROXIMITY_GLOW_REFERENCE_AVATAR_PX;

  const core = round(PROTOTYPE_CORE_PX * scale);
  const field = round(PROTOTYPE_FIELD_PX * scale);

  // Keep the production-tested "tightened" geometry: a state changes its aura,
  // never the avatar's layout box.
  const ring = round((config.ring * scale + core) / 2);
  const outer = round((config.outer * scale + config.ring * scale) / 2);

  const pulsePeak = ring * config.layers.pulseScale;

  return {
    ring,
    outer,
    blur: round(Math.max(config.blur * scale, blurFloor)),
    core,
    field,
    // Published for surfaces that intentionally reserve the full bloom. The
    // product component itself still occupies only `avatar` and overflows.
    box: roundUp(Math.max(field, pulsePeak, outer, core)),
    sparkRadius: round(LEGACY_SPARK_RADIUS_PX * scale),
    avatar: avatarPx
  };
}

export function referenceGeometry(level: ProximityGlowLevel): ResolvedGlowGeometry {
  const config = PROXIMITY_GLOW_CONFIG[level];
  const pulsePeak = config.ring * config.layers.pulseScale;

  return {
    ring: config.ring,
    outer: config.outer,
    blur: config.blur,
    core: PROTOTYPE_CORE_PX,
    field: PROTOTYPE_FIELD_PX,
    box: roundUp(Math.max(PROTOTYPE_FIELD_PX, pulsePeak, config.outer, PROTOTYPE_CORE_PX)),
    sparkRadius: LEGACY_SPARK_RADIUS_PX,
    avatar: PROXIMITY_GLOW_REFERENCE_AVATAR_PX
  };
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

function roundUp(value: number): number {
  return Math.ceil(value * 100) / 100;
}
