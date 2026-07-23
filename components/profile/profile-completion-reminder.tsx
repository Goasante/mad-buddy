"use client";

import Link from "next/link";
import { Sparkles, X } from "lucide-react";
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
    <aside className="flex items-start gap-3 rounded-xl border border-primary/20 bg-primary/[0.06] p-3.5" aria-label="Finish your profile">
      <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-full bg-primary/12 text-primary">
        <Sparkles className="h-4 w-4" aria-hidden="true" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold">Finish your profile</p>
        <p className="mt-0.5 text-xs leading-5 text-muted-foreground">{summary}</p>
        <Link href="/profile" className="mt-2 inline-flex text-xs font-semibold text-primary hover:underline">
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
