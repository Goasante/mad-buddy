"use client";

import Link from "next/link";
import { UserRound, X } from "lucide-react";
import { useCallback, useSyncExternalStore } from "react";

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

  const summary =
    missingItems.length === 1
      ? `Add your ${missingItems[0]} so friends can recognise you.`
      : `Add a ${missingItems.slice(0, -1).join(", ")} and ${missingItems.at(-1)} so friends can recognise you.`;

  return (
    <aside
      className="flex w-fit max-w-full items-start gap-3 rounded-xl bg-secondary/55 p-3"
      aria-label="Finish your profile"
    >
      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-background text-muted-foreground">
        <UserRound className="h-4 w-4" aria-hidden="true" />
      </span>
      <div className="min-w-0 max-w-sm">
        <p className="text-sm font-semibold">Finish your profile</p>
        <p className="mt-0.5 text-xs leading-5 text-muted-foreground">{summary}</p>
        <Link href="/profile" className="mt-1.5 inline-flex text-xs font-semibold text-primary hover:underline">
          Continue setup
        </Link>
      </div>
      <button
        type="button"
        className="focus-ring grid h-8 w-8 shrink-0 place-items-center rounded-full text-muted-foreground hover:bg-secondary hover:text-foreground"
        aria-label="Dismiss profile reminder"
        title="Dismiss"
        onClick={() => {
          sessionStorage.setItem(storageKey, "1");
          window.dispatchEvent(new Event("mad-buddy:profile-reminder-updated"));
        }}
      >
        <X className="h-4 w-4" aria-hidden="true" />
      </button>
    </aside>
  );
}
