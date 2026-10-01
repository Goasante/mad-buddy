"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

const POLL_MS = 2 * 60 * 1000;
const HEARTBEAT_MS = 8 * 60 * 1000;
const SEND_MOVE_METERS = 1_000;
const REFRESH_MOVE_METERS = 2_000;
const EARTH_RADIUS_M = 6_371_000;

function toRad(value: number) {
  return (value * Math.PI) / 180;
}

function distanceMeters(aLat: number, aLon: number, bLat: number, bLon: number) {
  const dLat = toRad(bLat - aLat);
  const dLon = toRad(bLon - aLon);
  const lat1 = toRad(aLat);
  const lat2 = toRad(bLat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.sin(dLon / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Keeps Conference's own coarse, overwrite-only location fresh while this
 * surface is open. It never calls the Glow location endpoint.
 */
export function ConferenceLocationSync({ refreshOnFirst = false }: { refreshOnFirst?: boolean }) {
  const router = useRouter();
  const lastSent = useRef<{ lat: number; lon: number; at: number } | null>(null);
  const firstSuccess = useRef(false);
  const inFlight = useRef(false);

  useEffect(() => {
    if (!navigator.geolocation) return;

    let cancelled = false;

    const sync = () => {
      if (cancelled || inFlight.current || document.visibilityState !== "visible") return;
      navigator.geolocation.getCurrentPosition(
        async (position) => {
          if (cancelled) return;
          const now = Date.now();
          const previous = lastSent.current;
          const moved = previous
            ? distanceMeters(previous.lat, previous.lon, position.coords.latitude, position.coords.longitude)
            : Number.POSITIVE_INFINITY;
          const heartbeatDue = !previous || now - previous.at >= HEARTBEAT_MS;
          if (previous && moved < SEND_MOVE_METERS && !heartbeatDue) return;

          inFlight.current = true;
          try {
            const response = await fetch("/api/conference/location", {
              method: "POST",
              credentials: "include",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                latitude: position.coords.latitude,
                longitude: position.coords.longitude,
                accuracy: Math.min(10_000, Math.max(0, position.coords.accuracy ?? 50))
              })
            });
            if (!response.ok || cancelled) return;

            lastSent.current = {
              lat: position.coords.latitude,
              lon: position.coords.longitude,
              at: now
            };

            const shouldRefresh =
              (!firstSuccess.current && refreshOnFirst) ||
              (firstSuccess.current && moved >= REFRESH_MOVE_METERS);
            firstSuccess.current = true;
            if (shouldRefresh) router.refresh();
          } finally {
            inFlight.current = false;
          }
        },
        () => {
          // Permission/errors are surfaced by the explicit Update location
          // control when location is actually required.
        },
        { enableHighAccuracy: false, maximumAge: 60_000, timeout: 12_000 }
      );
    };

    sync();
    const interval = window.setInterval(sync, POLL_MS);
    const onVisibility = () => {
      if (document.visibilityState === "visible") sync();
    };
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [refreshOnFirst, router]);

  return null;
}
