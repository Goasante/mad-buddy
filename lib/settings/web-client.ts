import { fetchWithTimeout } from "@/lib/network/resilience";
import type { SettingsExportResult, SettingsWriteResult } from "@/lib/settings/client";

/**
 * The web app's Settings transports that are plain HTTP rather than Server
 * Actions.
 *
 * These are faithful moves of calls that used to sit inside the shared
 * components — same endpoints, same methods, same timeouts and the same
 * operation labels, which appear in timeout diagnostics. Web behaviour is
 * unchanged; only the location moved, so that the native app can supply its
 * own.
 */

/** Reads the browser position and posts it, enabling Location for Glow. */
export function enableLocationForGlowOnWeb(): Promise<SettingsWriteResult> {
  return new Promise((resolve) => {
    if (!("geolocation" in navigator) || !window.isSecureContext) {
      resolve({
        ok: false,
        message: "Location permission requires a supported browser and a secure connection."
      });
      return;
    }

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
            "enable location for glow"
          );

          if (!response.ok) {
            const data = (await response.json().catch(() => null)) as { error?: string } | null;
            resolve({ ok: false, message: data?.error ?? "Could not enable location for glow. Try again." });
            return;
          }
          resolve({ ok: true });
        } catch {
          resolve({
            ok: false,
            message: "Could not enable location for glow. Check your connection and try again."
          });
        }
      },
      (error) => {
        /* The browser's own refusal reasons, which are worth distinguishing:
           "blocked" needs a site-settings change, the others do not. */
        if (error.code === error.PERMISSION_DENIED) {
          resolve({
            ok: false,
            message: "Location is blocked. Allow it in this browser’s site settings, then check again."
          });
        } else if (error.code === error.POSITION_UNAVAILABLE) {
          resolve({
            ok: false,
            message: "This browser could not determine your location. Check device location services."
          });
        } else {
          resolve({ ok: false, message: "The location check timed out. Try again." });
        }
      },
      { enableHighAccuracy: true, maximumAge: 30_000, timeout: 15_000 }
    );
  });
}

/** Fetches the account export bundle. Cookie-authenticated, web only. */
export async function exportAccountDataOnWeb(): Promise<SettingsExportResult> {
  try {
    const response = await fetchWithTimeout(
      "/api/account/export",
      { method: "GET", credentials: "include" },
      30_000,
      "export account data"
    );

    if (!response.ok) {
      const error = (await response.json().catch(() => null)) as { error?: string } | null;
      return { ok: false, message: error?.error ?? "Export failed." };
    }

    return { ok: true, blob: await response.blob() };
  } catch {
    return { ok: false, message: "Export failed. Check your connection and try again." };
  }
}
