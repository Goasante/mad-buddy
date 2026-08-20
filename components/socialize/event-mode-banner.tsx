"use client";

import type { Route } from "next";
import { useRouter } from "next/navigation";
import { Users, X } from "lucide-react";

/**
 * Linkr Event Mode context banner (Stage F UI, Part C).
 *
 * Subtle by design (§19): Linkr opened differently, and the person should be
 * able to see why in one glance without it feeling like a separate app. It is
 * a strip above the ordinary Linkr surface, not a reskin of it.
 *
 * Dismissing leaves Event Mode by navigating to plain /discover. There is no
 * stored state to clear, because Event Mode was never stored -- it lives in
 * the URL for one visit, so leaving the URL leaves the mode (§21).
 */
export function EventModeBanner({ eventName }: { eventName: string | null }) {
  const router = useRouter();

  return (
    <div className="flex items-center gap-2.5 rounded-2xl border border-primary/40 bg-primary/5 px-3 py-2.5">
      <Users className="h-4 w-4 shrink-0 text-[var(--color-brand-orange)]" aria-hidden="true" />
      {/* THE EVENT IS THE CONTEXT, NOT THE PROXIMITY.
       *
       * This said "Finding people close by", which describes ordinary Linkr --
       * so opening Event Mode from AfroFuture Night looked identical to
       * browsing whoever happens to be around. Sharing the event is the reason
       * these people are shown; how close they are is secondary context on the
       * cards themselves. */}
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold leading-tight">
          {eventName ?? "This event"}
        </p>
        <p className="text-xs text-muted-foreground">
          Meet people here &middot; open to connecting
        </p>
      </div>
      <button
        type="button"
        onClick={() => router.replace("/discover" as Route)}
        aria-label="Leave event mode"
        className="focus-ring -mr-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-muted-foreground"
      >
        <X className="h-4 w-4" aria-hidden="true" />
      </button>
    </div>
  );
}
