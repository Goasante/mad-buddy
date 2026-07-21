"use client";

import { useState } from "react";
import { FEATURE_ICON_SOURCES, type FeatureIconKey } from "@/lib/icons/feature-icons";
import { cn } from "@/lib/utils";

/**
 * Renders an owner-selected feature icon from the central mapping. One shared
 * component for every feature so assets are never imported ad hoc. The artwork
 * is centred in a consistent square box with object-contain (no stretch, no
 * crop), preserving each icon's aspect ratio. If an asset fails to load it
 * degrades to an empty box rather than a broken-image glyph.
 *
 * Accessibility: decorative by default (aria-hidden) for icons that sit beside
 * visible text. Pass `decorative={false}` with a `label` for icon-only use, and
 * still provide an aria-label on the interactive control that wraps it.
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
  /** Slightly lifts opacity for an inactive/active distinction without recolouring. */
  active?: boolean;
  decorative?: boolean;
  label?: string;
}) {
  const [failed, setFailed] = useState(false);
  const meta = FEATURE_ICON_SOURCES[feature];
  const alt = decorative ? "" : label ?? meta.label;

  return (
    <span
      className={cn("inline-grid shrink-0 place-items-center transition-opacity", active ? "opacity-100" : "opacity-95", className)}
      style={{ width: size, height: size }}
      {...(decorative ? { "aria-hidden": true } : { role: "img", "aria-label": alt })}
    >
      {failed ? null : (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={meta.src}
          alt={alt}
          width={size}
          height={size}
          loading="lazy"
          decoding="async"
          draggable={false}
          onError={() => setFailed(true)}
          className="h-full w-full object-contain"
          aria-hidden={decorative ? true : undefined}
        />
      )}
    </span>
  );
}
