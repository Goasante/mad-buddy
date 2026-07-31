import { useEffect } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Capacitor } from "@capacitor/core";
import { App } from "@capacitor/app";
import { dismissTopOverlay } from "../lib/overlay";

// Routes whose canonical back destination is fixed, regardless of raw
// browser/webview history (which can point at whatever tab the user visited
// before opening this route, e.g. Plans). Checked with startsWith.
const CANONICAL_BACK_TARGETS: Array<{ prefix: string; to: string }> = [{ prefix: "/messages/", to: "/messages" }];

/**
 * One place that owns the Android hardware back button (and Escape on
 * keyboards). Priority: close the top open overlay → go to the current
 * route's canonical back target (if any) → navigate back within the SPA →
 * exit the app at the root. Mounted once, near the router root.
 */
export function useAndroidBack(): void {
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    let remove: (() => void) | undefined;

    if (Capacitor.isNativePlatform()) {
      void App.addListener("backButton", () => {
        if (dismissTopOverlay()) return; // an overlay was open — closed it, stay put

        const canonical = CANONICAL_BACK_TARGETS.find((entry) => location.pathname.startsWith(entry.prefix));
        if (canonical) {
          navigate(canonical.to);
          return;
        }

        if (window.history.length > 1) navigate(-1);
        else void App.exitApp();
      }).then((handle) => {
        remove = () => void handle.remove();
      });
    }

    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") dismissTopOverlay();
    };
    window.addEventListener("keydown", onKey);

    return () => {
      remove?.();
      window.removeEventListener("keydown", onKey);
    };
  }, [navigate, location.pathname]);
}
