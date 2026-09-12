import { fetchWithTimeout } from "@/lib/network/resilience";
import type {
  NotificationDeleteResult,
  NotificationRecord,
  NotificationWriteResult,
  NotificationsClient
} from "@/lib/notifications/client";

/**
 * The web app's notifications transport: same-origin relative paths and the
 * session cookie.
 *
 * This is a faithful move of the fetch calls that used to sit inside
 * NotificationsPageContent -- same endpoints, same methods, same 12s timeout
 * and the same operation labels, which appear in timeout diagnostics. The
 * behaviour people see is unchanged; only the location moved.
 */
const TIMEOUT_MS = 12_000;

const json = { "Content-Type": "application/json" } as const;

export function createWebNotificationsClient(
  actions: Pick<
    NotificationsClient,
    "respondToPing" | "sendBirthdayWish" | "saveNotificationPreferences"
  >
): NotificationsClient {
  return {
    async load() {
      try {
        const response = await fetchWithTimeout(
          "/api/notifications",
          { credentials: "include", cache: "no-store" },
          TIMEOUT_MS,
          "load notifications"
        );
        if (!response.ok) return null;
        const data = (await response.json()) as { notifications: NotificationRecord[] };
        return data.notifications ?? [];
      } catch {
        return null;
      }
    },

    async markAllRead() {
      try {
        const response = await fetchWithTimeout(
          "/api/notifications/read",
          { method: "PATCH", headers: json, body: JSON.stringify({}) },
          TIMEOUT_MS,
          "mark all notifications read"
        );
        return { ok: response.ok };
      } catch {
        return { ok: false };
      }
    },

    async markRead(notificationId) {
      try {
        const response = await fetchWithTimeout(
          "/api/notifications/read",
          { method: "PATCH", headers: json, body: JSON.stringify({ notificationId }) },
          TIMEOUT_MS,
          "mark notification read"
        );
        return { ok: response.ok };
      } catch {
        return { ok: false };
      }
    },

    async setReadState(ids, isRead) {
      try {
        const response = await fetchWithTimeout(
          "/api/notifications/read",
          { method: "PATCH", headers: json, body: JSON.stringify({ ids, isRead }) },
          TIMEOUT_MS,
          "update selected notifications"
        );
        return { ok: response.ok };
      } catch {
        return { ok: false };
      }
    },

    async remove(ids) {
      try {
        const response = await fetchWithTimeout(
          "/api/notifications",
          { method: "DELETE", headers: json, body: JSON.stringify({ ids }) },
          TIMEOUT_MS,
          ids.length === 1 ? "delete notification" : "delete selected notifications"
        );
        const result = (await response.json().catch(() => null)) as { deletedIds?: string[] } | null;
        const deletedIds = result?.deletedIds ?? [];
        // An HTTP 200 that omits an id means that row was NOT deleted. The
        // caller compares this list against what it optimistically removed.
        return { ok: response.ok, deletedIds };
      } catch {
        return { ok: false, deletedIds: [] };
      }
    },

    // Server Actions, injected by the page: importing them here would drag
    // "use server" modules into any bundle that touches this file.
    respondToPing: actions.respondToPing,
    sendBirthdayWish: actions.sendBirthdayWish,
    saveNotificationPreferences: actions.saveNotificationPreferences
  } satisfies NotificationsClient;
}

export type { NotificationWriteResult, NotificationDeleteResult };
