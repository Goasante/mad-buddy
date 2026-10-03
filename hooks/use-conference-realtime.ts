"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { authenticateRealtime, createSupabaseBrowserClient } from "@/lib/supabase/client";

export type ConferenceRealtimeState = "connecting" | "connected" | "offline";

const SIGNAL_DEBOUNCE_MS = 140;
const OFFLINE_FALLBACK_MS = 8_000;
const CONNECTED_SAFETY_REFRESH_MS = 45_000;
const FALLBACK_TICK_MS = 4_000;

/**
 * Conference Realtime is invalidation-only.
 *
 * The socket receives no Topic text, Voice text, anonymous identity, or
 * location. Database triggers send a tiny private "changed" broadcast and the
 * screen re-reads canonical, 15 km-filtered data through the server.
 */
export function useConferenceRealtime(input: {
  topicId?: string | null;
  enabled?: boolean;
  onRefresh: () => void | Promise<void>;
}): ConferenceRealtimeState {
  const { topicId = null, enabled = true, onRefresh } = input;
  const refreshRef = useRef(onRefresh);
  const [state, setState] = useState<ConferenceRealtimeState>("connecting");

  useEffect(() => {
    refreshRef.current = onRefresh;
  }, [onRefresh]);

  const requestRefresh = useCallback(() => {
    void refreshRef.current();
  }, []);

  useEffect(() => {
    if (!enabled) return;

    let supabase: ReturnType<typeof createSupabaseBrowserClient>;
    try {
      supabase = createSupabaseBrowserClient();
    } catch {
      const timer = window.setTimeout(() => setState("offline"), 0);
      return () => window.clearTimeout(timer);
    }

    let disposed = false;
    let connected = false;
    let queued = false;
    let queueTimer: number | null = null;
    let lastRefreshAt = Date.now();

    const queueRefresh = (delayMs = SIGNAL_DEBOUNCE_MS) => {
      if (disposed || queued) return;
      if (document.visibilityState !== "visible") return;
      queued = true;
      queueTimer = window.setTimeout(() => {
        if (disposed) return;
        queued = false;
        if (document.visibilityState !== "visible") return;
        lastRefreshAt = Date.now();
        requestRefresh();
      }, delayMs);
    };

    const channelName = topicId ? `conference:topic:${topicId}` : "conference:feed";
    const channel = supabase
      .channel(channelName, { config: { private: true } })
      .on("broadcast", { event: "changed" }, () => queueRefresh());

    void authenticateRealtime(supabase).then(() => {
      if (disposed) return;
      channel.subscribe((status) => {
        if (disposed) return;
        if (status === "SUBSCRIBED") {
          connected = true;
          setState("connected");
          return;
        }
        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
          connected = false;
          setState("offline");
        }
      });
    });

    const fallback = window.setInterval(() => {
      if (document.visibilityState !== "visible") return;
      const dueAfter = connected ? CONNECTED_SAFETY_REFRESH_MS : OFFLINE_FALLBACK_MS;
      if (Date.now() - lastRefreshAt >= dueAfter) queueRefresh(0);
    }, FALLBACK_TICK_MS);

    const onFocus = () => queueRefresh(0);
    const onVisibility = () => {
      if (document.visibilityState === "visible") queueRefresh(0);
    };
    const onOnline = () => {
      setState("connecting");
      queueRefresh(0);
    };
    const onOffline = () => {
      connected = false;
      setState("offline");
    };

    window.addEventListener("focus", onFocus);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      disposed = true;
      if (queueTimer !== null) window.clearTimeout(queueTimer);
      window.clearInterval(fallback);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
      document.removeEventListener("visibilitychange", onVisibility);
      void supabase.removeChannel(channel);
    };
  }, [enabled, requestRefresh, topicId]);

  return state;
}
