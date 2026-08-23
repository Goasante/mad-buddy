import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";

const source = readFileSync(join(process.cwd(), "public", "sw.js"), "utf8");
const registration = readFileSync(
  join(process.cwd(), "components", "pwa", "service-worker-registration.tsx"),
  "utf8"
);
const pushToggle = readFileSync(
  join(process.cwd(), "components", "settings", "push-toggle.tsx"),
  "utf8"
);
const browserPush = readFileSync(
  join(process.cwd(), "hooks", "use-browser-push.ts"),
  "utf8"
);

describe("Mad Buddy service worker safety and reliability", () => {
  it("supports push, safe clicks, activation and subscription replacement", () => {
    expect(source).toContain('addEventListener("push"');
    expect(source).toContain('addEventListener("notificationclick"');
    expect(source).toContain('addEventListener("activate"');
    expect(source).toContain('addEventListener("pushsubscriptionchange"');
    expect(source).toContain("same-origin");
  });

  it("never introduces private application caching", () => {
    /* The test's NAME is the rule, and it is now asserted directly rather than
       through a blanket ban on the Cache API. The worker precaches two static
       files -- /offline.html and /offline.js -- so a navigation that cannot
       reach the network gets Mad Buddy's own offline page instead of the
       browser's error page (MB-GOD-041). Neither file contains user data.

       What would be PRIVATE caching, and still fails here:
         - caches.put(...) of a fetched response
         - a cache-first navigation handler
         - answering event.request from the cache
       The exact allowed URL list is pinned in
       lib/security/session-storage.test.ts, which fails if it ever grows. */
    expect(source).not.toMatch(/\bcaches\.\s*put\b/);
    expect(source).not.toMatch(/caches\s*\.\s*match\s*\(\s*event\.request/);
    expect(source).not.toContain("cacheFirst");

    // The network is always tried first for a navigation.
    const nav = source.slice(source.indexOf('event.request.mode === "navigate"'));
    expect(nav.indexOf("fetch(event.request)")).toBeLessThan(nav.indexOf("caches.match"));
  });

  it("rejects untrusted notification destinations", () => {
    expect(source).toContain("parsed.origin === self.location.origin");
    expect(source).toContain("clients.matchAll");
    expect(source).toContain("client.navigate(url)");
    expect(source).toContain("clients.openWindow(url)");
  });

  it("waits for readiness and exposes a deliberate update lifecycle", () => {
    expect(pushToggle).toContain("useBrowserPush");
    expect(browserPush).toContain("navigator.serviceWorker.ready");
    expect(registration).toContain("updatefound");
    expect(registration).toContain("controllerchange");
    expect(registration).toContain("SKIP_WAITING");
    expect(source).toContain("SKIP_WAITING");
  });
});
