export const INSTALL_DISMISSED_AT_KEY = "madbuddy-install-prompt-dismissed-at";
export const INSTALL_SHOWN_SESSION_KEY = "madbuddy-install-prompt-shown";
export const INSTALL_CONFIRMED_KEY = "madbuddy-app-installed";
export const INSTALL_DISMISS_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000;

export type MobilePlatform = "android" | "ios" | "desktop" | "unsupported";
export type IOSBrowser = "safari" | "other" | null;

export type DevicePlatform = {
  platform: MobilePlatform;
  iosBrowser: IOSBrowser;
  isWebView: boolean;
};

export type PlatformDetectionInput = {
  userAgent: string;
  platform?: string;
  maxTouchPoints?: number;
};

export function detectDevicePlatform({ userAgent, platform = "", maxTouchPoints = 0 }: PlatformDetectionInput): DevicePlatform {
  const isAndroid = /Android/i.test(userAgent);
  const isIPadDesktopMode = /MacIntel/i.test(platform) && maxTouchPoints > 1;
  const isIOS = /iPad|iPhone|iPod/i.test(userAgent) || isIPadDesktopMode;
  const isWebView =
    (isAndroid && /;\s*wv\)|\bwv\b/i.test(userAgent)) ||
    (isIOS && !/Safari/i.test(userAgent));

  if (isAndroid) return { platform: "android", iosBrowser: null, isWebView };
  if (isIOS) {
    const nonSafariBrowser = /CriOS|FxiOS|EdgiOS|OPiOS|DuckDuckGo/i.test(userAgent);
    return {
      platform: "ios",
      iosBrowser: nonSafariBrowser || isWebView ? "other" : "safari",
      isWebView
    };
  }
  return { platform: "desktop", iosBrowser: null, isWebView: false };
}

export function isStandaloneDisplay({ displayModeStandalone, navigatorStandalone = false }: {
  displayModeStandalone: boolean;
  navigatorStandalone?: boolean;
}) {
  return displayModeStandalone || navigatorStandalone;
}

export function dismissalIsCoolingDown(
  dismissedAt: string | null,
  now = Date.now(),
  cooldownMs = INSTALL_DISMISS_COOLDOWN_MS
) {
  if (!dismissedAt) return false;
  const timestamp = Number(dismissedAt);
  return Number.isFinite(timestamp) && timestamp > 0 && now - timestamp < cooldownMs;
}

export function shouldOfferInstall({ device, standalone, installed, dismissedAt, shownThisSession, now = Date.now() }: {
  device: DevicePlatform;
  standalone: boolean;
  installed: boolean;
  dismissedAt: string | null;
  shownThisSession: boolean;
  now?: number;
}) {
  if (device.platform !== "android" && device.platform !== "ios") return false;
  if (device.isWebView || standalone || installed || shownThisSession) return false;
  return !dismissalIsCoolingDown(dismissedAt, now);
}

export type BeforeInstallPromptLike = {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform?: string }>;
};

export async function requestNativeInstall(event: BeforeInstallPromptLike) {
  await event.prompt();
  const choice = await event.userChoice;
  return choice.outcome;
}
