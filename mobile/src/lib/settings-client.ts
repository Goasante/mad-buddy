import { api, postCurrentLocation } from "./api";
import type { SettingsClient } from "@/lib/settings/client";

/**
 * The native app's Settings transport.
 *
 * The same route handlers the web Server Actions share, reached with a Bearer
 * token instead of a session cookie: this WebView is served from
 * https://localhost and has no cookie for the API origin. Both land in
 * lib/settings/service.ts, so validation and the partial-merge semantics
 * cannot differ between the two apps.
 *
 * These are the exact calls the hand-written SettingsScreen already made, kept
 * verbatim so the migration changes what renders, not what is sent.
 */
export const mobileSettingsClient: SettingsClient = {
  async setVisibilityStatus(status) {
    // The body is the bare status value, not an object -- updateVisibilityStatus
    // parses the input itself.
    const result = await api.post<{ ok: boolean; message: string }>("/api/settings/visibility", status);
    return result.ok
      ? { ok: result.data.ok, message: result.data.message }
      : { ok: false, message: result.error };
  },

  async setNearbyAlerts(enabled) {
    const result = await api.post<{ ok: boolean; message: string }>("/api/settings/notifications", {
      nearbyAlerts: enabled
    });
    return result.ok
      ? { ok: result.data.ok, message: result.data.message }
      : { ok: false, message: result.error };
  },

  /**
   * Enabling Location for Glow.
   *
   * postCurrentLocation already exists for exactly this: it reads the WebView
   * position (gated by the native location permission) and posts it through
   * `api`, so the request carries the API origin and a Bearer token. The
   * shared component used to do this itself with a relative path and a cookie,
   * which on Capacitor resolves against https://localhost and silently failed.
   */
  async enableLocationForGlow() {
    const result = await postCurrentLocation();
    return result.ok ? { ok: true } : { ok: false, message: result.error };
  }

  /* NO exportAccountData. Deliberately absent, which makes the row render as
     unavailable rather than broken. Two independent reasons:
       1. /api/account/export is cookie-only -- no resolveApiUser, no CORS
          preflight -- so a Bearer request could not authenticate.
       2. The web flow delivers the file with `<a download>` + click(), which
          does nothing in an Android WebView.
     Wiring only the request would produce a control that appears to work and
     silently delivers nothing. Enabling it needs a dual-auth route plus a
     native file/share path. */
};
