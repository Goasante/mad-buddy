"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { fetchWithTimeout } from "@/lib/network/resilience";
import { authenticateRealtime, createSupabaseBrowserClient } from "@/lib/supabase/client";

/**
 * Fired when a Muddy request is accepted, declined or sent.
 *
 * Lets the badge clear the instant somebody acts on a request, rather than
 * waiting on Realtime's own round trip and leaving a number on the tab for a
 * queue that is already empty.
 */
export const MUDDY_REQUESTS_UPDATED_EVENT = "mad-buddy:muddy-requests-updated";

/**
 * How often the safety-net poll runs, now that Realtime carries the normal
 * case (Vercel usage optimization pass, Pass 4).
 *
 * DELIBERATELY SLOW, and deliberately named rather than inlined. This is the
 * newest Realtime path in the app -- messages and notifications have run
 * theirs in production already; this one has not -- so unlike them it keeps
 * a poll at all, but a hosting-a-safety-net one, not a doing-the-real-work
 * one. Five minutes is long enough that its cost is negligible next to the
 * 30-second interval it replaces (a ~10x reduction on its own, before
 * counting that Realtime now covers the normal case entirely) while still
 * bounding how long a genuinely missed event could go unnoticed.
 */
export const FRIEND_REQUEST_SAFETY_POLL_MS = 5 * 60 * 1000;

/**
 * Pending incoming Muddy requests, for the Muddies tab badge.
 *
 * NOW REALTIME-BACKED. This was the one badge of the three (messages,
 * notifications, friend requests) with no Realtime path at all -- pure
 * 30-second polling, every page, no fast path for an actual change. That
 * accounted for 259 invocations of a route that most of the time returned
 * the same number as 30 seconds before. `friend_requests` was added to the
 * Realtime publication (20260811120000_realtime_friend_requests.sql) so this
 * can now subscribe the same way useUnreadMessageCount does.
 *
 * INSERT and UPDATE both matter here, not just INSERT: countIncomingRequests
 * counts `status = 'pending'` rows, and acceptDecline flips that status via
 * UPDATE rather than deleting the row (lib/friends/service.ts) -- so an
 * accept or decline only changes the count through an UPDATE event. DELETE is
 * subscribed defensively even though nothing in the service currently deletes
 * a request row, since a future change there should not silently need a
 * second migration to matter here.
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
    // The safety net, not the primary mechanism: Realtime below is. Paused
    // while hidden, so a backgrounded tab is not polling for a badge nobody
    // can see.
    const interval = window.setInterval(() => {
      if (!document.hidden) void refresh();
    }, FRIEND_REQUEST_SAFETY_POLL_MS);
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

  useEffect(() => {
    if (!userId) return;

    let disposed = false;
    // Same reconnect-resync shape as useUnreadMessageCount: the first
    // SUBSCRIBED is the normal start (the mount-time refresh() above already
    // covers it); every SUBSCRIBED after that is a reconnect that may have
    // missed an event while the socket was down, and gets its own refresh.
    let hasSubscribedOnce = false;
    const supabase = createSupabaseBrowserClient();
    const channel = supabase
      .channel(`friend-requests:${userId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "friend_requests", filter: `receiver_id=eq.${userId}` },
        () => void refresh()
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "friend_requests", filter: `receiver_id=eq.${userId}` },
        () => void refresh()
      )
      .on(
        "postgres_changes",
        { event: "DELETE", schema: "public", table: "friend_requests", filter: `receiver_id=eq.${userId}` },
        () => void refresh()
      );

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

  return { requestCount, refresh };
}

/** Announces that the request queue changed, so every badge updates at once. */
export function announceMuddyRequestsUpdated(requestCount?: number): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent(MUDDY_REQUESTS_UPDATED_EVENT, { detail: { requestCount } })
  );
}
