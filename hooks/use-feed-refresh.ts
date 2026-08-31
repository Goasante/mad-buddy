"use client";

import { useEffect, useRef } from "react";

/**
 * How often a VISIBLE viewer re-reads the discovery feed.
 *
 * Deliberately slower than the countdown's tick. The countdown re-reads a
 * clock; this re-runs `getVisibleHangoutsAction`, which resolves friendships,
 * two session queries, per-row eligibility, profiles, requests and plans. At
 * the countdown's cadence that would be a lot of work for every viewer with
 * the screen open, and the lifecycle refetches below already cover the case
 * that actually matters -- somebody coming back to the app.
 */
export const FEED_REFRESH_INTERVAL_MS = 30_000;

/**
 * Keep a viewer's feed current while they are actually looking at it.
 *
 * THE DEFECT THIS CLOSES. The feed was read once, on mount, and never again.
 * Every eligibility rule was correct -- audience, blocks, proximity, start
 * gating -- so a friend's new UpFor was genuinely visible to this viewer, and
 * a reload proved it. But a person who already had the screen open never saw
 * it, which is exactly the shape of "I posted an UpFor and my Muddy can't see
 * it". Correct backend state is not a correct live product.
 *
 * WHAT MAKES A REFRESH HAPPEN:
 *   - a 30s interval, but only while the document is visible
 *   - coming back: `visibilitychange` to visible, `pageshow` (bfcache restore,
 *     where no timer ran at all), and window `focus`
 *   - regaining the network, since the read that failed offline can now succeed
 *
 * Returning to a tab can fire visibilitychange, pageshow and focus within a
 * few milliseconds of each other, so every path goes through one in-flight
 * guard: a refresh already running is joined rather than duplicated. Without
 * it, fixing a stale feed would have introduced a request storm instead.
 *
 * Deliberately NOT realtime. A subscription brings channel lifecycle,
 * reconnection, duplicate events and RLS behaviour of its own; this defect is
 * a missing re-read, and it is fixed as one.
 */
export function useFeedRefresh(
  refresh: () => Promise<void>,
  { enabled = true, intervalMs = FEED_REFRESH_INTERVAL_MS }: { enabled?: boolean; intervalMs?: number } = {}
): void {
  // The callback is re-created on every render of a component that holds
  // state; keeping it in a ref means the listeners below are attached once
  // rather than torn down and re-attached each time. Assigned in an effect,
  // never during render -- a ref write during render is not a pure render.
  const refreshRef = useRef(refresh);
  useEffect(() => {
    refreshRef.current = refresh;
  }, [refresh]);

  // True while a refresh is in flight. Every trigger checks it, so an event
  // storm collapses to a single request.
  const inFlight = useRef(false);

  useEffect(() => {
    if (!enabled) return;

    let cancelled = false;

    const run = () => {
      if (cancelled || inFlight.current) return;
      if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
      inFlight.current = true;
      void refreshRef.current().finally(() => {
        inFlight.current = false;
      });
    };

    /* Only on the way BACK to visible. Refreshing as the tab is hidden would
       do work nobody is there to see, and the interval below is already
       stopped for the same reason. */
    const onVisibility = () => {
      if (document.visibilityState === "visible") run();
    };

    let timer: ReturnType<typeof setInterval> | null = null;
    const startTimer = () => {
      if (timer === null) timer = setInterval(run, intervalMs);
    };
    const stopTimer = () => {
      if (timer !== null) {
        clearInterval(timer);
        timer = null;
      }
    };

    // Polling follows visibility: a backgrounded tab does no work at all,
    // rather than relying on the browser to throttle it for us.
    const onVisibilityTimer = () => {
      if (document.visibilityState === "visible") startTimer();
      else stopTimer();
    };

    if (document.visibilityState === "visible") startTimer();

    document.addEventListener("visibilitychange", onVisibility);
    document.addEventListener("visibilitychange", onVisibilityTimer);
    window.addEventListener("pageshow", run);
    window.addEventListener("focus", run);
    window.addEventListener("online", run);

    return () => {
      cancelled = true;
      stopTimer();
      document.removeEventListener("visibilitychange", onVisibility);
      document.removeEventListener("visibilitychange", onVisibilityTimer);
      window.removeEventListener("pageshow", run);
      window.removeEventListener("focus", run);
      window.removeEventListener("online", run);
    };
  }, [enabled, intervalMs]);
}
