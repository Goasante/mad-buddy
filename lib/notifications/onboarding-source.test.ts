import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function source(path: string) {
  return readFileSync(join(process.cwd(), path), "utf8");
}

describe("notification onboarding integration", () => {
  it("reuses one browser push hook in onboarding and Settings", () => {
    const prompt = source("components/pwa/enable-notifications-prompt.tsx");
    const settings = source("components/settings/push-toggle.tsx");
    expect(prompt).toContain('from "@/hooks/use-browser-push"');
    expect(settings).toContain('from "@/hooks/use-browser-push"');
  });

  it("requests permission only from the explicit enable action", () => {
    const hook = source("hooks/use-browser-push.ts");
    const prompt = source("components/pwa/enable-notifications-prompt.tsx");
    expect(hook).toContain("Notification.requestPermission()");
    expect(prompt).toContain('onClick={requestPermission}');
    expect(prompt).not.toContain("Notification.requestPermission()");
  });

  it("waits for the worker, persists ownership, and rolls back failed persistence", () => {
    const hook = source("hooks/use-browser-push.ts");
    expect(hook).toContain("navigator.serviceWorker.ready");
    expect(hook).toContain("savePushSubscriptionAction");
    expect(hook).toContain("await subscription.unsubscribe()");
  });

  it("provides OS-specific, accessible, privacy-safe onboarding", () => {
    const prompt = source("components/pwa/enable-notifications-prompt.tsx");
    expect(prompt).toContain("Stay Connected");
    expect(prompt).toContain("Enable Notifications");
    expect(prompt).toContain("Safe Arrival");
    expect(prompt).toContain(
      "You can enable them from Settings, Notifications, Mad Buddy."
    );
    expect(prompt).toContain(
      "You can enable them from your device or browser notification settings for Mad Buddy."
    );
    expect(prompt).toContain("aria-label");
    expect(prompt).not.toMatch(/["'`]coordinates|["'`]exact location|["'`]GPS/i);
  });

  it("connects the install event and reduced-motion success styling", () => {
    expect(source("hooks/use-pwa-install.ts")).toContain(
      'new Event("mad-buddy:pwa-installed")'
    );
    const css = source("app/globals.css");
    expect(css).toContain(".notification-bell-success");
    expect(css).toContain("@media (prefers-reduced-motion: reduce)");
  });
});
