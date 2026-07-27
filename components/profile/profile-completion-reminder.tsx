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
  // Terse, so the quiet single-line banner never truncates awkwardly.
  const summary =
    missingItems.length === 1
      ? `Add your ${missingItems[0]}`
      : `Add your ${missingItems.slice(0, -1).join(", ")} and ${missingItems.at(-1)}`;

  // Small circular progress ring — quiet, secondary guidance.
  const radius = 15;
  const circumference = 2 * Math.PI * radius;
  const dashOffset = circumference * (1 - done / TOTAL_PROFILE_STEPS);

  return (
    <Link
      href="/profile"
      aria-label={`Complete your profile, ${remaining} ${remaining === 1 ? "step" : "steps"} left`}
      className="focus-ring safe-motion flex items-center gap-3 rounded-xl border border-border/70 bg-card/50 px-3 py-2.5 transition hover:bg-secondary/40 dark:bg-white/[0.035]"
    >
      <span className="relative grid h-10 w-10 shrink-0 place-items-center" aria-hidden="true">
        <svg viewBox="0 0 40 40" className="h-10 w-10 -rotate-90">
          <circle cx="20" cy="20" r={radius} fill="none" stroke="hsl(var(--primary) / 0.16)" strokeWidth="3" />
          <circle
            cx="20"
            cy="20"
            r={radius}
            fill="none"
            stroke="hsl(var(--primary))"
            strokeWidth="3"
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={dashOffset}
          />
        </svg>
        <span className="absolute inset-0 flex items-center justify-center text-[11px] font-bold leading-none">
          {remaining}
        </span>
      </span>

      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium">Complete your profile</span>
        <span className="mt-0.5 block truncate text-xs text-muted-foreground">{summary}</span>
      </span>

      <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
    </Link>
  );
}
