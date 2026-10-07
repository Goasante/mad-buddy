"use client";

export type LocationSyncResult = { ok: boolean; message?: string };

export function syncCurrentLocation(): Promise<LocationSyncResult> {
  return new Promise((resolve) => {
    if (!("geolocation" in navigator)) {
      resolve({ ok: false, message: "Location isn't available on this device." });
      return;
    }

    navigator.geolocation.getCurrentPosition(
      async (position) => {
        try {
          const response = await fetch("/api/location/update", {
            method: "POST",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              latitude: position.coords.latitude,
              longitude: position.coords.longitude,
              accuracy: Math.min(10000, Math.max(0, position.coords.accuracy ?? 50))
            })
          });
          if (response.ok) {
            resolve({ ok: true });
            return;
          }
          const body = (await response.json().catch(() => null)) as { error?: string } | null;
          resolve({ ok: false, message: body?.error ?? "Could not update your meetup proximity." });
        } catch {
          resolve({ ok: false, message: "Could not update your meetup proximity." });
        }
      },
      (error) => {
        resolve({
          ok: false,
          message:
            error.code === error.PERMISSION_DENIED
              ? "Location permission is needed while this meetup is active."
              : "Your current location could not be refreshed."
        });
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 30000 }
    );
  });
}
