/**
 * The canonical Proximity Glow configuration.
 *
 * ONE STATE AUTHORITY. Every surface that renders a Glow reads its geometry,
 * intensity and animation character from this table -- never from a literal in
 * a card, a page or a stylesheet. A second copy of "154px" somewhere is how two
 * surfaces start disagreeing about what "Right here" looks like.
 *
 * PORTED, NOT REINTERPRETED. The numbers below are lifted directly from the
 * approved executable prototype at
 * `design-reference/proximity-glow-v1.html`. The prototype is
 * the behavioural and visual specification; where a value here differs from it,
 * the prototype is right and this file is a bug.
 *
 * NOTHING HERE TOUCHES AUTHORIZATION OR PRIVACY. These are presentation values
 * keyed by a band identifier the server already resolved (see
 * lib/proximity/bands.ts). No distance, coordinate or accuracy reaches this
 * module, and no value here can widen who appears in a response.
 */

import type { ProximityBand } from "@/lib/proximity/bands";

/**
 * The six user-facing Glow states.
 *
 * Kebab-case because these become CSS class suffixes
 * (`.proximity-glow-right-here`), distinct from the snake_case `ProximityBand`
 * identifiers the API speaks. The two vocabularies are bridged in exactly one
 * place: GLOW_LEVEL_BY_BAND below.
 */
export type ProximityGlowLevel =
  | "right-here"
  | "just-around"
  | "close-by"
  | "in-your-area"
  | "around-town"
  | "across-town";

/** Ordered closest-first. Used for comparison harnesses and stability ranking. */
export const PROXIMITY_GLOW_LEVELS: readonly ProximityGlowLevel[] = [
  "right-here",
  "just-around",
  "close-by",
  "in-your-area",
  "around-town",
  "across-town"
] as const;

/**
 * The API band to Glow level bridge.
 *
 * `outside_range` has no Glow: someone beyond the 15km gate is dropped from the
 * response entirely before any presentation decision is made, so it maps to
 * null rather than to a seventh, fainter state.
 */
const GLOW_LEVEL_BY_BAND: Record<ProximityBand, ProximityGlowLevel | null> = {
  right_here: "right-here",
  around_you: "just-around",
  close_by: "close-by",
  nearby: "in-your-area",
  around_town: "around-town",
  further_away: "across-town",
  outside_range: null
};

/** The Glow a band renders, or null when there is nothing to render. */
export function glowLevelForBand(
  band: ProximityBand | null | undefined
): ProximityGlowLevel | null {
  if (!band) return null;
  return GLOW_LEVEL_BY_BAND[band] ?? null;
}

/**
 * Which optional layers a state draws.
 *
 * SELECTIVE REMOVAL IS THE DESIGN. The perceptual gap between Right Here and
 * Across Town comes from layers disappearing, not from a slightly thinner
 * border. A state that drew every layer at reduced opacity would collapse the
 * six back into one.
 */
export type GlowLayers = {
  /** Rotating conic radial field. Right Here only -- the most energetic layer. */
  radial: boolean;
  /** Orbiting spark particles, and how strongly they read (0 = absent). */
  sparkOpacity: number;
  /** Dashed counter-rotating outer orbit. Broad-area treatment. */
  orbit: boolean;
  /** Behaviour of the second halo ring. */
  ring2: "expanding" | "soft-pulse" | "static" | "none";
  /** Static opacity of ring2 when its mode is "static". */
  ring2Opacity: number;
  /** Border treatment of the primary ring. */
  ringStyle: "solid" | "dashed" | "dotted";
  /** Primary ring border width in px. */
  ringWidth: number;
  /** Whether the primary ring slowly rotates (only meaningful when dashed). */
  ringSpin: boolean;
  /** Whether the core keeps its full bloom, or drops to a faint remnant. */
  coreBloom: "full" | "faint";
};

