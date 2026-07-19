"use client";

import { useCallback, useEffect, useRef, useState } from "react";

// Foreground-only web cadence. This keeps a moving device's broad proximity
// signal current without claiming background tracking the browser cannot
// guarantee after the tab or screen is suspended.
const REFRESH_INTERVAL_MS = 2 * 60 * 1000;
const MINIMUM_REFRESH_GAP_MS = 60 * 1000;

type LocationSignalSyncProps = {
  initiallyEnabled: boolean;
};

function reportLocationError(message: string) {
  window.dispatchEvent(
    new CustomEvent("mad-buddy:location-sync-error", {
      detail: { message }
    })
  );
}

export function LocationSignalSync({ initiallyEnabled }: LocationSignalSyncProps) {
  const [enabled, setEnabled] = useState(initiallyEnabled);
  const inFlightRef = useRef(false);
  const lastAttemptRef = useRef(0);

  const updateSignal = useCallback(() => {
    if (
      !enabled ||
      inFlightRef.current ||
      document.visibilityState !== "visible" ||
      Date.now() - lastAttemptRef.current < MINIMUM_REFRESH_GAP_MS
    ) {
      return;
    }

    if (!("geolocation" in navigator)) {
      reportLocationError("This browser does not support location access.");
      return;
    }

    inFlightRef.current = true;
    lastAttemptRef.current = Date.now();

    const savePosition = async (position: GeolocationPosition) => {
      try {
        const response = await fetch("/api/location/update", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            latitude: position.coords.latitude,
            longitude: position.coords.longitude,
            accuracy: position.coords.accuracy
          })
        });

        if (response.ok) {
          window.dispatchEvent(new Event("mad-buddy:location-updated"));
          return;
        }

        const data = (await response.json().catch(() => null)) as { error?: string } | null;
        reportLocationError(data?.error ?? "Mad Buddy could not update your proximity signal.");
      } catch {
        reportLocationError("Mad Buddy could not reach the proximity service.");
      } finally {
        inFlightRef.current = false;
      }
    };

    const handleFinalError = (error: GeolocationPositionError) => {
      inFlightRef.current = false;
      if (error.code === error.PERMISSION_DENIED) {
        reportLocationError("Location access is blocked for this browser.");
      } else if (error.code === error.POSITION_UNAVAILABLE) {
        reportLocationError("Your browser could not determine your location. Check device location services.");
      } else {
        reportLocationError("The browser location check timed out. Try again.");
      }
    };

    navigator.geolocation.getCurrentPosition(
      savePosition,
      (firstError) => {
        if (firstError.code === firstError.PERMISSION_DENIED) {
          handleFinalError(firstError);
          return;
        }

        navigator.geolocation.getCurrentPosition(
          savePosition,
          handleFinalError,
          { enableHighAccuracy: false, maximumAge: 5 * 60 * 1000, timeout: 20_000 }
        );
      },
      { enableHighAccuracy: true, maximumAge: 30_000, timeout: 12_000 }
    );
  }, [enabled]);

  useEffect(() => {
    const handleVisibilityStatus = (event: Event) => {
      const detail = (event as CustomEvent<{ enabled?: boolean }>).detail;
      if (typeof detail?.enabled !== "boolean") return;
      setEnabled(detail.enabled);
      if (detail.enabled) lastAttemptRef.current = 0;
    };

    window.addEventListener("mad-buddy:location-sync-status", handleVisibilityStatus);
    return () => window.removeEventListener("mad-buddy:location-sync-status", handleVisibilityStatus);
  }, []);

  useEffect(() => {
    if (!enabled) return;

    const handleFocus = () => updateSignal();
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") updateSignal();
    };

    updateSignal();
    const intervalId = window.setInterval(updateSignal, REFRESH_INTERVAL_MS);
    window.addEventListener("focus", handleFocus);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      window.clearInterval(intervalId);
      window.removeEventListener("focus", handleFocus);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [enabled, updateSignal]);

  return null;
}
