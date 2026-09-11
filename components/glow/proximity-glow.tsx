import type { CSSProperties, ReactNode } from "react";

import styles from "./proximity-glow.module.css";
import { cn } from "@/lib/utils";
import {
  PROXIMITY_GLOW_CONFIG,
  resolveGlowGeometry,
  type ProximityGlowLevel,
  type ProximityGlowSize
} from "@/lib/proximity/glow-config";
import { glowColorById } from "@/lib/glow/custom-colors";

/**
 * The canonical Magnetic Pulse renderer for Muddy proximity.
 *
 * The server owns proximity. This component receives only a privacy-safe state
 * and turns it into presentation. It cannot see coordinates or an exact
 * distance, and it never changes who is eligible to appear.
 *
 * PERFORMANCE. Each avatar renders one stationary halo, 1-3 simple pulse rings
 * and (only for the closest states) one rotating highlight. There are no spark
 * particles, dotted orbits, filters or JS animation loops. Motion is transform
 * + opacity only, and both the caller preference and CSS reduced-motion query
 * can stop it.
 */
export type ProximityGlowProps = {
  level: ProximityGlowLevel | null;
  size?: ProximityGlowSize;
  reducedMotion?: boolean;
  glowColorId?: string | null;
  /** Presentation-only multiplier. It never changes geometry or state. */
  intensity?: number;
  className?: string;
  "aria-label"?: string;
  "aria-hidden"?: boolean;
  children: ReactNode;
};

const PULSE_ALPHA_FACTORS = [1, 0.62, 0.34] as const;

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
  const strength = Math.min(1, Math.max(0, config.strength * Math.max(0, intensity)));

  // Custom Glow styles recolour the same Magnetic Pulse. They never change
  // ring count, speed or geometry, so cosmetics cannot make a Muddy look
  // closer than their resolved proximity band says they are.
  const custom = glowColorById(glowColorId);
  const brand = custom?.rgb ?? "232 140 43"; // Orange Grove #E88C2B
  const highlight = custom?.rgb ?? "255 224 142";
  const hasSweep = layers.sweepOpacity > 0 && layers.sweepSeconds !== null;

  const style = {
    "--glow-brand": brand,
    "--glow-highlight": highlight,
    "--glow-maroon": "78 4 1", // Deep Maroon #4E0401
    "--glow-paper": "254 251 243", // Warm Paper #FEFBF3
    "--glow-avatar": `${geometry.avatar}px`,
    "--glow-ring": `${geometry.ring}px`,
    "--glow-core": `${geometry.core}px`,
    "--glow-outer": `${geometry.outer}px`,
    "--glow-blur": `${geometry.blur}px`,
    "--glow-strength": strength,
    "--glow-pulse": `${config.pulseSeconds}s`,
    "--glow-pulse-scale": layers.pulseScale,
    "--glow-ring-width": `${layers.ringWidth}px`,
    "--glow-halo-alpha": clamp(layers.haloAlpha * strength),
    "--glow-halo-shadow": clamp(layers.haloAlpha * strength * 0.42),
    "--glow-sweep-opacity": clamp(layers.sweepOpacity * strength),
    "--glow-sweep": `${layers.sweepSeconds ?? 1}s`,
    // Layout footprint remains the avatar. The aura overflows without moving
    // siblings; --glow-box remains available to comparison/review harnesses.
    width: `${geometry.avatar}px`,
    height: `${geometry.avatar}px`,
    "--glow-box": `${geometry.box}px`
  } as CSSProperties;

  return (
    <div
      className={cn("proximity-glow", `proximity-glow-${level}`, styles.root, className)}
      data-level={level}
      data-size={size}
      data-animate={reducedMotion ? "false" : "true"}
      data-pulse-mode={layers.pulseMode}
      data-pulse-count={layers.pulseCount}
      data-has-sweep={hasSweep ? "true" : "false"}
      role={ariaLabel ? "img" : undefined}
      aria-label={ariaLabel}
      aria-hidden={ariaHidden}
      style={style}
    >
      <div className={cn(styles.layer, styles.halo)} aria-hidden="true" />

      {Array.from({ length: layers.pulseCount }, (_, index) => {
        const factor = PULSE_ALPHA_FACTORS[index] ?? PULSE_ALPHA_FACTORS.at(-1)!;
        const pulseStyle = {
          "--pulse-alpha": clamp(layers.pulseAlpha * strength * factor),
          "--pulse-shadow": clamp(layers.pulseAlpha * strength * factor * 0.62),
          // The reference uses thirds of the cycle to create a continuous
          // magnetic cadence. Keeping the offset deterministic also prevents
          // dozens of avatars from allocating random animation state.
          "--pulse-delay": `${round((config.pulseSeconds / 3) * index)}s`,
          "--pulse-rest-scale": 1.04 + index * 0.07
        } as CSSProperties;

        return (
          <div
            key={index}
            className={cn(styles.layer, styles.pulse)}
            data-pulse-ring={index + 1}
            aria-hidden="true"
            style={pulseStyle}
          />
        );
      })}

      {hasSweep ? (
        <div className={cn(styles.layer, styles.sweep)} aria-hidden="true" />
      ) : null}

      <div className={styles.subject}>{children}</div>
    </div>
  );
}

function clamp(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}
