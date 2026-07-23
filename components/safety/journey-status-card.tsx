"use client";

import { RefreshCcw, ShieldCheck, WifiOff } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
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
  const [realtimeState, setRealtimeState] = useState<"idle" | "connecting" | "connected" | "offline">(
    journey.isLive ? "connecting" : "idle"
  );
  const [reconnectAttempt, setReconnectAttempt] = useState(0);

  const retryRealtime = useCallback(() => {
    setRealtimeState("connecting");
    setReconnectAttempt((attempt) => attempt + 1);
    router.refresh();
  }, [router]);

  useEffect(() => {
    if (!journey.isLive) return; // Terminal session: nothing left to stream.

    if (!window.navigator.onLine) {
      const timer = window.setTimeout(() => setRealtimeState("offline"), 0);
      return () => window.clearTimeout(timer);
    }

    let supabase: ReturnType<typeof createSupabaseBrowserClient> | null = null;
    try {
      supabase = createSupabaseBrowserClient();
    } catch {
      const timer = window.setTimeout(() => setRealtimeState("offline"), 0);
      return () => window.clearTimeout(timer);
    }

    if (!supabase) {
      return;
    }

    let disposed = false;
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
    channel.subscribe((subscriptionStatus) => {
      if (disposed) return;
      if (subscriptionStatus === "SUBSCRIBED") {
        setRealtimeState("connected");
      } else if (
        subscriptionStatus === "CHANNEL_ERROR" ||
        subscriptionStatus === "TIMED_OUT" ||
        subscriptionStatus === "CLOSED"
      ) {
        setRealtimeState("offline");
      }
    });

    const handleOffline = () => setRealtimeState("offline");
    const handleOnline = () => {
      setRealtimeState("connecting");
      setReconnectAttempt((attempt) => attempt + 1);
      router.refresh();
    };
    window.addEventListener("offline", handleOffline);
    window.addEventListener("online", handleOnline);

    return () => {
      disposed = true;
      window.removeEventListener("offline", handleOffline);
      window.removeEventListener("online", handleOnline);
      void supabase.removeChannel(channel);
    };
  }, [journey.isLive, reconnectAttempt, role, sessionId, router]);

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

      {journey.isLive && realtimeState === "offline" ? (
        <div
          className="mt-3 flex flex-wrap items-center gap-2 rounded-xl bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300"
          role="status"
        >
          <WifiOff className="h-4 w-4 shrink-0" aria-hidden="true" />
          <span className="min-w-0 flex-1">Live updates are unavailable.</span>
          <button
            type="button"
            onClick={retryRealtime}
            className="focus-ring safe-motion inline-flex items-center gap-1 rounded-lg px-2 py-1 font-semibold hover:bg-amber-500/10"
          >
            <RefreshCcw className="h-3.5 w-3.5" aria-hidden="true" />
            Try again
          </button>
        </div>
      ) : null}

      {children ? <div className="mt-4">{children}</div> : null}
    </div>
  );
}
