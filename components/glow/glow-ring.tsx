import type { CSSProperties, HTMLAttributes } from "react";
import { cn } from "@/lib/utils";
import type { ConfidenceLevel, ProximityLevel } from "@/lib/proximity";
import { getGlowClass } from "@/lib/proximity";
import { glowColorById } from "@/lib/glow/custom-colors";

export type GlowRingProps = HTMLAttributes<HTMLDivElement> & {
  proximityLevel: ProximityLevel;
  confidence: ConfidenceLevel;
  glowStrength?: number;
  reducedMotion?: boolean;
  /** Optional custom-glow palette id (custom_glow_styles entitlement). */
  glowColorId?: string | null;
};

export function GlowRing({
  proximityLevel,
  confidence,
  glowStrength = 0,
  reducedMotion = false,
  glowColorId = null,
  className,
  children,
  ...props
}: GlowRingProps) {
  const normalizedStrength = Math.min(100, Math.max(0, glowStrength));
  const confidenceMultiplier = confidence === "low" ? 0.82 : confidence === "medium" ? 0.92 : 1;
  const strengthMultiplier = 0.88 + (normalizedStrength / 100) * 0.12;
  const isMuted = proximityLevel === "far" || proximityLevel === "hidden";
  const shouldPulse = !isMuted && !reducedMotion;
  const stateOpacity =
    proximityLevel === "very_close"
      ? 0.98
      : proximityLevel === "nearby"
        ? 0.76
        : proximityLevel === "around"
          ? 0.5
          : 0;
  const activeHaloOpacity = stateOpacity * confidenceMultiplier * strengthMultiplier;
  // The breathing animation cycles opacity between these rest/active values
  // every 2.2-3.4s. At the old 0.52/0.3 multipliers, the outer aura (the part
  // that actually reads as a soft glow beyond the solid ring) dropped to
  // near-invisible for roughly half of every cycle, so at rest all that was
  // left visible was the solid gradient ring itself with a hard edge and no
  // perceptible bloom around it. Raising the floor keeps the glow visibly
  // present through the whole cycle instead of only at its peak.
  // A custom colour only recolours the halo; it keeps the proximity class's
  // blur/spread/scale so the intensity still encodes how close the Muddy is.
  // Inline custom properties beat the ones the proximity class sets on the same
  // element, so --halo-color / --halo-ring here override the default palette
  // without touching the rest.
  const customColor = glowColorById(glowColorId);
  const colorStyle: Record<string, string> =
    customColor && !isMuted
      ? { "--halo-color": customColor.rgb, "--halo-ring": customColor.ring }
      : {};

  const glowStyle = {
    ...props.style,
    "--halo-active-opacity": activeHaloOpacity,
    "--halo-rest-opacity": activeHaloOpacity * 0.78,
    "--halo-aura-active-opacity": activeHaloOpacity * 0.72,
    "--halo-aura-rest-opacity": activeHaloOpacity * 0.55,
    ...colorStyle
  } as CSSProperties;

  return (
    <div
      // Explicit role so the aria-label spread from GlowAvatar is reliably
      // exposed by assistive tech (a labeled generic <div> is not guaranteed
      // to appear in every browser's accessibility tree).
      role="img"
      className={cn(
        "proximity-halo relative isolate inline-grid place-items-center rounded-full p-[3px]",
        getGlowClass(proximityLevel),
        shouldPulse && "proximity-halo-animate",
        className
      )}
      {...props}
      style={glowStyle}
    >
      {children}
    </div>
  );
}
