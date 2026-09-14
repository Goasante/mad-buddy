import { api } from "./api";
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
  }
};
