"use client";

import { useCallback, useEffect, useRef } from "react";
import { fetchWithTimeout } from "@/lib/network/resilience";

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
    if (!enabled || inFlight.current || document.visibilityState !== "visible") return;
    if (!("geolocation" in navigator)) return;

    inFlight.current = true;
    navigator.geolocation.getCurrentPosition(
      async (position) => {
        try {
          await fetchWithTimeout(
            "/api/location/update",
            {
              method: "POST",
              credentials: "include",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                latitude: position.coords.latitude,
                longitude: position.coords.longitude,
                accuracy: position.coords.accuracy
              })
            },
            15_000,
            "update Meetup proximity"
          );
        } catch {
          // The existing poll/focus refresh remains the fallback. Do not turn a
          // temporary location failure into a blocking Meetup screen.
        } finally {
          inFlight.current = false;
        }
      },
      () => {
        inFlight.current = false;
      },
      { enableHighAccuracy: true, maximumAge: 30_000, timeout: 12_000 }
    );
  }, [enabled]);

  useEffect(() => {
    if (!enabled) return;
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
