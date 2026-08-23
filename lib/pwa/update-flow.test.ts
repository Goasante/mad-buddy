import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function source(path: string) {
  return readFileSync(join(process.cwd(), path), "utf8");
}

describe("existing installed PWA update flow", () => {
  const registration = source(
    "components/pwa/service-worker-registration.tsx"
  );
  const worker = source("public/sw.js");

  it("detects waiting workers and application builds that changed without a worker edit", () => {
    expect(registration).toContain("registration.waiting");
    expect(registration).toContain('registration.addEventListener("updatefound"');
    expect(registration).toContain('fetchWithTimeout(`/api/version?check=${Date.now()}`');
    expect(registration).toContain("updateCheckInFlight");
    expect(registration).toContain("shouldOfferBuildUpdate");
  });

  it("revalidates on launch, foreground, connectivity, and a bounded interval", () => {
    expect(registration).toContain('window.addEventListener("pageshow"');
    expect(registration).toContain('window.addEventListener("focus"');
    expect(registration).toContain('document.addEventListener("visibilitychange"');
    expect(registration).toContain('window.addEventListener("online"');
    expect(registration).toContain("UPDATE_CHECK_INTERVAL_MS");
    expect(registration).toContain('updateViaCache: "none"');
  });

  it("activates a waiting worker and permits only one controlled reload", () => {
    expect(registration).toContain('worker.postMessage({ type: "SKIP_WAITING" })');
    expect(registration).toContain('navigator.serviceWorker.addEventListener');
    expect(registration).toContain('"controllerchange"');
    expect(registration).toContain("shouldReloadForControllerChange");
    expect(registration).toContain("reloadTriggered.current = true");
    expect(registration).toContain("CONTROLLER_CHANGE_FALLBACK_MS");
  });

  it("quietly activates a worker that already matches the running application build", () => {
    expect(registration).toContain("workerTargetsBuild");
    expect(registration).toContain(
      'registration.waiting.postMessage({ type: "SKIP_WAITING" })'
    );
  });

  it("keeps the worker network-only and activates only after confirmation", () => {
    expect(worker).toContain('addEventListener("install"');
    expect(worker).toContain('event.data?.type === "SKIP_WAITING"');
    expect(worker).toContain("self.clients.claim()");
    /* See lib/security/session-storage.test.ts for the canonical rule: the
       worker may precache /offline.html and /offline.js and nothing else
       (MB-GOD-041). `cache.addAll` of those two static files is expected; a
       caches.put of a fetched response is what must never appear. */
    expect(worker).not.toMatch(/\bcaches\.\s*put\b/);
  });

  it("uses revalidating production headers for worker and manifest", () => {
    const config = source("next.config.ts");
    expect(config).toContain('source: "/sw.js"');
    expect(config).toContain("no-store, no-cache, must-revalidate");
    expect(config).toContain('source: "/manifest.webmanifest"');
    expect(config).toContain("Service-Worker-Allowed");
  });

  it("serves a public, non-cached deployment identifier", () => {
    const route = source("app/api/version/route.ts");
    expect(route).toContain("resolveBuildId(process.env)");
    expect(route).toContain('"Cache-Control": "no-store, max-age=0"');
  });

  it("makes previously installed standalone users eligible for notification onboarding", () => {
    const prompt = source("components/pwa/enable-notifications-prompt.tsx");
    expect(prompt).toContain('window.matchMedia("(display-mode: standalone)")');
    expect(prompt).toContain("navigatorStandalone");
    expect(prompt).not.toContain("INSTALL_CONFIRMED_KEY");
    expect(prompt).not.toContain("INSTALL_DISMISSED_AT_KEY");
  });
});
