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

describe("Mad Buddy service worker safety and reliability", () => {
  it("supports push, safe clicks, activation and subscription replacement", () => {
    expect(source).toContain('addEventListener("push"');
    expect(source).toContain('addEventListener("notificationclick"');
    expect(source).toContain('addEventListener("activate"');
    expect(source).toContain('addEventListener("pushsubscriptionchange"');
    expect(source).toContain("same-origin");
  });

  it("never introduces private application caching", () => {
    expect(source).not.toMatch(/\bcaches\.(?:open|match|put|delete)\b/);
    expect(source).not.toContain("cache.add");
    expect(source).not.toContain("cacheFirst");
  });

  it("rejects untrusted notification destinations", () => {
    expect(source).toContain("parsed.origin === self.location.origin");
    expect(source).toContain("clients.matchAll");
    expect(source).toContain("client.navigate(url)");
    expect(source).toContain("clients.openWindow(url)");
  });

  it("waits for readiness and exposes a deliberate update lifecycle", () => {
    expect(pushToggle).toContain("navigator.serviceWorker.ready");
    expect(registration).toContain("updatefound");
    expect(registration).toContain("controllerchange");
    expect(registration).toContain("SKIP_WAITING");
    expect(source).toContain("SKIP_WAITING");
  });
});