export type ProximityGlowConfig = {
  level: ProximityGlowLevel;
  /** User-facing copy. Title Case, as approved. */
  label: string;
  /** Short supporting line. Never a distance. */
  description: string;
  /** Primary ring diameter at the reference size, in px. */
  ring: number;
  /** Outer halo diameter at the reference size, in px. */
  outer: number;
  /** Core bloom blur radius at the reference size, in px. */
  blur: number;
  /** Overall luminous strength, 0-1. Drives every layer opacity uniformly. */
  strength: number;
  /** Core breathing period. */
  pulseSeconds: number;
  layers: GlowLayers;
};

/**
 * The table. Values are the prototype values, verbatim.
 *
 * `ring`, `outer` and `blur` are expressed at the prototype reference scale
 * (a 104px avatar inside a 210px stage). Size variants scale them
 * proportionally -- see PROXIMITY_GLOW_SIZES -- so the ratios that carry the
 * hierarchy survive at every size.
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
    pulseSeconds: 1.15,
    layers: {
      radial: true,
      sparkOpacity: 1,
      orbit: false,
      ring2: "expanding",
      ring2Opacity: 0.65,
      ringStyle: "solid",
      ringWidth: 2,
      ringSpin: false,
      coreBloom: "full"
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
    pulseSeconds: 1.75,
    layers: {
      radial: false,
      sparkOpacity: 0.58,
      orbit: false,
      ring2: "soft-pulse",
      ring2Opacity: 0.65,
      ringStyle: "solid",
      ringWidth: 1.5,
      ringSpin: false,
      coreBloom: "full"
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
    pulseSeconds: 2.7,
    layers: {
      radial: false,
      sparkOpacity: 0.16,
      orbit: false,
      ring2: "static",
      ring2Opacity: 0.32,
      ringStyle: "solid",
      ringWidth: 1.5,
      ringSpin: false,
      coreBloom: "full"
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
    pulseSeconds: 4,
    layers: {
      radial: false,
      sparkOpacity: 0,
      orbit: false,
      ring2: "static",
      ring2Opacity: 0.18,
      ringStyle: "solid",
      ringWidth: 1,
      ringSpin: false,
      coreBloom: "full"
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
      radial: false,
      sparkOpacity: 0,
      orbit: true,
      ring2: "static",
      ring2Opacity: 0.08,
      ringStyle: "dashed",
      ringWidth: 1.5,
      ringSpin: true,
      coreBloom: "full"
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
    pulseSeconds: 6,
    layers: {
      radial: false,
      sparkOpacity: 0,
      orbit: false,
      ring2: "none",
      ring2Opacity: 0,
      ringStyle: "dotted",
      ringWidth: 1.5,
      ringSpin: false,
      coreBloom: "faint"
    }
  }
};

/** User-facing label for a Glow state. */
export function proximityGlowLabel(level: ProximityGlowLevel): string {
  return PROXIMITY_GLOW_CONFIG[level].label;
}

/**
 * Size variants.
 *
 * The prototype demonstrates one large size. Production adapts by scaling the
 * whole geometry proportionally against the prototype 104px reference avatar,
 * which preserves every ratio -- and therefore every perceptual difference --
 * rather than re-tuning six states per size.
 *
 * `blurFloor` exists because blur does not scale linearly with perception: at
 * `sm`, a strictly proportional 5px blur for Across Town would round away to
 * nothing and the state would become indistinguishable from no Glow at all.
 * The floor keeps the weakest state faintly present without lifting it toward
 * the strongest.
 */
export const PROXIMITY_GLOW_REFERENCE_AVATAR_PX = 104;

export type ProximityGlowSize = "sm" | "md" | "lg" | "hero";

/**
 * Avatar diameters mirror the ones components/ui/user-avatar.tsx actually
 * renders (sm h-10 = 40px, md h-14 = 56px, lg h-[4.75rem] = 76px, profile
 * h-26 = 104px). Scaling against a number the avatar does not use would put
 * the ring slightly inside or outside the portrait at every size.
 *
 * `hero` is 96px (xl) rather than the prototype's 104px because 104 is not a
 * size UserAvatar renders, and inventing one so a table would look tidier
 * would put the ring at a diameter no real avatar sits inside. The prototype's
 * exact reference geometry is still reachable for comparison via
 * `referenceGeometry()` below.
 */
