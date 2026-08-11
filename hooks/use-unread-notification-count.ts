"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { fetchWithTimeout } from "@/lib/network/resilience";

/** The canonical unread-count broadcast, published by the notifications UI. */
export const NOTIFICATIONS_UPDATED_EVENT = "mad-buddy:notifications-updated";

/**
 * The canonical unread app-notification count for badge surfaces.
 *
 * This is the ONE place the count is fetched and kept fresh for chrome. Both
 * the shell (desktop sidebar) and the mobile header read it, so a badge can
 * never drift from the stream it points at, and adding a badge somewhere new
 * never means adding another counter.
 *
 * Deliberately NOT the pending-Muddy-request count: that is a different
 * stream with its own surface, and the two are never merged.
 *
 * NO INTERVAL POLL (Vercel usage optimization pass). This used to run its own
 * 60-second timer in addition to listening for the broadcast below -- two
 * overlapping ways of noticing the same thing, on top of LiveSignalToast's
 * 45-second poll doing yet a third round of the same work. LiveSignalToast's
 * Realtime subscription (or its own now-conditional poll fallback, only live
 * while Realtime is unhealthy) is what actually notices a new notification
 * and fires `mad-buddy:notifications-updated`; this hook only needs to be
 * listening when that happens, plus the same resync-on-resume fallback
 * useUnreadMessageCount uses for the same reason: focus/visibility as the net
 * for whatever neither Realtime nor its own fallback caught.
 */
export function useUnreadNotificationCount(initialCount = 0) {
  const [unreadCount, setUnreadCount] = useState(initialCount);
  // In-flight de-duplication: focus + visibilitychange commonly fire together.
  const inFlight = useRef<Promise<void> | null>(null);

  const refresh = useCallback(async () => {
    if (inFlight.current) return inFlight.current;

    const request = (async () => {
      try {
        const response = await fetchWithTimeout(
          "/api/notifications/unread-count",
          { credentials: "include", cache: "no-store" },
          12_000,
          "refresh unread notifications"
        );
        if (!response.ok) return;
        const data = (await response.json()) as { unreadCount: number };
        setUnreadCount(data.unreadCount);
      } catch {
        // Keep the last known count when the service is unavailable — a stale
        // badge is far better than one that vanishes on a flaky network.
      } finally {
        inFlight.current = null;
      }
    })();

    inFlight.current = request;
    return request;
  }, []);

  useEffect(() => {
    const handleFocus = () => void refresh();
    const handleVisibility = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    const handleUpdated = (event: Event) => {
      const detail = (event as CustomEvent<{ unreadCount?: number }>).detail;
      // Publishers that already know the new count pass it, which avoids a
      // round trip; those that only know "something changed" omit it.
      if (typeof detail?.unreadCount === "number") setUnreadCount(detail.unreadCount);
      else void refresh();
    };

    window.addEventListener("focus", handleFocus);
    document.addEventListener("visibilitychange", handleVisibility);
    window.addEventListener(NOTIFICATIONS_UPDATED_EVENT, handleUpdated);
    return () => {
      window.removeEventListener("focus", handleFocus);
      document.removeEventListener("visibilitychange", handleVisibility);
      window.removeEventListener(NOTIFICATIONS_UPDATED_EVENT, handleUpdated);
    };
  }, [refresh]);

  return { unreadCount, refresh };
}
