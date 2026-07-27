import { describe, expect, it } from "vitest";
import { locationEnableGuide } from "@/lib/location/enable-guidance";
import type { DevicePlatform } from "@/lib/pwa/install";

const ios: DevicePlatform = { platform: "ios", iosBrowser: "safari", isWebView: false };
const android: DevicePlatform = { platform: "android", iosBrowser: null, isWebView: false };
const desktop: DevicePlatform = { platform: "desktop", iosBrowser: null, isWebView: false };

describe("locationEnableGuide", () => {
  it("gives Safari website steps for iOS in a browser tab", () => {
    const guide = locationEnableGuide(ios, false);
    expect(guide.title).toMatch(/safari/i);
    expect(guide.steps.join(" ")).toMatch(/Location Services/);
    expect(guide.steps.join(" ")).toMatch(/aA/); // the Safari page-settings icon
  });

  it("points an installed iOS PWA at its own Settings entry", () => {
    const guide = locationEnableGuide(ios, true, "Mad Buddy");
    expect(guide.steps.join(" ")).toMatch(/tap Mad Buddy/i);
    expect(guide.steps.join(" ")).toMatch(/While Using the App/);
  });

  it("gives Android browser site-permission steps", () => {
    const guide = locationEnableGuide(android, false);
    expect(guide.steps.join(" ")).toMatch(/address bar/i);
    expect(guide.steps.join(" ")).toMatch(/Location/);
    expect(guide.systemNote).toMatch(/Site settings/i);
  });

  it("points an installed Android PWA at App info → Permissions", () => {
    const guide = locationEnableGuide(android, true, "Mad Buddy");
    expect(guide.steps.join(" ")).toMatch(/App info/i);
    expect(guide.steps.join(" ")).toMatch(/Permissions/);
    expect(guide.steps.join(" ")).toMatch(/only while using the app/i);
  });

  it("falls back to browser address-bar steps on desktop", () => {
    const guide = locationEnableGuide(desktop, false);
    expect(guide.steps.join(" ")).toMatch(/address bar/i);
    expect(guide.systemNote).toMatch(/macOS/);
  });

  it("always reminds about system-wide Location Services and offers a re-check", () => {
    for (const device of [ios, android, desktop]) {
      for (const standalone of [false, true]) {
        const guide = locationEnableGuide(device, standalone);
        expect(guide.systemNote.length).toBeGreaterThan(0);
        expect(guide.steps.length).toBeGreaterThanOrEqual(3);
        expect(guide.recheckLabel).toBeTruthy();
        // The steps always end by telling the user to re-check.
        expect(guide.steps[guide.steps.length - 1]).toContain(guide.recheckLabel);
      }
    }
  });

  it("never claims it can open Settings automatically (web can't)", () => {
    for (const device of [ios, android, desktop]) {
      const guide = locationEnableGuide(device, false);
      const text = [guide.title, ...guide.steps, guide.systemNote].join(" ").toLowerCase();
      expect(text).not.toMatch(/we('|)ll open|opening settings for you|tap here to open settings/);
    }
  });
});
