"use client";

import { useEffect, useState } from "react";
import { UPFOR_COUNTDOWN_REFRESH_MS } from "@/lib/social/upfor-countdown";

/**
 * A ticking clock for countdown labels, correct again the moment you come back.
 *
 * THE INTERVAL IS NOT ENOUGH ON ITS OWN. Browsers throttle or suspend timers in
 * a backgrounded tab, and a phone that has been in a pocket for forty minutes
 * may not have fired a single tick. Reopening would then show the label that
 * was true when the screen went off -- "Starts in 12m" for something that began
 * half an hour ago -- until the next interval happened to land.
 *
 * So the clock is re-read on the events that mean "a person is looking at this
 * again": `visibilitychange` back to visible, and `pageshow`, which is what
 * fires when a page is restored from the back/forward cache (where no timer
 * runs at all). The re-read happens in the same task as the event, so the
 * first frame the viewer sees is already correct rather than correct-in-30s.
 *
 * Being a pure clock, nothing else has to change: every countdown derives from
 * this value, so one refresh corrects every label on the screen at once.
 */
export function useCountdownClock(intervalMs: number = UPFOR_COUNTDOWN_REFRESH_MS): number {
  const [nowMs, setNowMs] = useState(() => Date.now());
  useCountdownResume(setNowMs, intervalMs);
  return nowMs;
}

/**
 * The same clock, for a component that already owns its own `nowMs` state.
 *
 * Exists so a surface with an established ticker gains the resume behaviour
 * without having to surrender its state, which would mean rewriting everything
 * that reads it.
 */
export function useCountdownResume(
  setNowMs: (value: number) => void,
  intervalMs: number = UPFOR_COUNTDOWN_REFRESH_MS
): void {
  useEffect(() => {
    const sync = () => setNowMs(Date.now());

    const timer = setInterval(sync, intervalMs);

    // Only on the way BACK. Syncing as the tab is hidden would do work nobody
    // is there to see.
    const onVisibility = () => {
      if (document.visibilityState === "visible") sync();
    };

    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pageshow", sync);

    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pageshow", sync);
    };
  }, [intervalMs, setNowMs]);
}
