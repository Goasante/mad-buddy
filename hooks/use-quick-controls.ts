"use client";

import { useCallback, useRef, useState, useTransition } from "react";

import { updateVisibilityStatusAction } from "@/app/(app)/settings-actions";
import { fetchWithTimeout } from "@/lib/network/resilience";

/**
 * The Quick Controls state, shared by every page that offers them.
 *
 * Extracted from the Home page rather than reimplemented: visibility, ghost
 * mode and the private proximity refresh are one behaviour, and a second copy
 * on Linkr would be two implementations that drift — the exact failure where a
 * user turns ghost mode on from one screen and the other still shows them
 * visible.
 *
 * Deliberately NOT included here: the status composer. It owns its own form
 * state and is already a self-contained component, so each page passes it
 * through as a node rather than this hook rebuilding it.
 */

export type QuickControlsState = {
  ghostMode: boolean;
  isPending: boolean;
  isCheckingNearby: boolean;
  statusMessage: string;
  toggleVisibility: () => void;
  refreshNearby: () => void;
};

export function useQuickControls({
  initialGhostMode,
  /**
   * Called after a successful location update, so the caller can refresh
   * whatever it renders from proximity. Optional: Linkr reloads through its
   * own discovery action, Home through its nearby-friends loader.
   */
  onLocationUpdated
}: {
  initialGhostMode: boolean;
  onLocationUpdated?: () => void;
}): QuickControlsState {
  const [ghostMode, setGhostMode] = useState(initialGhostMode);
  const [statusMessage, setStatusMessage] = useState("");
  const [isCheckingNearby, setIsCheckingNearby] = useState(false);
  const [isPending, startTransition] = useTransition();

  // Guards against a second geolocation request while one is in flight — the
  // browser prompt is modal, and stacking requests behind it means a queue of
  // updates firing at once when the user finally answers.
  const inFlightRef = useRef(false);

  const refreshNearby = useCallback(() => {
    if (inFlightRef.current) return;

    if (!("geolocation" in navigator)) {
      setStatusMessage("This browser does not support location permission.");
      return;
    }

    inFlightRef.current = true;
    setIsCheckingNearby(true);
    setStatusMessage("");

    navigator.geolocation.getCurrentPosition(
      async (position) => {
        try {
          const response = await fetchWithTimeout(
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
            "update proximity"
          );

          if (!response.ok) {
            const data = (await response.json().catch(() => null)) as { error?: string } | null;
            setStatusMessage(data?.error ?? "Could not update your private proximity signal.");
            return;
          }

          onLocationUpdated?.();
        } catch {
          setStatusMessage("Could not update your private proximity signal.");
        } finally {
          inFlightRef.current = false;
          setIsCheckingNearby(false);
        }
      },
      (error) => {
        inFlightRef.current = false;
        setIsCheckingNearby(false);
        // Each failure names what the user can actually do about it. "Location
        // failed" tells someone with a blocked permission nothing.
        if (error.code === error.PERMISSION_DENIED) {
          setStatusMessage("Location access is blocked. Allow it in this browser’s site settings, then refresh.");
        } else if (error.code === error.POSITION_UNAVAILABLE) {
          setStatusMessage("This browser could not determine your location. Check device location services and try again.");
        } else {
          setStatusMessage("The location check timed out. Try again.");
        }
      },
      { enableHighAccuracy: true, maximumAge: 30_000, timeout: 15_000 }
    );
  }, [onLocationUpdated]);

  const toggleVisibility = useCallback(() => {
    const nextGhostMode = !ghostMode;
    startTransition(async () => {
      const result = await updateVisibilityStatusAction(nextGhostMode ? "ghost" : "visible");
      setStatusMessage(result.ok ? "" : result.message);
      // Server confirmed: only now does the UI claim the new state.
      if (!result.ok) return;

      setGhostMode(nextGhostMode);
      // The shell listens for this to start or stop background location sync.
      window.dispatchEvent(
        new CustomEvent("mad-buddy:location-sync-status", { detail: { enabled: !nextGhostMode } })
      );
      // Coming out of ghost mode, refresh immediately rather than leaving the
      // user visible with a stale position until the next sync.
      if (!nextGhostMode) refreshNearby();
    });
  }, [ghostMode, refreshNearby]);

  return { ghostMode, isPending, isCheckingNearby, statusMessage, toggleVisibility, refreshNearby };
}
