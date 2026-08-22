import type { CSSProperties, ReactNode } from "react";
import { cn } from "@/lib/utils";
import {
  GLOW_SPARKS,
  PROXIMITY_GLOW_CONFIG,
  resolveGlowGeometry,
  type ProximityGlowLevel,
  type ProximityGlowSize
} from "@/lib/proximity/glow-config";
import { glowColorById } from "@/lib/glow/custom-colors";

/**
 * The canonical Proximity Glow.
 *
 * ONE COMPONENT, ONE SOURCE OF TRUTH. Every proximity surface renders this;
 * none of them holds its own ring sizes, blur radii or pulse timings. The
 * numbers come from lib/proximity/glow-config.ts, the structure from the
 * `.proximity-glow*` rules in app/globals.css, and this file is only the
 * bridge -- it maps one level and one size onto custom properties and data
 * attributes, then hands the layers to CSS.
 *
 * WHY LAYERS ARE CONDITIONAL RATHER THAN ALWAYS-RENDERED-AT-ZERO-OPACITY.
 * Two reasons, and both matter. Perceptually, the six states separate BECAUSE
 * layers disappear -- that is the design. Practically, a Muddies list can hold
 * dozens of avatars, and rendering a masked conic gradient plus nine
 * absolutely-positioned sparks for every one of them, invisible, would be a
 * real cost paid for nothing. Only the two closest states carry sparks; only
 * the closest carries the radial field.
 *
 * THE GLOW IS NEVER PART OF THE AVATAR. Everything here is runtime decoration
 * drawn around `children`. The same avatar renders identically with any level,
 * or with none.
 */

export type ProximityGlowProps = {
  /**
   * The proximity state to render. `null` means no proximity signal -- the
   * subject renders bare, with no Glow at all.
   *
   * Deliberately not defaulted to the weakest state: "we do not know where
   * this person is" and "this person is across town" are different claims, and
   * conflating them would put a Glow on every chat and group avatar in the app.
   */
  level: ProximityGlowLevel | null;
  size?: ProximityGlowSize;
  /**
   * Honour prefers-reduced-motion from the caller when it already knows.
   *
   * The stylesheet enforces reduced motion on its own via a media query, so
   * this is belt-and-braces for surfaces holding the preference in state --
   * never the only protection.
   */
  reducedMotion?: boolean;
  /** Optional custom-glow palette id (custom_glow_styles entitlement). */
  glowColorId?: string | null;
  /**
   * Presentation-only strength multiplier (1 = the approved value).
   *
   * Applied uniformly to the resolved strength, so the ordering between states
   * is preserved at any intensity: a surface may render the whole scale calmer
   * or bolder, but it can never make Across Town outshine Right Here.
   */
  intensity?: number;
  className?: string;
  /**
   * Accessible name for the whole Glow-plus-subject unit.
   *
   * Set here rather than on the avatar because the subject component owns its
   * own labelling and cannot take one; an explicit role="img" goes with it, so
   * the label is reliably exposed (a labelled generic <div> is not guaranteed
   * to reach every browser accessibility tree).
   */
  "aria-label"?: string;
  "aria-hidden"?: boolean;
  children: ReactNode;
};

