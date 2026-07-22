/* Mad Buddy service worker. It stores no page or user data. Requests remain
 * network-only while the worker supports PWA installation and web push. */

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET" || event.request.mode === "navigate") return;
  event.respondWith(fetch(event.request));
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
