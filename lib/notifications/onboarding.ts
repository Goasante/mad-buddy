import type { DevicePlatform } from "@/lib/pwa/install";

export const NOTIFICATION_ONBOARDING_DISMISS_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000;
export const NOTIFICATION_ONBOARDING_DISMISSED_PREFIX =
  "madbuddy-notification-onboarding-dismissed-at";
export const NOTIFICATION_ONBOARDING_COMPLETED_PREFIX =
  "madbuddy-notification-onboarding-completed";
export const NOTIFICATION_ONBOARDING_SHOWN_PREFIX =
  "mad-buddy:notification-onboarding-shown";

export type NotificationPermissionState = NotificationPermission | "unsupported";

function notificationOnboardingAccountScope(userId: string) {
  // Keep the raw account UUID out of browser-storage keys. This is not used
  // for security or authorization, only to isolate non-sensitive prompt
  // cooldown state between accounts sharing one device.
  let hash = 2_166_136_261;
  for (let index = 0; index < userId.length; index += 1) {
    hash ^= userId.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return (hash >>> 0).toString(36);
}

export function notificationOnboardingStorageKey(prefix: string, userId: string) {
  return `${prefix}:${notificationOnboardingAccountScope(userId)}`;
}

export function notificationOnboardingDismissalIsCoolingDown(
  dismissedAt: string | null,
  now = Date.now(),
  cooldownMs = NOTIFICATION_ONBOARDING_DISMISS_COOLDOWN_MS
) {
  if (!dismissedAt) return false;
  const timestamp = Number(dismissedAt);
  return Number.isFinite(timestamp) && timestamp > 0 && now - timestamp < cooldownMs;
}

export function shouldOfferNotificationOnboarding(input: {
  authenticated: boolean;
  device: DevicePlatform;
  installedOrJustInstalled: boolean;
  permission: NotificationPermissionState;
  pushConfigured: boolean;
  completed: boolean;
  dismissedAt: string | null;
  shownThisSession: boolean;
  now?: number;
}) {
  if (
    !input.authenticated ||
    !input.installedOrJustInstalled ||
    input.pushConfigured ||
    input.completed
  ) {
    return false;
  }
  if (input.device.platform !== "android" && input.device.platform !== "ios") {
    return false;
  }
  if (
    input.device.isWebView ||
    (input.permission !== "default" && input.permission !== "denied") ||
    input.shownThisSession
  ) {
    return false;
  }
  return !notificationOnboardingDismissalIsCoolingDown(
    input.dismissedAt,
    input.now
  );
}
