import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Capacitor } from "@capacitor/core";
import { App } from "@capacitor/app";
import { dismissTopOverlay } from "../lib/overlay";

/**
 * One place that owns the Android hardware back button (and Escape on
 * keyboards). Priority: close the top open overlay → navigate back within the
 * SPA → exit the app at the root. Mounted once, near the router root.
 */
export function useAndroidBack(): void {
  const navigate = useNavigate();

  useEffect(() => {
    let remove: (() => void) | undefined;

    if (Capacitor.isNativePlatform()) {
      void App.addListener("backButton", () => {
        if (dismissTopOverlay()) return; // an overlay was open — closed it, stay put
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
  }, [navigate]);
}
