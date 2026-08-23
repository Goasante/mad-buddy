/* Mad Buddy service worker. It stores no page or user data. Requests remain
 * network-only while the worker supports PWA installation and web push.
 *
 * The ONE cached resource is /offline.html: a static, self-contained page with
 * no user data in it, shown when a NAVIGATION cannot reach the network
 * (MB-GOD-041). Nothing else is ever cached -- no API responses, no RSC
 * payloads, no HTML for a real route. A cached Muddy list or conversation
 * would outlive sign-out in the browser's cache, so the network-only stance
 * for everything else is deliberate and stays. */

// Changing this protocol marker makes the hardening deployment itself visible
// to existing registrations. Future ordinary application deployments are also
// detected through /api/version, even when this file remains byte-identical.
const WORKER_PROTOCOL_VERSION = "network-only-v3-offline-shell";

/* Bumping the cache name is what retires the previous shell. It holds exactly
 * one entry, so this is cheap and cannot accumulate. */
const OFFLINE_CACHE = "mad-buddy-offline-v1";
const OFFLINE_URL = "/offline.html";
/* Its script is a separate file because the app enforces a nonce-based CSP and
 * a worker-served static page has no request through which a nonce could be
 * issued. Both are precached: a shell whose script 404s offline would render
 * but never recover. */
const OFFLINE_ASSETS = [OFFLINE_URL, "/offline.js"];

self.addEventListener("install", (event) => {
  // Do not call skipWaiting automatically. The app prompts first so an active
  // form or conversation is not reloaded underneath the user.
  //
  // The shell is fetched at install so it is present before it is needed --
  // by definition it cannot be fetched at the moment it is required.
  event.waitUntil(
    caches.open(OFFLINE_CACHE)
      .then((cache) => cache.addAll(
        OFFLINE_ASSETS.map((url) => new Request(url, { cache: "reload" }))
      ))
      // A failed precache must not block activation: the worker still has push
      // and installability to deliver, and the offline shell is an enhancement.
      .catch(() => undefined)
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      // Drop any earlier offline cache generation, so an old shell cannot be
      // served by a new worker.
      const names = await caches.keys();
      await Promise.all(
        names.filter((n) => n.startsWith("mad-buddy-offline-") && n !== OFFLINE_CACHE)
          .map((n) => caches.delete(n))
      );
      await self.clients.claim();
    })()
  );
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") self.skipWaiting();
  if (event.data?.type === "GET_WORKER_VERSION") {
    event.ports?.[0]?.postMessage({ version: WORKER_PROTOCOL_VERSION });
  }
});

self.addEventListener("fetch", (event) => {
  /* NAVIGATIONS: network first, offline shell only as the failure answer.
   *
   * Handled BEFORE the early return below, which previously skipped navigation
   * entirely and so left the browser to render its own error page -- outside
   * the app, with no way back in an installed PWA (MB-GOD-041).
   *
   * The network is always tried first and its response is passed through
   * untouched, so this never serves a stale or cached version of a real page.
   * The shell appears only when the fetch genuinely fails. A server error
   * (500, 404) is a real response and is NOT replaced -- the app's own error
   * boundary should handle those, and masking them as "offline" would be a
   * lie. */
  if (event.request.mode === "navigate") {
    event.respondWith(
      fetch(event.request).catch(async () => {
        const cached = await caches.match(OFFLINE_URL);
        return cached ?? Response.error();
      })
    );
    return;
  }

  if (event.request.method !== "GET") return;

  /* The offline shell's own script, when the network is gone. Without this the
   * shell renders but its Retry button and auto-recovery never load -- a page
   * that says "Try again" beside a button that does nothing. */
  if (event.request.url.endsWith("/offline.js")) {
    event.respondWith(
      fetch(event.request).catch(async () => (await caches.match("/offline.js")) ?? Response.error())
    );
    return;
  }
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
      badge: "/icons/notification-badge.png",
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
