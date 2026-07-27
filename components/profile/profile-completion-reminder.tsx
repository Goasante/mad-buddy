"use client";

import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { useCallback, useSyncExternalStore } from "react";

/**
 * The current profile-completion model has three optional items (photo, bio,
 * mood). The banner shows how many remain as a small circular progress ring.
 */
const TOTAL_PROFILE_STEPS = 3;

export function ProfileCompletionReminder({
  userId,
  missingItems
}: {
  userId: string;
  missingItems: string[];
}) {
  const storageKey = `mad-buddy:profile-reminder-dismissed:${userId}`;
  const subscribe = useCallback((onStoreChange: () => void) => {
    window.addEventListener("mad-buddy:profile-reminder-updated", onStoreChange);
    return () => window.removeEventListener("mad-buddy:profile-reminder-updated", onStoreChange);
  }, []);
  const getSnapshot = useCallback(() => sessionStorage.getItem(storageKey) !== "1", [storageKey]);
  const visible = useSyncExternalStore(subscribe, getSnapshot, () => false);

  if (!visible || missingItems.length === 0) return null;

  const remaining = Math.min(missingItems.length, TOTAL_PROFILE_STEPS);
  const done = TOTAL_PROFILE_STEPS - remaining;
  const summary =
    missingItems.length === 1
      ? `Add your ${missingItems[0]} to help friends recognise you.`
      : `Add a ${missingItems.slice(0, -1).join(", ")} and ${missingItems.at(-1)} to help friends recognise you.`;

  // Circular progress ring.
  const radius = 22;
  const circumference = 2 * Math.PI * radius;
  const dashOffset = circumference * (1 - done / TOTAL_PROFILE_STEPS);

  return (
    <Link
      href="/profile"
      aria-label={`Complete your profile, ${remaining} ${remaining === 1 ? "step" : "steps"} left`}
      className="focus-ring safe-motion flex items-center gap-4 rounded-2xl border border-primary/30 bg-primary/[0.06] p-4 transition hover:border-primary/50 hover:bg-primary/[0.09]"
    >
      <span className="relative grid h-14 w-14 shrink-0 place-items-center" aria-hidden="true">
        <svg viewBox="0 0 56 56" className="h-14 w-14 -rotate-90">
          <circle cx="28" cy="28" r={radius} fill="none" stroke="hsl(var(--primary) / 0.18)" strokeWidth="4" />
          <circle
            cx="28"
            cy="28"
            r={radius}
            fill="none"
            stroke="hsl(var(--primary))"
            strokeWidth="4"
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={dashOffset}
          />
        </svg>
        <span className="absolute inset-0 flex flex-col items-center justify-center leading-none">
          <span className="text-base font-bold">{remaining}</span>
          <span className="text-[9px] font-medium text-muted-foreground">{remaining === 1 ? "step" : "steps"}</span>
        </span>
      </span>

      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold">Complete your profile</span>
        <span className="mt-0.5 block text-xs leading-5 text-muted-foreground">{summary}</span>
      </span>

      <ChevronRight className="h-5 w-5 shrink-0 text-primary" aria-hidden="true" />
    </Link>
  );
}
