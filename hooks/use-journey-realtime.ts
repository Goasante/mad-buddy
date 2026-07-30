"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { authenticateRealtime, createSupabaseBrowserClient } from "@/lib/supabase/client";

export type JourneyRealtimeState = "idle" | "connecting" | "connected" | "offline";

/**
 * Live updates for one Safe Arrival journey.
 *
 * Realtime here is strictly an ENHANCEMENT. Correctness never depends on it:
 * the journey, its watcher rows and every notification are written server-side,
 * and each screen is rendered from a canonical server read. If the socket never
 * connects, a reload still shows the right state and the alerts still went out.
 * That is why an event only ever triggers `router.refresh()` — the streamed
 * payload itself is never trusted or rendered.
 *
 * RLS restricts the stream to the traveller and their approved watchers, so an
 * unauthorised or blocked user receives nothing.
 */
export function useJourneyRealtime(input: {
  sessionId: string | null;
  /** Watcher-acceptance changes only matter to the traveller. */
  watchContacts: boolean;
  /** Terminal journeys have nothing left to stream. */
  enabled: boolean;
}): { state: JourneyRealtimeState; retry: () => void } {
  const { sessionId, watchContacts, enabled } = input;
  const router = useRouter();
  const [state, setState] = useState<JourneyRealtimeState>(enabled ? "connecting" : "idle");
  const [attempt, setAttempt] = useState(0);

  const retry = useCallback(() => {
    setState("connecting");
    setAttempt((value) => value + 1);
    router.refresh();
  }, [router]);

  useEffect(() => {
    if (!enabled || !sessionId) return;

    // setState is deferred out of the effect body: a synchronous setState here
    // trips react-hooks/set-state-in-effect.
    if (!window.navigator.onLine) {
      const timer = window.setTimeout(() => setState("offline"), 0);
      return () => window.clearTimeout(timer);
    }

    let supabase: ReturnType<typeof createSupabaseBrowserClient> | null = null;
    try {
      supabase = createSupabaseBrowserClient();
    } catch {
      const timer = window.setTimeout(() => setState("offline"), 0);
      return () => window.clearTimeout(timer);
    }
    if (!supabase) return;

    let disposed = false;
    let queued = false;
    let timer: number | null = null;
    const refresh = () => {
      // Coalesce a burst of events into one canonical refetch.
      if (queued) return;
      queued = true;
      timer = window.setTimeout(() => {
        if (disposed) return;
        queued = false;
        router.refresh();
      }, 250);
    };

    const channel = supabase.channel(`safe-arrival:${sessionId}`);
    channel.on(
      "postgres_changes",
      { event: "UPDATE", schema: "public", table: "safe_arrival_sessions", filter: `id=eq.${sessionId}` },
      refresh
    );
    if (watchContacts) {
      channel.on(
        "postgres_changes",
        { event: "*", schema: "public", table: "safe_arrival_contacts", filter: `session_id=eq.${sessionId}` },
        refresh
      );
    }

    // The socket must carry the user's token before subscribing: these filters
    // are on RLS-protected tables, and a socket holding only the publishable key
    // sees nothing through RLS and is closed with CHANNEL_ERROR.
    void authenticateRealtime(supabase).then(() => {
      if (disposed) return;
      channel.subscribe((status) => {
        if (disposed) return;
        if (status === "SUBSCRIBED") setState("connected");
        else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") setState("offline");
      });
    });

    const handleOffline = () => setState("offline");
    const handleOnline = () => {
      setState("connecting");
      setAttempt((value) => value + 1);
      router.refresh();
    };
    window.addEventListener("offline", handleOffline);
    window.addEventListener("online", handleOnline);

    return () => {
      disposed = true;
      if (timer !== null) window.clearTimeout(timer);
      window.removeEventListener("offline", handleOffline);
      window.removeEventListener("online", handleOnline);
      void supabase.removeChannel(channel);
    };
  }, [enabled, sessionId, watchContacts, attempt, router]);

  return { state, retry };
}

/**
 * A clock that ticks once a minute, for countdowns and timeline progress.
 * Seeded through the lazy `useState` initialiser because reading `Date.now()`
 * in a component body is impure (react-hooks/purity).
 */
export function useJourneyClock(enabled: boolean): number {
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    if (!enabled) return;
    const interval = window.setInterval(() => setNowMs(Date.now()), 30_000);
    return () => window.clearInterval(interval);
  }, [enabled]);
  return nowMs;
}
