import { api } from "./api";
import type {
  NotificationRecord,
  NotificationsClient
} from "@/lib/notifications/client";

/**
 * The native app's notifications transport.
 *
 * Same endpoints as the web client, reached differently: `api` prefixes
 * VITE_API_BASE_URL and attaches the Supabase access token as a Bearer
 * credential, because this WebView is served from https://localhost and has no
 * session cookie for the API origin.
 *
 * The route handlers resolve either credential through resolveApiUser, so the
 * server sees the same person and applies the same rules whichever app called.
 */
export const mobileNotificationsClient: NotificationsClient = {
  async load() {
    const result = await api.get<{ notifications: NotificationRecord[] }>("/api/notifications?limit=50");
    return result.ok ? result.data.notifications ?? [] : null;
  },

  async markAllRead() {
    const result = await api.post("/api/notifications", { markAllRead: true });
    return { ok: result.ok, message: result.ok ? undefined : result.error };
  },

  async markRead(notificationId) {
    const result = await api.post("/api/notifications", { ids: [notificationId], isRead: true });
    return { ok: result.ok, message: result.ok ? undefined : result.error };
  },

  async setReadState(ids, isRead) {
    const result = await api.post("/api/notifications", { ids, isRead });
    return { ok: result.ok, message: result.ok ? undefined : result.error };
  },

  async remove(ids) {
    const result = await api.del<{ deletedIds: string[] }>("/api/notifications", { ids });
    // Mirrors the web client: report the ids the server actually removed, so a
    // partial delete restores the rows that survived instead of hiding them.
    return result.ok
      ? { ok: true, deletedIds: result.data.deletedIds ?? [] }
      : { ok: false, deletedIds: [] };
  },

  async respondToPing(requestId, message) {
    // The route the web Server Action shares: both call
    // lib/meetups/service.ts, so the premium gate and friendship check are
    // enforced identically on either platform.
    const result = await api.post<{ ok: boolean; message: string }>("/api/pings/respond", {
      requestId,
      message
    });
    return result.ok
      ? { ok: result.data.ok, message: result.data.message }
      : { ok: false, message: result.error };
  },

  async saveNotificationPreferences(patch) {
    // The same route the web Server Action shares (lib/settings/service.ts),
    // which merges only the keys present -- so one flipped switch cannot
    // clobber the other two.
    const result = await api.post<{ ok: boolean; message: string }>("/api/settings/notifications", patch);
    return result.ok
      ? { ok: result.data.ok, message: result.data.message }
      : { ok: false, message: result.error };
  },

  async sendBirthdayWish(targetUserId, wish) {
    const result = await api.post<{ ok: boolean; message: string }>("/api/birthdays/wish", {
      targetUserId,
      wish
    });
    return result.ok
      ? { ok: result.data.ok, message: result.data.message }
      : { ok: false, message: result.error };
  }
};
