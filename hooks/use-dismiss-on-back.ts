"use client";

import { useEffect } from "react";

/**
 * Makes a hardware/browser Back press dismiss an open overlay (bottom sheet)
 * instead of navigating away from the app — the behaviour a native mobile sheet
 * has. While `open`, one sentinel history entry is pushed; a Back press pops it
 * and calls `onDismiss`. Closing the sheet by any other means (tap-outside,
 * Escape, the close button) removes that sentinel again so no dead entry is
 * left behind.
 *
 * The pushState keeps the current URL, so route-watching chrome (the mobile
 * nav, the navigation watchdog) sees no navigation.
 */
export function useDismissOnBack(open: boolean, onDismiss: () => void) {
  useEffect(() => {
    if (!open || typeof window === "undefined") return;

    window.history.pushState({ mbSheet: true }, "");
    const handlePopState = () => onDismiss();
    window.addEventListener("popstate", handlePopState);

    return () => {
      window.removeEventListener("popstate", handlePopState);
      // If our sentinel is still the current entry, the sheet was closed via UI
      // (not Back) — pop it so history stays clean. When Back closed the sheet
      // the sentinel is already gone, so this is skipped.
      if (window.history.state?.mbSheet) window.history.back();
    };
  }, [open, onDismiss]);
}
