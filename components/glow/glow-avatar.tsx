import { cn } from "@/lib/utils";
import type { PublicMembershipTier } from "@/lib/billing/premium-identity";
import type { ConfidenceLevel, ProximityLevel } from "@/lib/proximity";
import { proximityLabels } from "@/lib/proximity";
import { GlowRing } from "@/components/glow/glow-ring";
import { UserAvatar } from "@/components/ui/user-avatar";

/**
 * RETIRED FOR MUDDY PROXIMITY. Use <ProximityGlowAvatar> instead.
 *
 * Muddy proximity now renders through components/glow/proximity-glow.tsx,
 * driven by the six-state band in lib/proximity/glow-config.ts. This component
 * survives for two remaining callers, neither of which is Muddy proximity:
 *
 *  - Surfaces reusing it purely as a plain avatar (no proximityLevel passed),
 *    where it is just UserAvatar with consistent borders.
 *  - Socialize discovery, which carries its own three-level `proximityTier`
 *    with its own filtering and ranking (lib/social/discovery-filters.ts).
 *    That is a different signal from the nearby-friends band, and converting
 *    it means changing Socialize's discovery logic rather than its styling.
 *
 * Do not add new proximity callers here. A second glow keyed to a different
 * scale is exactly what the V2 port removed.
 */
export type GlowAvatarProps = {
  src?: string | null;
  name: string;
  proximityLevel?: ProximityLevel;
  glowStrength?: number;
  confidence?: ConfidenceLevel;
  size?: "sm" | "md" | "near" | "lg" | "xl";
  reducedMotion?: boolean;
  className?: string;
  /** Optional custom-glow palette id (custom_glow_styles entitlement). */
  glowColorId?: string | null;
  /**
   * Effective membership tier, passed straight through to UserAvatar.
   *
   * The two signals stay independent by construction: proximity lives on the
   * GlowRing wrapper (a wide aura whose intensity tracks distance), membership
   * lives on the avatar itself (a thin, fixed band). Neither reads the other's
   * inputs, so a Pro ring can never brighten with closeness and a Close glow
   * can never imply membership.
   */
  membershipTier?: PublicMembershipTier;
  /** Presentation-only aura multiplier, passed through to GlowRing. */
  intensity?: number;
};

export function GlowAvatar({
  name,
  src,
  proximityLevel,
  glowStrength = 0,
  confidence = "low",
  size = "md",
  reducedMotion = false,
  className,
  glowColorId = null,
  membershipTier = "free",
  intensity = 1
}: GlowAvatarProps) {
  // Many non-proximity surfaces reuse GlowAvatar for consistent avatar
  // rendering. No supplied level means "no proximity signal", not Far. Far is
  // now a real 10–15km bucket with a subtle glow, while this neutral fallback
  // keeps ordinary chat/group/plan avatars full-colour and glow-free.
  const resolvedProximityLevel = proximityLevel ?? "hidden";

  return (
    <GlowRing
      proximityLevel={resolvedProximityLevel}
      confidence={confidence}
      glowStrength={glowStrength}
      reducedMotion={reducedMotion}
      glowColorId={glowColorId}
      intensity={intensity}
      className={cn(proximityLevel === "hidden" && "opacity-50 grayscale", className)}
      aria-label={proximityLevel ? `${name}, ${proximityLabels[proximityLevel].toLowerCase()}` : name}
    >
      <UserAvatar
        src={src}
        name={name}
        decorative
        size={size}
        membershipTier={membershipTier}
        className={cn(
          "relative z-[1] border-2 border-background shadow-[inset_0_0_0_1px_hsl(var(--border)),0_8px_24px_hsl(var(--shadow)/0.16)]"
        )}
      />
    </GlowRing>
  );
}
