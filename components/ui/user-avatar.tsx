"use client";

import { useState } from "react";
import { UserRound } from "lucide-react";
import { cn } from "@/lib/utils";

export type UserAvatarSize = "xs" | "sm" | "md" | "lg" | "xl" | "profile";

export function UserAvatar({
  src,
  name,
  size = "md",
  className,
  imageClassName,
  decorative = false,
  onImageError
}: {
  src?: string | null;
  name: string;
  size?: UserAvatarSize;
  className?: string;
  imageClassName?: string;
  decorative?: boolean;
  onImageError?: () => void;
}) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null);

  return (
    <span
      className={cn(
        "relative inline-grid shrink-0 place-items-center overflow-hidden rounded-full bg-secondary font-semibold text-foreground",
        sizeClasses[size],
        className
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
}

const sizeClasses: Record<UserAvatarSize, string> = {
  xs: "h-6 w-6 text-[9px]",
  sm: "h-10 w-10 text-xs",
  md: "h-14 w-14 text-sm",
  lg: "h-[4.75rem] w-[4.75rem] text-lg",
  xl: "h-24 w-24 text-xl",
  profile: "h-36 w-36 text-3xl"
};

function initials(name: string) {
  return name.trim().split(/\s+/).slice(0, 2).map((part) => part[0]?.toUpperCase()).join("") || "MB";
}
