"use client";

import { useState } from "react";
import { UserRound } from "lucide-react";
import { membershipTierLabel, type PublicMembershipTier } from "@/lib/billing/premium-identity";
import { cn } from "@/lib/utils";

export type UserAvatarSize = "xs" | "sm" | "md" | "near" | "lg" | "xl" | "profile";

/**
 * Ring band thickness per size. Larger avatars can carry a slightly heavier
 * band without it reading as a border; xs stays hairline so stacked avatars
 * do not turn into a wall of colour.
 */
const RING_PADDING: Record<UserAvatarSize, string> = {
  xs: "p-[1.5px]",
  sm: "p-[2px]",
  md: "p-[2.5px]",
  // Thin and elegant, per the canonical ring treatment — deliberately not
  // scaled up with the larger avatar.
  near: "p-[2.5px]",
  lg: "p-[3px]",
  xl: "p-[3px]",
  profile: "p-[4px]"
};

export function UserAvatar({
  src,
  name,
  size = "md",
  className,
  imageClassName,
  decorative = false,
  onImageError,
  membershipTier = "free"
}: {
  src?: string | null;
  name: string;
  size?: UserAvatarSize;
  className?: string;
  imageClassName?: string;
  decorative?: boolean;
  onImageError?: () => void;
  /**
   * Effective public membership tier. Screens pass a tier, never a colour —
   * ring colour, thickness, glow and animation are owned here so every
   * surface renders membership identically.
   *
   * Only pass a value a SERVER projection resolved. Leave it "free" when the
   * surface cannot safely resolve the real tier: a wrong ring is worse than
   * no ring, and a generic "premium" ring would misreport plus as pro.
   */
  membershipTier?: PublicMembershipTier;
}) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null);

  const avatar = (
    <span
      className={cn(
        "relative inline-grid shrink-0 place-items-center overflow-hidden rounded-full bg-secondary font-semibold text-foreground",
        sizeClasses[size],
        // Without a ring the caller's className lands here, as it always has.
        membershipTier === "free" && className
      )}
      aria-label={decorative ? undefined : `${name}'s profile photo`}
      role={decorative ? undefined : "img"}
    >
      <span aria-hidden="true">{initials(name)}</span>
      {src && failedSrc !== src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          key={src}
          src={src}
          alt=""
          className={cn("absolute inset-0 block h-full w-full rounded-[inherit] object-cover object-center", imageClassName)}
          draggable={false}
          loading={size === "profile" ? "eager" : "lazy"}
          decoding="async"
          onError={() => {
            setFailedSrc(src);
            onImageError?.();
          }}
        />
      ) : null}
      {!src && !name.trim() ? <UserRound className="h-2/5 w-2/5 text-muted-foreground" aria-hidden="true" /> : null}
    </span>
  );

  if (membershipTier === "free") return avatar;

  const tierLabel = membershipTierLabel(membershipTier);

  return (
    <span
      className={cn(
        "relative inline-grid shrink-0 place-items-center rounded-full",
        RING_PADDING[size],
        membershipTier === "pro" ? "avatar-ring-pro avatar-ring-pro-animated" : "avatar-ring-plus",
        className
      )}
    >
      {/* The inner avatar sits above the ::after shimmer layer. */}
      <span className="relative z-[1] inline-grid place-items-center rounded-full">{avatar}</span>
      {/* Membership is never colour-only: screen readers get it as text.
          Decorative avatars stay silent — they are already aria-hidden in
          context, and announcing a tier there would be noise. */}
      {!decorative && tierLabel ? <span className="sr-only">{tierLabel}</span> : null}
    </span>
  );
}

const sizeClasses: Record<UserAvatarSize, string> = {
  xs: "h-6 w-6 text-[9px]",
  sm: "h-10 w-10 text-xs",
  md: "h-14 w-14 text-sm",
  // Home's "Near" row. Sits between md (56px) and lg (76px): large enough to
  // keep the face the strongest element, small enough that five fit across a
  // 390px row with real breathing room between them.
  near: "h-16 w-16 text-base",
  lg: "h-[4.75rem] w-[4.75rem] text-lg",
  xl: "h-24 w-24 text-xl",
  profile: "h-36 w-36 text-3xl"
};

function initials(name: string) {
  return name.trim().split(/\s+/).slice(0, 2).map((part) => part[0]?.toUpperCase()).join("") || "MB";
}
