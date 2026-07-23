import { cn } from "@/lib/utils";
import type { ConfidenceLevel, ProximityLevel } from "@/lib/proximity";
import { proximityLabels } from "@/lib/proximity";
import { GlowRing } from "@/components/glow/glow-ring";
import { UserAvatar } from "@/components/ui/user-avatar";

export type GlowAvatarProps = {
  src?: string | null;
  name: string;
  proximityLevel?: ProximityLevel;
  glowStrength?: number;
  confidence?: ConfidenceLevel;
  size?: "sm" | "md" | "lg" | "xl";
  reducedMotion?: boolean;
  className?: string;
  /** Optional custom-glow palette id (custom_glow_styles entitlement). */
  glowColorId?: string | null;
};

export function GlowAvatar({
  name,
  src,
  proximityLevel = "far",
  glowStrength = 0,
  confidence = "low",
  size = "md",
  reducedMotion = false,
  className,
  glowColorId = null
}: GlowAvatarProps) {
  return (
    <GlowRing
      proximityLevel={proximityLevel}
      confidence={confidence}
      glowStrength={glowStrength}
      reducedMotion={reducedMotion}
      glowColorId={glowColorId}
      className={cn(proximityLevel === "hidden" && "opacity-50 grayscale", className)}
      aria-label={`${name}, ${proximityLabels[proximityLevel].toLowerCase()}`}
    >
      <UserAvatar
        src={src}
        name={name}
        decorative
        size={size}
        className={cn(
          "relative z-[1] border-2 border-background shadow-[inset_0_0_0_1px_hsl(var(--border)),0_8px_24px_hsl(var(--shadow)/0.16)]"
        )}
      />
    </GlowRing>
  );
}
