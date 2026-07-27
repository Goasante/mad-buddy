"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  detectDevicePlatform,
  INSTALL_CONFIRMED_KEY,
  INSTALL_DISMISSED_AT_KEY,
  INSTALL_SHOWN_SESSION_KEY,
  installationHintIsFresh,
  isStandaloneDisplay,
  requestNativeInstall,
  shouldOfferInstall,
  type BeforeInstallPromptLike,
  type DevicePlatform
} from "@/lib/pwa/install";

type BeforeInstallPromptEvent = Event & BeforeInstallPromptLike;
type NavigatorWithInstallState = Navigator & { standalone?: boolean; getInstalledRelatedApps?: () => Promise<unknown[]> };
type WindowWithCapacitor = Window & { Capacitor?: { isNativePlatform?: () => boolean } };

const INITIAL_DEVICE: DevicePlatform = { platform: "unsupported", iosBrowser: null, isWebView: false };

export function usePWAInstall(delayMs = 4000) {
  const deferredPrompt = useRef<BeforeInstallPromptEvent | null>(null);
  const [device, setDevice] = useState<DevicePlatform>(INITIAL_DEVICE);
  const [visible, setVisible] = useState(false);
  const [nativePromptAvailable, setNativePromptAvailable] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [installed, setInstalled] = useState(false);

  const markInstalled = useCallback(() => {
    window.localStorage.setItem(INSTALL_CONFIRMED_KEY, String(Date.now()));
    deferredPrompt.current = null;
    setNativePromptAvailable(false);
    setInstalled(true);
    setVisible(false);
  }, []);

  useEffect(() => {
    if ((window as WindowWithCapacitor).Capacitor?.isNativePlatform?.()) return;

    const installNavigator = navigator as NavigatorWithInstallState;
    const detectedDevice = detectDevicePlatform({
      userAgent: navigator.userAgent,
      platform: navigator.platform,
      maxTouchPoints: navigator.maxTouchPoints
    });
    const standalone = isStandaloneDisplay({
      displayModeStandalone: window.matchMedia("(display-mode: standalone)").matches,
      navigatorStandalone: installNavigator.standalone
    });
    const installedHint = window.localStorage.getItem(INSTALL_CONFIRMED_KEY);
    const installedHintFresh = installationHintIsFresh(installedHint);
    if (installedHint && !installedHintFresh) {
      window.localStorage.removeItem(INSTALL_CONFIRMED_KEY);
    }
    const stateTimer = window.setTimeout(() => {
      setDevice(detectedDevice);
      setInstalled(standalone);
    }, 0);

    let cancelled = false;
    let knownInstalled = standalone;

    function handleBeforeInstallPrompt(event: Event) {
      const installEvent = event as BeforeInstallPromptEvent;
      installEvent.preventDefault();
      deferredPrompt.current = installEvent;
      // The browser proving the app is installable is stronger than a stale
      // local hint left behind by an earlier installation.
      window.localStorage.removeItem(INSTALL_CONFIRMED_KEY);
      setNativePromptAvailable(true);
    }

    function handleAppInstalled() {
      knownInstalled = true;
      markInstalled();
      window.dispatchEvent(new Event("mad-buddy:pwa-installed"));
    }

    window.addEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
    window.addEventListener("appinstalled", handleAppInstalled);

    const installedAppsPromise = installNavigator.getInstalledRelatedApps?.();
    if (installedAppsPromise) {
      void installedAppsPromise
        .then((apps) => {
          if (cancelled || apps.length === 0) return;
          knownInstalled = true;
          markInstalled();
        })
        .catch(() => {});
    }

    const timer = window.setTimeout(() => {
      if (cancelled || knownInstalled) return;
      const eligible = shouldOfferInstall({
        device: detectedDevice,
        standalone,
        // A persisted timestamp is only a short-lived supporting hint. A
        // fresh native install event is stronger evidence that the app is
        // currently installable, including after an uninstall.
        installed: standalone || (installedHintFresh && !deferredPrompt.current),
        dismissedAt: window.localStorage.getItem(INSTALL_DISMISSED_AT_KEY),
        shownThisSession: window.sessionStorage.getItem(INSTALL_SHOWN_SESSION_KEY) === "true"
      });
      if (!eligible) return;
      window.sessionStorage.setItem(INSTALL_SHOWN_SESSION_KEY, "true");
      setVisible(true);
    }, delayMs);

    return () => {
      cancelled = true;
      window.clearTimeout(stateTimer);
      window.clearTimeout(timer);
      window.removeEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
      window.removeEventListener("appinstalled", handleAppInstalled);
    };
  }, [delayMs, markInstalled]);

  const dismiss = useCallback(() => {
    window.localStorage.setItem(INSTALL_DISMISSED_AT_KEY, String(Date.now()));
    setVisible(false);
  }, []);

  const install = useCallback(async () => {
    const event = deferredPrompt.current;
    if (!event) return "unavailable" as const;
    setInstalling(true);
    try {
      const outcome = await requestNativeInstall(event);
      deferredPrompt.current = null;
      setNativePromptAvailable(false);
      if (outcome === "accepted") markInstalled();
      else dismiss();
      return outcome;
    } finally {
      setInstalling(false);
    }
  }, [dismiss, markInstalled]);

  return useMemo(
    () => ({ device, visible, nativePromptAvailable, installing, installed, dismiss, install }),
    [device, visible, nativePromptAvailable, installing, installed, dismiss, install]
  );
}
