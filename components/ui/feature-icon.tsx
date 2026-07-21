import type { CSSProperties } from "react";
import { FEATURE_ICON_SOURCES, type FeatureIconKey } from "@/lib/icons/feature-icons";
import { cn } from "@/lib/utils";

/**
 * Renders an owner-selected feature icon from the central mapping. One shared
 * component for every feature so assets are never imported ad hoc.
 *
 * The Flaticon assets are solid monochrome glyphs on a transparent background,
 * so they are drawn as a CSS mask filled with `currentColor`. That makes them
 * theme-aware and legible on both light and dark surfaces, and lets them adopt
 * the same active colour (e.g. primary) the surrounding lucide chrome uses —
 * exactly like a currentColor icon. The glyph is centred in a square box with
 * mask-size: contain, so aspect ratio is preserved with no stretch or crop.
 */
export function FeatureIcon({
  feature,
  size = 24,
  className,
  active = false,
  decorative = true,
  label
}: {
  feature: FeatureIconKey;
  /** Visible box size in px. Nav 20-22, compact 20-24, cards 24-28, empty state 36-44. */
  size?: number;
  className?: string;
  /** Full opacity when active; a touch softer when inactive. Colour itself comes from currentColor. */
  active?: boolean;
  decorative?: boolean;
  label?: string;
}) {
  const meta = FEATURE_ICON_SOURCES[feature];
  const maskUrl = `url("${meta.src}")`;
  const style: CSSProperties = {
    width: size,
    height: size,
    backgroundColor: "currentColor",
    WebkitMaskImage: maskUrl,
    maskImage: maskUrl,
    WebkitMaskRepeat: "no-repeat",
    maskRepeat: "no-repeat",
    WebkitMaskPosition: "center",
    maskPosition: "center",
    WebkitMaskSize: "contain",
    maskSize: "contain"
  };

  return (
    <span
      className={cn("inline-block shrink-0 align-middle", active ? "opacity-100" : "opacity-90", className)}
      style={style}
      {...(decorative ? { "aria-hidden": true } : { role: "img", "aria-label": label ?? meta.label })}
    />
  );
}
