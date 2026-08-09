"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { fetchWithTimeout } from "@/lib/network/resilience";
import { authenticateRealtime, createSupabaseBrowserClient } from "@/lib/supabase/client";

export const MESSAGES_UPDATED_EVENT = "mad-buddy:messages-updated";

/**
 * Canonical unread chat count for navigation badges. Conversation read state
 * remains server-authoritative; the hook only presents its current projection.
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
    const interval = window.setInterval(() => {
      if (!document.hidden) void refresh();
    }, 30_000);
    window.addEventListener("focus", handleFocus);
    document.addEventListener("visibilitychange", handleVisibility);
    window.addEventListener(MESSAGES_UPDATED_EVENT, handleUpdated);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", handleFocus);
      document.removeEventListener("visibilitychange", handleVisibility);
      window.removeEventListener(MESSAGES_UPDATED_EVENT, handleUpdated);
    };
  }, [enabled, refresh]);

  useEffect(() => {
    if (!userId) return;

    let disposed = false;
    const supabase = createSupabaseBrowserClient();
    const channel = supabase
      .channel(`message-unread:${userId}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages" }, () => {
        // RLS decides which inserts this user may observe. Never trust the raw
        // payload for a count; refetch the canonical conversation projection.
        void refresh();
      });

    void authenticateRealtime(supabase).then(() => {
      if (!disposed) channel.subscribe();
    });

    return () => {
      disposed = true;
      void supabase.removeChannel(channel);
    };
  }, [refresh, userId]);

  return { unreadCount: enabled ? unreadCount : 0, refresh };
}
