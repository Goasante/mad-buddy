import { cn } from "@/lib/utils";
import type { ConfidenceLevel, ProximityLevel } from "@/lib/proximity";
import { proximityLabels } from "@/lib/proximity";
import { GlowRing } from "@/components/glow/glow-ring";

export type GlowAvatarProps = {
  src?: string | null;
  name: string;
  proximityLevel?: ProximityLevel;
  glowStrength?: number;
  confidence?: ConfidenceLevel;
  size?: "sm" | "md" | "lg" | "xl";
  reducedMotion?: boolean;
  className?: string;
};

export function GlowAvatar({
  name,
  src,
  proximityLevel = "far",
  glowStrength = 0,
  confidence = "low",
  size = "md",
  reducedMotion = false,
  className
}: GlowAvatarProps) {
  return (
    <GlowRing
      proximityLevel={proximityLevel}
      confidence={confidence}
      glowStrength={glowStrength}
      reducedMotion={reducedMotion}
      className={cn(proximityLevel === "hidden" && "opacity-50 grayscale", className)}
      aria-label={`${name}, ${proximityLabels[proximityLevel].toLowerCase()}`}
    >
      <div
        className={cn(
          "relative z-[1] flex items-center justify-center overflow-hidden rounded-full border-2 border-background bg-secondary font-semibold text-foreground shadow-[inset_0_0_0_1px_hsl(var(--border)),0_8px_24px_hsl(var(--shadow)/0.16)]",
          sizeClasses[size]
        )}
      >
        {src ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={src}
            alt=""
            className="h-full w-full object-cover"
          />
        ) : (
          <span aria-hidden="true">{getInitials(name)}</span>
        )}
      </div>
    </GlowRing>
  );
}

const sizeClasses = {
  sm: "h-10 w-10 text-xs",
  md: "h-14 w-14 text-sm",
  lg: "h-[4.75rem] w-[4.75rem] text-lg",
  xl: "h-24 w-24 text-xl"
} as const;

function getInitials(name: string) {
  const initials = name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");

  return initials || "MB";
}
