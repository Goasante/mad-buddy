/* Mad Buddy service worker. It stores no page or user data. Requests remain
 * network-only while the worker supports PWA installation and web push. */

// Changing this protocol marker makes the hardening deployment itself visible
// to existing registrations. Future ordinary application deployments are also
// detected through /api/version, even when this file remains byte-identical.
const WORKER_PROTOCOL_VERSION = "network-only-v2";

self.addEventListener("install", () => {
  // Do not call skipWaiting automatically. The app prompts first so an active
  // form or conversation is not reloaded underneath the user.
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") self.skipWaiting();
  if (event.data?.type === "GET_WORKER_VERSION") {
    event.ports?.[0]?.postMessage({ version: WORKER_PROTOCOL_VERSION });
  }
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET" || event.request.mode === "navigate") return;
  // A bare `fetch(event.request)` here left any blocked/offline/failed
  // request (a third-party script blocked by CSP or an ad-blocker, a dropped
  // connection) as an unhandled promise rejection inside respondWith, which
  // both spams the console and turns that single request into a network
  // error. Still network-only (no caching added) — just fails safely.
  event.respondWith(
    fetch(event.request).catch(() => Response.error())
  );
});

self.addEventListener("push", (event) => {
  let payload = { title: "Mad Buddy", body: "You have a new notification.", url: "/notifications" };
  try {
    payload = { ...payload, ...event.data.json() };
  } catch {
    /* keep defaults */
  }
  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.body,
      icon: "/icons/pwa/icon-192.png",
      badge: "/icons/pwa/icon-192.png",
      data: { url: payload.url }
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const candidate = (event.notification.data && event.notification.data.url) || "/notifications";
  let url = "/notifications";
  try {
    const parsed = new URL(candidate, self.location.origin);
    if (parsed.origin === self.location.origin) url = `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    /* keep the safe same-origin fallback */
  }
  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then((windows) => {
      for (const client of windows) {
        if ("focus" in client) {
          client.navigate(url);
          return client.focus();
        }
      }
      return clients.openWindow(url);
    })
  );
});

self.addEventListener("pushsubscriptionchange", (event) => {
  event.waitUntil(
    (async () => {
      const oldSubscription = event.oldSubscription;
      if (!oldSubscription?.options) return;
      const replacement = await self.registration.pushManager.subscribe({
        userVisibleOnly: oldSubscription.options.userVisibleOnly,
        applicationServerKey: oldSubscription.options.applicationServerKey
      });
      const json = replacement.toJSON();
      const response = await fetch("/api/push-subscriptions", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          endpoint: replacement.endpoint,
          keys: json.keys,
          previousEndpoint: oldSubscription.endpoint
        })
      });
      if (!response.ok) await replacement.unsubscribe();
    })()
  );
});
