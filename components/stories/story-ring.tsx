"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function StoryRing({
  count,
  hasUnseen,
  children,
  className,
  ariaLabel
}: {
  count: number;
  hasUnseen: boolean;
  children: ReactNode;
  className?: string;
  ariaLabel?: string;
}) {
  const segments = Math.max(0, Math.min(5, Math.floor(count)));
  if (segments === 0) return <>{children}</>;

  const radius = 47;
  const circumference = 2 * Math.PI * radius;
  const gap = segments === 1 ? 0 : 5;
  const segmentLength = Math.max(1, circumference / segments - gap);

  return (
    <span
      className={cn(
        "relative inline-grid shrink-0 place-items-center rounded-full p-[4px]",
        hasUnseen ? "text-[#E88C2B]" : "text-muted-foreground/45",
        className
      )}
      aria-label={ariaLabel}
    >
      <svg
        viewBox="0 0 100 100"
        className="pointer-events-none absolute inset-0 h-full w-full -rotate-90"
        aria-hidden="true"
      >
        <circle
          cx="50"
          cy="50"
          r={radius}
          fill="none"
          stroke="currentColor"
          strokeWidth="4"
          strokeLinecap="round"
          strokeDasharray={segments === 1 ? undefined : `${segmentLength} ${gap}`}
        />
      </svg>
      <span className="relative z-[1] grid place-items-center rounded-full bg-background p-[2px]">
        {children}
      </span>
    </span>
  );
}
