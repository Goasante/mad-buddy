"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { fetchWithTimeout } from "@/lib/network/resilience";
import { authenticateRealtime, createSupabaseBrowserClient } from "@/lib/supabase/client";

export const MESSAGES_UPDATED_EVENT = "mad-buddy:messages-updated";

/**
 * Canonical unread chat count for navigation badges. Conversation read state
 * remains server-authoritative; the hook only presents its current projection.
 *
 * NO INTERVAL POLL (Vercel usage optimization pass). This used to refetch
 * every 30 seconds in addition to holding a working Realtime subscription --
 * so on a quiet badge that never changes, the interval was the ENTIRE cost:
 * every 30s tick fetched a count that Realtime would have refetched anyway
 * the moment it actually changed. Freshness now comes from three things, none
 * of them a timer:
 *
 *   1. The Realtime INSERT listener below, which is the fast path for an
 *      actual change and always was.
 *   2. `SUBSCRIBED` firing again after a reconnect (§9): a socket that drops
 *      and reattaches may have missed an INSERT while it was down, so
 *      reaching SUBSCRIBED again triggers exactly one authoritative refresh --
 *      not a new polling loop, a single reconciliation.
 *   3. focus/visibilitychange, kept as the correctness net for the case
 *      Realtime itself cannot cover: a phone that slept through a push, a
 *      restrictive network that silently drops the WebSocket without ever
 *      surfacing CLOSED. Both already existed and neither is a new cost --
 *      they only fire on a real resume, not on a clock.
 */
export function useUnreadMessageCount(userId: string | null) {
  const enabled = Boolean(userId);
  const [unreadCount, setUnreadCount] = useState(0);
  const inFlight = useRef<Promise<void> | null>(null);

  const refresh = useCallback(async () => {
    if (!enabled) return;
    if (inFlight.current) return inFlight.current;

    const request = (async () => {
      try {
        const response = await fetchWithTimeout(
          "/api/messages/unread-count",
          { credentials: "include", cache: "no-store" },
          12_000,
          "refresh unread messages"
        );
        if (!response.ok) return;
        const payload = (await response.json()) as { unreadCount?: number };
        if (typeof payload.unreadCount === "number") setUnreadCount(payload.unreadCount);
      } catch {
        // Retain the last known count during a temporary network failure.
      } finally {
        inFlight.current = null;
      }
    })();

    inFlight.current = request;
    return request;
  }, [enabled]);

  useEffect(() => {
    if (!enabled) return;

    const handleFocus = () => void refresh();
    const handleVisibility = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    const handleUpdated = (event: Event) => {
      const detail = (event as CustomEvent<{ unreadCount?: number }>).detail;
      if (typeof detail?.unreadCount === "number") setUnreadCount(detail.unreadCount);
      else void refresh();
    };

    void refresh();
    window.addEventListener("focus", handleFocus);
    document.addEventListener("visibilitychange", handleVisibility);
    window.addEventListener(MESSAGES_UPDATED_EVENT, handleUpdated);
    return () => {
      window.removeEventListener("focus", handleFocus);
      document.removeEventListener("visibilitychange", handleVisibility);
      window.removeEventListener(MESSAGES_UPDATED_EVENT, handleUpdated);
    };
  }, [enabled, refresh]);

  useEffect(() => {
    if (!userId) return;

    let disposed = false;
    // True once this channel has reached SUBSCRIBED at least once, so that
    // event is distinguished from every SUBSCRIBED after it: the first is the
    // normal start of a fresh subscription (the mount-time refresh() below
    // already covers it), and every one after a drop is a RECONNECT, which may
    // have missed an INSERT while the socket was down and needs its own
    // authoritative resync rather than trusting the count to still be right.
    let hasSubscribedOnce = false;
    const supabase = createSupabaseBrowserClient();
    const channel = supabase
      .channel(`message-unread:${userId}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages" }, () => {
        // RLS decides which inserts this user may observe. Never trust the raw
        // payload for a count; refetch the canonical conversation projection.
        void refresh();
      });

    void authenticateRealtime(supabase).then(() => {
      if (disposed) return;
      channel.subscribe((status) => {
        if (disposed || status !== "SUBSCRIBED") return;
        if (hasSubscribedOnce) void refresh();
        hasSubscribedOnce = true;
      });
    });

    return () => {
      disposed = true;
      void supabase.removeChannel(channel);
    };
  }, [refresh, userId]);

  return { unreadCount: enabled ? unreadCount : 0, refresh };
}
