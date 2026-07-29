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
 *
 * ⚠️ NEVER use this on an overlay that contains navigation links (<Link>, or
 * anything calling router.push). Closing such an overlay is itself part of the
 * click that STARTS a navigation, so the cleanup below fires history.back()
 * while an App Router client transition is still in flight — the RSC payload
 * has not arrived, so Next has not committed its own history entry yet, our
 * sentinel is still the current entry, the guard passes, and the pop reverses
 * the navigation. The route never commits, the pathname never changes, and the
 * 15s NavigationWatchdog fires "navigation did not complete". A hard reload
 * (the watchdog's Retry) then works, which makes this look like a slow server
 * rather than a cancelled transition.
 *
 * This is safe for sheets/modals/pickers whose contents are forms, options or
 * actions — the overwhelming majority of callers. It is NOT safe for menus.
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
