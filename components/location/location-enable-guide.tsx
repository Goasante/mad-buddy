"use client";

import { MapPinOff } from "lucide-react";
import { useEffect, useState } from "react";
import { locationEnableGuide, type LocationEnableGuide } from "@/lib/location/enable-guidance";
import {
  detectDevicePlatform,
  isStandaloneDisplay,
  type DevicePlatform
} from "@/lib/pwa/install";

type NavigatorWithStandalone = Navigator & { standalone?: boolean };

const INITIAL_DEVICE: DevicePlatform = { platform: "desktop", iosBrowser: null, isWebView: false };

/**
 * Renders the OS-specific, step-by-step way to re-enable a BLOCKED location
 * permission. Shown when the browser reports the permission is denied — the
 * point at which a generic "allow it in your browser" message leaves people
 * stuck because they don't know where that setting lives.
 *
 * Detection runs client-side (there is no server-known OS), so it starts from
 * a neutral default and fills in on mount to avoid a hydration mismatch.
 */
export function LocationEnableGuide({ appName = "Mad Buddy" }: { appName?: string }) {
  const [guide, setGuide] = useState<LocationEnableGuide | null>(null);

  useEffect(() => {
    const device = detectDevicePlatform({
      userAgent: navigator.userAgent,
      platform: navigator.platform,
      maxTouchPoints: navigator.maxTouchPoints
    });
    const standalone = isStandaloneDisplay({
      displayModeStandalone: window.matchMedia("(display-mode: standalone)").matches,
      navigatorStandalone: (navigator as NavigatorWithStandalone).standalone
    });
    // Defer the state write out of the effect body (repo convention) to avoid a
    // synchronous cascading render.
    const frame = window.requestAnimationFrame(() =>
      setGuide(locationEnableGuide(device, standalone, appName))
    );
    return () => window.cancelAnimationFrame(frame);
  }, [appName]);

  const resolved = guide ?? locationEnableGuide(INITIAL_DEVICE, false, appName);

  return (
    <div className="rounded-xl border border-amber-400/25 bg-amber-400/10 p-4">
      <div className="flex items-start gap-3">
        <MapPinOff className="mt-0.5 h-5 w-5 shrink-0 text-amber-600 dark:text-amber-300" aria-hidden="true" />
        <div className="min-w-0">
          <p className="text-sm font-semibold">{resolved.title}</p>
          <ol className="mt-2 space-y-1.5">
            {resolved.steps.map((step, index) => (
              <li key={step} className="flex gap-2.5 text-sm leading-6 text-muted-foreground">
                <span
                  className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full bg-amber-400/20 text-xs font-semibold text-amber-700 dark:text-amber-200"
                  aria-hidden="true"
                >
                  {index + 1}
                </span>
                <span>{step}</span>
              </li>
            ))}
          </ol>
          <p className="mt-2.5 text-xs leading-5 text-muted-foreground">{resolved.systemNote}</p>
        </div>
      </div>
    </div>
  );
}
