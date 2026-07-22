import { describe, expect, it, vi } from "vitest";
import {
  detectDevicePlatform,
  dismissalIsCoolingDown,
  INSTALL_DISMISS_COOLDOWN_MS,
  isStandaloneDisplay,
  requestNativeInstall,
  shouldOfferInstall
} from "@/lib/pwa/install";

const android = detectDevicePlatform({
  userAgent: "Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 Chrome/138.0 Mobile Safari/537.36"
});
const iosSafari = detectDevicePlatform({
  userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1",
  platform: "iPhone",
  maxTouchPoints: 5
});

describe("PWA platform detection", () => {
  it("detects Android browsers", () => {
    expect(android).toEqual({ platform: "android", iosBrowser: null, isWebView: false });
  });

  it("detects iPhone Safari", () => {
    expect(iosSafari).toEqual({ platform: "ios", iosBrowser: "safari", isWebView: false });
  });

  it("detects iPadOS when Safari reports a desktop platform", () => {
    expect(detectDevicePlatform({
      userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) AppleWebKit/605.1.15 Version/18.0 Safari/605.1.15",
      platform: "MacIntel",
      maxTouchPoints: 5
    }).platform).toBe("ios");
  });

  it("directs other iOS browsers to Safari", () => {
    expect(detectDevicePlatform({
      userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 CriOS/138.0 Mobile/15E148 Safari/604.1"
    }).iosBrowser).toBe("other");
  });
});

describe("PWA prompt eligibility", () => {
  it("recognises browser and iOS standalone modes", () => {
    expect(isStandaloneDisplay({ displayModeStandalone: true })).toBe(true);
    expect(isStandaloneDisplay({ displayModeStandalone: false, navigatorStandalone: true })).toBe(true);
  });

  it("does not offer installation when installed, standalone, or already shown", () => {
    const base = { device: android, dismissedAt: null };
    expect(shouldOfferInstall({ ...base, standalone: true, installed: false, shownThisSession: false })).toBe(false);
    expect(shouldOfferInstall({ ...base, standalone: false, installed: true, shownThisSession: false })).toBe(false);
    expect(shouldOfferInstall({ ...base, standalone: false, installed: false, shownThisSession: true })).toBe(false);
  });

  it("does not offer installation on desktop or in a mobile webview", () => {
    const common = { standalone: false, installed: false, dismissedAt: null, shownThisSession: false };
    expect(shouldOfferInstall({ ...common, device: { platform: "desktop", iosBrowser: null, isWebView: false } })).toBe(false);
    expect(shouldOfferInstall({ ...common, device: { platform: "android", iosBrowser: null, isWebView: true } })).toBe(false);
  });

  it("honours the seven-day dismissal cooldown", () => {
    const now = Date.UTC(2026, 6, 22);
    expect(dismissalIsCoolingDown(String(now - INSTALL_DISMISS_COOLDOWN_MS + 1), now)).toBe(true);
    expect(dismissalIsCoolingDown(String(now - INSTALL_DISMISS_COOLDOWN_MS), now)).toBe(false);
    expect(shouldOfferInstall({
      device: iosSafari,
      standalone: false,
      installed: false,
      dismissedAt: String(now - 1000),
      shownThisSession: false,
      now
    })).toBe(false);
  });

  it("offers the correct manual platforms when no native event is present", () => {
    const common = { standalone: false, installed: false, dismissedAt: null, shownThisSession: false };
    expect(shouldOfferInstall({ ...common, device: android })).toBe(true);
    expect(shouldOfferInstall({ ...common, device: iosSafari })).toBe(true);
  });
});

describe("native Android install", () => {
  it("opens the browser prompt and returns acceptance", async () => {
    const prompt = vi.fn().mockResolvedValue(undefined);
    const outcome = await requestNativeInstall({
      prompt,
      userChoice: Promise.resolve({ outcome: "accepted" })
    });
    expect(prompt).toHaveBeenCalledOnce();
    expect(outcome).toBe("accepted");
  });

  it("returns a browser dismissal", async () => {
    const outcome = await requestNativeInstall({
      prompt: vi.fn().mockResolvedValue(undefined),
      userChoice: Promise.resolve({ outcome: "dismissed" })
    });
    expect(outcome).toBe("dismissed");
  });
});