export const PROXIMITY_GLOW_SIZES: Record<
  ProximityGlowSize,
  { avatarPx: number; blurFloor: number }
> = {
  sm: { avatarPx: 40, blurFloor: 3 },
  md: { avatarPx: 56, blurFloor: 3.5 },
  lg: { avatarPx: 76, blurFloor: 4 },
  hero: { avatarPx: 96, blurFloor: 5 }
};

/** The UserAvatar size each Glow size renders its subject at. */
export const AVATAR_SIZE_BY_GLOW_SIZE: Record<ProximityGlowSize, "sm" | "md" | "lg" | "xl"> = {
  sm: "sm",
  md: "md",
  lg: "lg",
  hero: "xl"
};

/** Geometry for one state at one size, in px. */
export type ResolvedGlowGeometry = {
  ring: number;
  outer: number;
  blur: number;
  /** Core diameter -- the prototype 118px core against its 104px avatar. */
  core: number;
  /** Field diameter used by the radial and spark layers (prototype: 220px). */
  field: number;
  /**
   * The box the whole Glow must occupy, in px.
   *
   * NOT the same as `field`. Two layers animate OUTWARD past their own
   * diameter -- the expanding wave scales ring2 to 1.13, and the core breathes
   * to 1.08 -- so a box sized to the static field would clip the very state
   * that is supposed to be the most dramatic. Right Here is the case that
   * proves it: its 205px ring2 peaks near 232px, past the 220px field.
   *
   * Sized to whichever layer reaches furthest at its animation peak, so
   * nothing is ever cropped by the surface the Glow sits in.
   */
  box: number;
  /** Spark orbit radius (prototype sparks sit ~94px out). */
  sparkRadius: number;
  /**
   * The avatar's own diameter -- and the Glow's LAYOUT footprint.
   *
   * Deliberately not `box`. The bloom overflows this without occupying space,
   * so a Glow never pushes a neighbour, never changes a row's height, and never
   * outgrows a scroll container's padding. See the comment in
   * components/glow/proximity-glow.tsx where the two are applied.
   */
  avatar: number;
};

const PROTOTYPE_CORE_PX = 118;
const PROTOTYPE_FIELD_PX = 220;
const PROTOTYPE_SPARK_RADIUS_PX = 94;

/** Peak scale of each outward-animating layer, from the prototype keyframes. */
const EXPANDING_PEAK_SCALE = 1.13;
const SOFT_PULSE_PEAK_SCALE = 1.04;
const CORE_BREATHE_PEAK_SCALE = 1.08;

