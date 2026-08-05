import { FEATURE_ICON_SOURCES, type FeatureIconKey } from "@/lib/icons/feature-icons";
import { cn } from "@/lib/utils";

/**
 * Renders a feature's icon from the central mapping. One shared component so
 * a feature's glyph is defined once, in lib/icons/feature-icons.ts.
 *
 * Backed by Lucide, so these now carry the same stroke weight and optical
 * sizing as every other icon in the app. They inherit currentColor like any
 * Lucide icon, so the surrounding surface still controls the colour.
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
  const Icon = meta.icon;

  return (
    <Icon
      width={size}
      height={size}
      // 1.75 matches the app-wide nav/chrome stroke weight.
      strokeWidth={1.75}
      className={cn("inline-block shrink-0 align-middle", active ? "opacity-100" : "opacity-90", className)}
      {...(decorative ? { "aria-hidden": true } : { role: "img", "aria-label": label ?? meta.label })}
    />
  );
}
