import type { DevicePlatform } from "@/lib/pwa/install";

/**
 * OS-aware instructions for re-enabling a BLOCKED location permission.
 *
 * Important platform reality: a web page / installed PWA cannot open the
 * phone's Settings app or a specific settings pane — browsers forbid it for
 * security. So when the user has already denied location, the only honest,
 * reliable help is precise, per-OS steps telling them exactly where to tap.
 * (A native Capacitor build CAN deep-link into app settings; that path is
 * layered on separately and is not what this covers.)
 *
 * Pure and deterministic so the exact copy is unit-tested and never drifts.
 */

export type LocationEnableGuide = {
  title: string;
  /** Ordered "do this, then that" steps. */
  steps: string[];
  /** Reminder that system-wide Location Services may also be off. */
  systemNote: string;
  /** Label for the action that re-checks the permission after the user acts. */
  recheckLabel: string;
};

const RECHECK = "I've turned it on — check again";

export function locationEnableGuide(
  device: DevicePlatform,
  standalone: boolean,
  appName = "Mad Buddy"
): LocationEnableGuide {
  if (device.platform === "ios") {
    if (standalone) {
      // Added to the Home Screen: modern iOS lists the installed web app in
      // Settings with its own Location toggle.
      return {
        title: `Turn on location for ${appName}`,
        steps: [
          "Open the iPhone Settings app.",
          `Scroll down and tap ${appName} (near your other apps).`,
          "Tap Location.",
          'Choose "While Using the App".',
          `Reopen ${appName} and tap "${RECHECK}".`
        ],
        systemNote:
          'If you don\'t see it, open Settings → Privacy & Security → Location Services and make sure Location Services is on.',
        recheckLabel: RECHECK
      };
    }
    return {
      title: "Turn on location in Safari",
      steps: [
        "Open the iPhone Settings app.",
        "Tap Privacy & Security → Location Services, and make sure it's on.",
        'Still there, tap Safari Websites → choose "While Using the App".',
        `Go back to ${appName} in Safari, tap the "aA" icon in the address bar → Website Settings → Location → Allow.`,
        `Reload the page and tap "${RECHECK}".`
      ],
      systemNote: "Location Services must be on for Safari to ask at all.",
      recheckLabel: RECHECK
    };
  }

  if (device.platform === "android") {
    if (standalone) {
      // Installed PWAs on Android become real app entries.
      return {
        title: `Turn on location for ${appName}`,
        steps: [
          "Make sure the device location is on: open Settings → Location → turn it On.",
          `Press and hold the ${appName} app icon, then tap App info (ⓘ).`,
          "Tap Permissions → Location.",
          'Choose "Allow only while using the app".',
          `Reopen ${appName} and tap "${RECHECK}".`
        ],
        systemNote: "You can also reach this from Settings → Apps → " + appName + " → Permissions → Location.",
        recheckLabel: RECHECK
      };
    }
    return {
      title: "Turn on location in your browser",
      steps: [
        "Make sure the device location is on: swipe down and tap Location (or Settings → Location → On).",
        "Tap the lock or tune icon at the left of the address bar.",
        "Tap Permissions (or Site settings) → Location.",
        `Set it to Allow for ${appName}.`,
        `Reload the page and tap "${RECHECK}".`
      ],
      systemNote: "In Chrome you can also use the ⋮ menu → Settings → Site settings → Location.",
      recheckLabel: RECHECK
    };
  }

  // Desktop / anything else.
  return {
    title: "Turn on location for this site",
    steps: [
      "Click the location or lock icon at the left of the address bar.",
      "Set Location to Allow for this site.",
      "If your browser also asks, allow the location request.",
      `Reload the page and click "${RECHECK}".`
    ],
    systemNote:
      "On macOS, also check System Settings → Privacy & Security → Location Services and enable it for your browser.",
    recheckLabel: RECHECK
  };
}