export function resolveGlowGeometry(
  level: ProximityGlowLevel,
  size: ProximityGlowSize
): ResolvedGlowGeometry {
  const config = PROXIMITY_GLOW_CONFIG[level];
  const { avatarPx, blurFloor } = PROXIMITY_GLOW_SIZES[size];
  const scale = avatarPx / PROXIMITY_GLOW_REFERENCE_AVATAR_PX;

  // Rounded FIRST, then used for the box calculation below. The rounded values
  // are what the browser actually lays out, so sizing the box against the
  // unrounded ones can leave it a fraction of a pixel short of the layer it is
  // supposed to contain.
  const core = round(PROTOTYPE_CORE_PX * scale);
  const field = round(PROTOTYPE_FIELD_PX * scale);

  /**
   * THE GLOW STARTS AT THE AVATAR, not a ring's distance away.
   *
   * The raw prototype offsets leave a visible gap: the core draws a bright
   * edge just off the photo, the ring sits well outside it, and between them
   * the soft halo has already fallen off far enough to read as a transparent
   * void -- photo, thin bright circle, empty band, then a detached ring.
   *
   * Each ring is drawn at the midpoint of its own distance past the layer
   * inside it. The spread that separates the six states is COMPRESSED, not
   * removed: every state keeps half of its own offset, so the ordering that
   * carries proximity survives intact.
   *
   * This lives here, in the canonical geometry, because it is a property of
   * the Glow rather than of any one screen. It was previously a `.near-strip`
   * stylesheet override, which meant Home rendered a materially different ring
   * (99.38px vs 112.53px at lg/right-here) for the SAME proximity state every
   * other surface drew canonically. One state must look like one state
   * everywhere; a surface that needs more room changes its own slot, never
   * these numbers.
   */
  const ring = round((config.ring * scale + core) / 2);
  const outer = round((config.outer * scale + config.ring * scale) / 2);

  // How far ring2 actually travels, which depends on which animation it runs.
  const ring2Peak =
    config.layers.ring2 === "expanding"
      ? outer * EXPANDING_PEAK_SCALE
      : config.layers.ring2 === "soft-pulse"
        ? outer * SOFT_PULSE_PEAK_SCALE
        : outer;

  return {
    ring,
    outer,
    // Floored, never capped: a smaller size may not erase the weakest state,
    // but it must not brighten it past its scaled value either.
    blur: round(Math.max(config.blur * scale, blurFloor)),
    core,
    field,
    // The widest thing this state ever draws, at its animation peak. The
    // static field is included because the radial/spark layers use it, and the
    // ring because a dashed ring can be the outermost layer once ring2 is off.
    //
    // Rounded UP, never to nearest: rounding down by even a hundredth of a
    // pixel reintroduces the clipping this exists to prevent.
    box: roundUp(Math.max(field, ring2Peak, ring, core * CORE_BREATHE_PEAK_SCALE)),
    sparkRadius: round(PROTOTYPE_SPARK_RADIUS_PX * scale),
    avatar: avatarPx
  };
}

/**
 * The prototype's own geometry, unscaled.
 *
 * Exists so the comparison harness can put the production renderer beside the
 * reference at 1:1 and have the numbers be literally the approved ones, rather
 * than asking a reviewer to judge whether a scaled-down approximation "looks
 * about right". Not used by any product surface.
 */
export function referenceGeometry(level: ProximityGlowLevel): ResolvedGlowGeometry {
  const config = PROXIMITY_GLOW_CONFIG[level];
  const ring2Peak =
    config.layers.ring2 === "expanding"
      ? config.outer * EXPANDING_PEAK_SCALE
      : config.layers.ring2 === "soft-pulse"
        ? config.outer * SOFT_PULSE_PEAK_SCALE
        : config.outer;

  return {
    ring: config.ring,
    outer: config.outer,
    blur: config.blur,
    core: PROTOTYPE_CORE_PX,
    field: PROTOTYPE_FIELD_PX,
    box: roundUp(
      Math.max(PROTOTYPE_FIELD_PX, ring2Peak, config.ring, PROTOTYPE_CORE_PX * CORE_BREATHE_PEAK_SCALE)
    ),
    sparkRadius: PROTOTYPE_SPARK_RADIUS_PX,
    avatar: PROXIMITY_GLOW_REFERENCE_AVATAR_PX
  };
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

/** Round away from zero, for values that must never come out short. */
function roundUp(value: number): number {
  return Math.ceil(value * 100) / 100;
}

/**
 * Spark placement, ported from the prototype nine hand-placed particles.
 *
 * Fixed, not random: a random count per avatar would make two people at the
 * same distance look different, and an uncontrolled count would be a
 * performance hazard on a list of many Muddies.
 */
export const GLOW_SPARKS: ReadonlyArray<{ angle: number; radiusRatio: number }> = [
  { angle: 0, radiusRatio: 1 },
  { angle: 40, radiusRatio: 1.053 },
  { angle: 80, radiusRatio: 0.957 },
  { angle: 120, radiusRatio: 1.074 },
  { angle: 160, radiusRatio: 0.979 },
  { angle: 200, radiusRatio: 1.043 },
  { angle: 240, radiusRatio: 0.968 },
  { angle: 280, radiusRatio: 1.085 },
  { angle: 320, radiusRatio: 1.011 }
] as const;
