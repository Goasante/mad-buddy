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
 * Freshness comes from the same signals the shell already used: an immediate
 * refetch on focus/visibility, a 60s poll paused while the tab is hidden, and
 * the `mad-buddy:notifications-updated` broadcast — which may carry an exact
 * count (used directly) or no detail at all (triggers a refetch).
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

    const interval = window.setInterval(() => {
      if (!document.hidden) void refresh();
    }, 60_000);
    window.addEventListener("focus", handleFocus);
    document.addEventListener("visibilitychange", handleVisibility);
    window.addEventListener(NOTIFICATIONS_UPDATED_EVENT, handleUpdated);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", handleFocus);
      document.removeEventListener("visibilitychange", handleVisibility);
      window.removeEventListener(NOTIFICATIONS_UPDATED_EVENT, handleUpdated);
    };
  }, [refresh]);

  return { unreadCount, refresh };
}
