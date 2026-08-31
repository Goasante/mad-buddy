import { cn } from "@/lib/utils";
import type { ProximityBand } from "@/lib/proximity/bands";
import {
  AVATAR_SIZE_BY_GLOW_SIZE,
  glowLevelForBand,
  proximityGlowLabel,
  type ProximityGlowLevel,
  type ProximityGlowSize
} from "@/lib/proximity/glow-config";
import { ProximityGlow } from "@/components/glow/proximity-glow";
import { UserAvatar } from "@/components/ui/user-avatar";

/**
 * An avatar wearing its Proximity Glow.
 *
 * The ordinary way a surface renders a Muddy. Callers pass the band the API
 * gave them; the level, geometry and label are derived here so no page maps
 * bands to CSS classes itself.
 *
 * Proximity is the only ring signal rendered here. Membership remains
 * available as text elsewhere and never changes avatar geometry.
 */

export type ProximityGlowAvatarProps = {
  src?: string | null;
  name: string;
  /**
   * The band from the nearby API, or null when there is no proximity signal.
   *
   * `outside_range` resolves to no Glow rather than to a faint one: someone
   * past the 15km gate is excluded from the response entirely, so a Glow for
   * them would be presentation inventing a state the data never claimed.
   */
  band?: ProximityBand | null;
  /** Escape hatch for surfaces that already hold a resolved level (harnesses). */
  level?: ProximityGlowLevel | null;
  size?: ProximityGlowSize;
  reducedMotion?: boolean;
  glowColorId?: string | null;
  intensity?: number;
  className?: string;
  /**
   * Suppress the accessible name when a parent already announces the person.
   *
   * Needed because several surfaces wrap this in a labelled row; two names for
   * one avatar is worse than none.
   */
  decorative?: boolean;
};

export function ProximityGlowAvatar({
  name,
  src,
  band = null,
  level,
  size = "md",
  reducedMotion = false,
  glowColorId = null,
  intensity = 1,
  className,
  decorative = false
}: ProximityGlowAvatarProps) {
  const resolvedLevel = level !== undefined ? level : glowLevelForBand(band);

  // The label names the STATE, never a distance -- "Saa, Close By", never
  // "Saa, 1.4 km away". The six state names are the entire user-facing
  // proximity vocabulary.
  const label = resolvedLevel ? `${name}, ${proximityGlowLabel(resolvedLevel)}` : name;

  return (
    <ProximityGlow
      level={resolvedLevel}
      size={size}
      reducedMotion={reducedMotion}
      glowColorId={glowColorId}
      intensity={intensity}
      className={className}
      aria-label={decorative ? undefined : label}
      aria-hidden={decorative || undefined}
    >
      {/* Always decorative: the accessible name lives on the Glow wrapper, so
          the avatar must not announce a second one for the same person. */}
      <UserAvatar
        src={src}
        name={name}
        decorative
        size={AVATAR_SIZE_BY_GLOW_SIZE[size]}
        className={cn(
          "border-2 border-background shadow-[inset_0_0_0_1px_hsl(var(--border)),0_8px_24px_hsl(var(--shadow)/0.16)]"
        )}
      />
    </ProximityGlow>
  );
}
