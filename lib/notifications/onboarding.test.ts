import { describe, expect, it } from "vitest";
import {
  NOTIFICATION_ONBOARDING_DISMISS_COOLDOWN_MS,
  notificationOnboardingDismissalIsCoolingDown,
  notificationOnboardingStorageKey,
  shouldOfferNotificationOnboarding
} from "@/lib/notifications/onboarding";
import type { DevicePlatform } from "@/lib/pwa/install";

const android: DevicePlatform = {
  platform: "android",
  iosBrowser: null,
  isWebView: false
};
const iphone: DevicePlatform = {
  platform: "ios",
  iosBrowser: "safari",
  isWebView: false
};

const eligible = {
  authenticated: true,
  device: android,
  installedOrJustInstalled: true,
  permission: "default" as const,
  pushConfigured: false,
  completed: false,
  dismissedAt: null,
  shownThisSession: false
};

describe("notification onboarding eligibility", () => {
  it("offers the flow to authenticated installed Android and iOS users", () => {
    expect(shouldOfferNotificationOnboarding(eligible)).toBe(true);
    expect(
      shouldOfferNotificationOnboarding({ ...eligible, device: iphone })
    ).toBe(true);
  });

  it("does not appear before installation or in an embedded webview", () => {
    expect(
      shouldOfferNotificationOnboarding({
        ...eligible,
        installedOrJustInstalled: false
      })
    ).toBe(false);
    expect(
      shouldOfferNotificationOnboarding({
        ...eligible,
        device: { ...android, isWebView: true }
      })
    ).toBe(false);
  });

  it("does not appear when signed out, configured, or already granted", () => {
    expect(
      shouldOfferNotificationOnboarding({ ...eligible, authenticated: false })
    ).toBe(false);
    expect(
      shouldOfferNotificationOnboarding({ ...eligible, pushConfigured: true })
    ).toBe(false);
    expect(
      shouldOfferNotificationOnboarding({ ...eligible, permission: "granted" })
    ).toBe(false);
    expect(
      shouldOfferNotificationOnboarding({ ...eligible, completed: true })
    ).toBe(false);
  });

  it("shows settings guidance to an installed user whose permission is denied", () => {
    expect(
      shouldOfferNotificationOnboarding({ ...eligible, permission: "denied" })
    ).toBe(true);
  });

  it("honours the user-specific reminder cooldown and once-per-session state", () => {
    const now = Date.UTC(2026, 6, 27);
    expect(
      shouldOfferNotificationOnboarding({
        ...eligible,
        dismissedAt: String(now - 1_000),
        now
      })
    ).toBe(false);
    expect(
      shouldOfferNotificationOnboarding({
        ...eligible,
        dismissedAt: String(
          now - NOTIFICATION_ONBOARDING_DISMISS_COOLDOWN_MS - 1
        ),
        now
      })
    ).toBe(true);
    expect(
      shouldOfferNotificationOnboarding({
        ...eligible,
        shownThisSession: true
      })
    ).toBe(false);
  });

  it("keeps dismissal state separate for each account", () => {
    const first = notificationOnboardingStorageKey("dismissed", "user-a");
    const second = notificationOnboardingStorageKey("dismissed", "user-b");
    expect(first).not.toBe(second);
    expect(first).not.toContain("user-a");
    expect(second).not.toContain("user-b");
  });

  it("rejects malformed dismissal timestamps", () => {
    expect(notificationOnboardingDismissalIsCoolingDown("not-a-time")).toBe(false);
  });

  it("does not depend on an install timestamp or a newly installed flag", () => {
    expect(
      shouldOfferNotificationOnboarding({
        ...eligible,
        installedOrJustInstalled: true,
        dismissedAt: null
      })
    ).toBe(true);
  });
});