export function ProximityGlow({
  level,
  size = "md",
  reducedMotion = false,
  glowColorId = null,
  intensity = 1,
  className,
  "aria-label": ariaLabel,
  "aria-hidden": ariaHidden,
  children
}: ProximityGlowProps) {
  // No signal: the subject alone. No wrapper geometry, no layers, no animation.
  if (!level) {
    return (
      <div
        className={cn("relative inline-grid place-items-center", className)}
        role={ariaLabel ? "img" : undefined}
        aria-label={ariaLabel}
        aria-hidden={ariaHidden}
      >
        {children}
      </div>
    );
  }

  const config = PROXIMITY_GLOW_CONFIG[level];
  const geometry = resolveGlowGeometry(level, size);
  const { layers } = config;

  // Clamped so a caller cannot push a state past full strength and flatten the
  // top of the scale, and cannot drive it negative.
  const strength = Math.min(1, Math.max(0, config.strength * Math.max(0, intensity)));

  // A custom colour recolours the Glow only. Geometry, layer count, pulse speed
  // and strength are untouched, so a purchased palette can never make someone
  // look closer than they are.
  // Both properties are set together: recolouring only the brand while the
  // highlight stayed orange would leave every custom palette with an orange
  // core inside a coloured halo.
  const custom = glowColorById(glowColorId);
  const colorStyle: Record<string, string> = custom
    ? { "--glow-brand": custom.rgb, "--glow-highlight": custom.rgb }
    : {};

  const style = {
    "--glow-ring": `${geometry.ring}px`,
    "--glow-outer": `${geometry.outer}px`,
    "--glow-core": `${geometry.core}px`,
    "--glow-field": `${geometry.field}px`,
    "--glow-blur": `${geometry.blur}px`,
    "--glow-strength": strength,
    "--glow-pulse": `${config.pulseSeconds}s`,
    "--glow-ring-width": `${layers.ringWidth}px`,
    "--glow-ring-style": layers.ringStyle,
    "--glow-ring2-opacity": layers.ring2Opacity,
    "--glow-spark-opacity": layers.sparkOpacity,
    // LAYOUT FOOTPRINT vs VISUAL FOOTPRINT. These are deliberately different.
    //
    // The bloom reaches `geometry.box` -- roughly 2.2x the avatar, the ratio
    // the prototype's generous empty stage assumed. Claiming that much LAYOUT
    // space breaks every real product row: on Home's Near strip (a 76px column
    // in a scroll container with 8px of vertical room) a 118px box pushed
    // neighbours apart, collided with the name beneath it, and was sliced flat
    // by the container's clip.
    //
    // So the element occupies exactly the avatar's box and the layers, which
    // are absolutely positioned and centred, simply overflow it. Overflow is
    // free: it costs no space, moves no sibling, and changes no row height.
    // `geometry.box` is still published for surfaces that WANT to reserve the
    // full bloom (the comparison harness does), via --glow-box.
    width: `${geometry.avatar}px`,
    height: `${geometry.avatar}px`,
    "--glow-box": `${geometry.box}px`,
    ...colorStyle
  } as CSSProperties;

  // Sparks orbit forward or in reverse depending on the state -- the reverse
  // drift is part of what makes Right Here read as more energetic than a
  // simply-faster version of Just Around.
  const sparkMotion = level === "right-here" ? "reverse" : "forward";

  return (
    <div
      className={cn("proximity-glow", `proximity-glow-${level}`, className)}
      data-level={level}
      data-size={size}
      data-animate={reducedMotion ? "false" : "true"}
      data-ring2={layers.ring2}
      data-ring-spin={layers.ringSpin ? "true" : "false"}
      data-core-bloom={layers.coreBloom}
      data-spark-motion={sparkMotion}
      role={ariaLabel ? "img" : undefined}
      aria-label={ariaLabel}
      aria-hidden={ariaHidden}
      style={style}
    >
      {layers.radial ? (
        <div className="proximity-glow__layer proximity-glow__radial" aria-hidden="true" />
      ) : null}

      {layers.sparkOpacity > 0 ? (
        <div className="proximity-glow__layer proximity-glow__sparks" aria-hidden="true">
          {GLOW_SPARKS.map((spark) => (
            <i
              key={spark.angle}
              style={
                {
                  "--spark-angle": `${spark.angle}deg`,
                  "--spark-radius": `${round(geometry.sparkRadius * spark.radiusRatio)}px`
                } as CSSProperties
              }
            />
          ))}
        </div>
      ) : null}

      {layers.orbit ? (
        <div className="proximity-glow__layer proximity-glow__orbit" aria-hidden="true" />
      ) : null}

      {layers.ring2 !== "none" ? (
        <div className="proximity-glow__layer proximity-glow__ring2" aria-hidden="true" />
      ) : null}

      <div className="proximity-glow__layer proximity-glow__ring" aria-hidden="true" />
      <div className="proximity-glow__layer proximity-glow__core" aria-hidden="true" />

      <div className="proximity-glow__subject">{children}</div>
    </div>
  );
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}
