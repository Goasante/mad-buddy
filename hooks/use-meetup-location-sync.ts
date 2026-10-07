"use client";

import { useCallback, useEffect, useRef } from "react";
import { syncCurrentLocation } from "@/lib/platform";

const REFRESH_MS = 60_000;

/**
 * Foreground-only temporary location refresh for an accepted, live Meet Up.
 *
 * Acceptance is the in-app consent for Meetup Proximity. The operating system
 * permission remains authoritative: if location is denied, this hook never
 * circumvents it. Raw coordinates go only to the existing authenticated
 * location endpoint; Meetup participants receive only coarse Glow states.
 */
export function useMeetupLocationSync(enabled: boolean) {
  const inFlight = useRef(false);

  const refresh = useCallback(() => {
    if (PLATFORM_KIND !== "web" || !enabled || inFlight.current || document.visibilityState !== "visible") return;
    inFlight.current = true;
    void syncCurrentLocation().finally(() => {
      inFlight.current = false;
    });
  }, [enabled]);
  useEffect(() => {
    if (PLATFORM_KIND !== "web" || !enabled) return;
    const initial = window.setTimeout(refresh, 0);
    const interval = window.setInterval(refresh, REFRESH_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") refresh();
    };
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearTimeout(initial);
      window.clearInterval(interval);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [enabled, refresh]);
}
