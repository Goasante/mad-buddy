/* Mad Buddy service worker: web push display only. No caching, no fetch
 * interception — the page behaves identically with or without it. */

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
      icon: "/favicon.ico",
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
