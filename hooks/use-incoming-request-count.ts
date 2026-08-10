"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { fetchWithTimeout } from "@/lib/network/resilience";

/**
 * Fired when a Muddy request is accepted, declined or sent.
 *
 * Lets the badge clear the instant somebody acts on a request, rather than
 * waiting out the poll interval and leaving a number on the tab for a queue
 * that is already empty.
 */
export const MUDDY_REQUESTS_UPDATED_EVENT = "mad-buddy:muddy-requests-updated";

/**
 * Pending incoming Muddy requests, for the Muddies tab badge.
 *
 * Deliberately shaped like useUnreadMessageCount: same polling cadence, same
 * focus and visibility refresh, same event escape hatch. Two badges that
 * behave differently is a thing users notice without being able to say why,
 * and one that lags while the other is instant reads as a bug.
 *
 * The count is server-authoritative. This only presents whatever the endpoint
 * currently reports.
 */
export function useIncomingRequestCount(userId: string | null) {
  const enabled = Boolean(userId);
  const [requestCount, setRequestCount] = useState(0);
  const inFlight = useRef<Promise<void> | null>(null);

  const refresh = useCallback(async () => {
    if (!enabled) return;
    // One request at a time: focus, visibility and the interval can all fire
    // together when a phone wakes, and three identical reads help nobody.
    if (inFlight.current) return inFlight.current;

    const request = (async () => {
      try {
        const response = await fetchWithTimeout(
          "/api/friends/request-count",
          { credentials: "include", cache: "no-store" },
          12_000,
          "refresh muddy requests"
        );
        if (!response.ok) return;
        const payload = (await response.json()) as { requestCount?: number };
        if (typeof payload.requestCount === "number") setRequestCount(payload.requestCount);
      } catch {
        // Keeps the last known count through a temporary network failure.
        // Dropping to zero would clear a badge for requests still waiting.
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
      // An acting screen can pass the new count directly, so the badge updates
      // in the same frame as the row disappearing.
      const detail = (event as CustomEvent<{ requestCount?: number }>).detail;
      if (typeof detail?.requestCount === "number") setRequestCount(detail.requestCount);
      else void refresh();
    };

    void refresh();
    // Matches the messages badge. Paused while hidden, so a backgrounded tab
    // is not polling every thirty seconds for a badge nobody can see.
    const interval = window.setInterval(() => {
      if (!document.hidden) void refresh();
    }, 30_000);
    window.addEventListener("focus", handleFocus);
    document.addEventListener("visibilitychange", handleVisibility);
    window.addEventListener(MUDDY_REQUESTS_UPDATED_EVENT, handleUpdated);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", handleFocus);
      document.removeEventListener("visibilitychange", handleVisibility);
      window.removeEventListener(MUDDY_REQUESTS_UPDATED_EVENT, handleUpdated);
    };
  }, [enabled, refresh]);

  return { requestCount, refresh };
}

/** Announces that the request queue changed, so every badge updates at once. */
export function announceMuddyRequestsUpdated(requestCount?: number): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent(MUDDY_REQUESTS_UPDATED_EVENT, { detail: { requestCount } })
  );
}
