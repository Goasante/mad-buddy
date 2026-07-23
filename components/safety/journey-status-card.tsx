"use client";

import { ShieldCheck } from "lucide-react";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { UserAvatar } from "@/components/ui/user-avatar";
import { useReducedMotion } from "@/hooks/use-reduced-motion";
import { resolveJourneyState, watcherSummary, type JourneyTiming } from "@/lib/safety/journey-status";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import type { SafeArrivalStatus } from "@/lib/supabase/database.types";
import { cn } from "@/lib/utils";

export type JourneyWatcher = { id: string; name: string; avatarUrl: string | null };

/**
 * The live Safe Arrival journey animation, shared by the traveller and by an
 * approved watcher. It renders ONLY status — an animated Safe Arrival mark, a
 * status word, and (for the traveller) who is watching. No geography.
 *
 * Realtime reuses the app's postgres_changes pattern: it subscribes to this one
 * session (and, for the traveller, its contacts) and re-fetches canonical state
 * via router.refresh() on any change, so a spoofed event payload is never
 * trusted. RLS restricts the stream to the traveller and approved contacts, so
 * a blocked or unauthorised user receives nothing.
 */
export function JourneyStatusCard({
  role,
  sessionId,
  status,
  timing,
  travellerName,
  watchers = [],
  sharedCount = 0,
  startedAtLabel,
  children
}: {
  role: "traveller" | "watcher";
  sessionId: string;
  status: SafeArrivalStatus;
  timing?: JourneyTiming;
  travellerName: string;
  watchers?: JourneyWatcher[];
  sharedCount?: number;
  startedAtLabel?: string;
  children?: React.ReactNode;
}) {
  const router = useRouter();
  const reducedMotion = useReducedMotion();
  const journey = resolveJourneyState(status, timing);

  useEffect(() => {
    if (!journey.isLive) return; // Terminal session: nothing left to stream.

    let supabase: ReturnType<typeof createSupabaseBrowserClient>;
    try {
      supabase = createSupabaseBrowserClient();
    } catch {
      return; // No realtime available: the page still shows canonical state.
    }

    let refreshQueued = false;
    const refresh = () => {
      // Coalesce a burst of events into one canonical refetch.
      if (refreshQueued) return;
      refreshQueued = true;
      window.setTimeout(() => {
        refreshQueued = false;
        router.refresh();
      }, 250);
    };

    const channel = supabase.channel(`safe-arrival:${sessionId}`);
    channel.on(
      "postgres_changes",
      { event: "UPDATE", schema: "public", table: "safe_arrival_sessions", filter: `id=eq.${sessionId}` },
      refresh
    );
    // Only the traveller cares about watcher-acceptance changes.
    if (role === "traveller") {
      channel.on(
        "postgres_changes",
        { event: "*", schema: "public", table: "safe_arrival_contacts", filter: `session_id=eq.${sessionId}` },
        refresh
      );
    }
    channel.subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [journey.isLive, role, sessionId, router]);

  const motionClass =
    reducedMotion || journey.motion === "none"
      ? ""
      : journey.motion === "active"
        ? "journey-mark-active"
        : journey.motion === "waiting"
          ? "journey-mark-waiting"
          : "journey-mark-arrived";

  return (
    <div className="rounded-2xl border border-border/70 bg-card/60 p-4 sm:p-5">
      {/* aria-live so a screen reader hears meaningful changes (arrived, ended)
          but not every animation frame. */}
      <p className="sr-only" role="status" aria-live="polite">
        {role === "watcher" ? `${travellerName}: ${journey.status}` : journey.status}
      </p>

      <div className="flex items-center gap-4">
        <span
          className={cn(
            "journey-mark relative grid h-14 w-14 shrink-0 place-items-center rounded-full",
            `journey-mark-${journey.key}`,
            motionClass
          )}
          aria-hidden="true"
        >
          <ShieldCheck className="h-6 w-6" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">
            {role === "watcher" ? `${travellerName} is on the way` : "Safe Arrival is active"}
          </p>
          <p className="mt-0.5 flex items-center gap-2 text-sm text-muted-foreground">
            <span className={cn("journey-status-dot", `journey-status-dot-${journey.key}`)} aria-hidden="true" />
            {journey.status}
          </p>
          {startedAtLabel ? (
            <p className="mt-0.5 text-xs text-muted-foreground">Journey started {startedAtLabel}</p>
          ) : null}
        </div>
      </div>

      {role === "traveller" && journey.isLive ? (
        <div className="mt-4">
          <div className="flex items-center gap-2">
            {watchers.length > 0 ? (
              <div className="flex -space-x-2">
                {watchers.slice(0, 5).map((watcher) => (
                  <span
                    key={watcher.id}
                    className={cn("journey-watcher rounded-full ring-2 ring-card", !reducedMotion && "journey-watcher-pulse")}
                    title={watcher.name}
                  >
                    <UserAvatar src={watcher.avatarUrl} name={watcher.name} size="xs" decorative />
                  </span>
                ))}
              </div>
            ) : null}
            <p className="text-xs text-muted-foreground">
              {watcherSummary(
                watchers.map((watcher) => watcher.name),
                sharedCount
              )}
            </p>
          </div>
        </div>
      ) : null}

      {role === "watcher" && journey.isLive ? (
        <p className="mt-3 text-xs leading-5 text-muted-foreground">
          Safe Arrival is active. You&apos;ll be notified when {travellerName} arrives.
        </p>
      ) : null}

      {children ? <div className="mt-4">{children}</div> : null}
    </div>
  );
}
