"use client";

import { useEffect, useRef } from "react";

/**
 * Makes a hardware/browser Back press dismiss an open overlay (bottom sheet)
 * instead of navigating away from the app — the behaviour a native mobile sheet
 * has. While `open`, one sentinel history entry is pushed; a Back press pops it
 * and calls `onDismiss`.
 *
 * The pushState keeps the current URL, so route-watching chrome (the mobile
 * nav, the navigation watchdog) sees no navigation.
 *
 * ⚠️ The cleanup must never perform a history NAVIGATION (history.back()/
 * forward()/go()). It used to call back() to tidy the sentinel away, and that
 * caused two separate production regressions, because the App Router treats a
 * pop on the current route as a real route change:
 *   1. Menus whose items are links — closing the menu IS part of the click that
 *      starts the navigation, so the pop cancelled the in-flight transition and
 *      the 15s NavigationWatchdog fired "navigation did not complete".
 *   2. Sheets that close themselves after a successful mutation — the pop
 *      reverted the route to its pre-mutation payload, so Socialize and Hangout
 *      could activate in the database and still snap straight back to OFF.
 * See the cleanup below for what it does instead.
 */
export function useDismissOnBack(open: boolean, onDismiss: () => void) {
  /* Keep the listener stable while the overlay is open.
   *
   * Callers normally pass an inline callback. Depending on that callback made
   * this effect clean up and push a fresh history sentinel after every render
   * inside a sheet -- including every keystroke in Create Event and every
   * loading-state update. Back closed the sheet, but left a trail of inert
   * same-URL entries behind it. The ref keeps the latest behaviour without
   * making ordinary renders mutate browser history. */
  const onDismissRef = useRef(onDismiss);

  useEffect(() => {
    onDismissRef.current = onDismiss;
  }, [onDismiss]);

  useEffect(() => {
    if (!open || typeof window === "undefined") return;

    window.history.pushState({ mbSheet: true }, "");
    const handlePopState = () => onDismissRef.current();
    window.addEventListener("popstate", handlePopState);

    return () => {
      window.removeEventListener("popstate", handlePopState);
      // If our sentinel is still the current entry, the sheet was closed by the
      // UI rather than by Back, so the sentinel needs to stop being one.
      //
      // This MUST NOT call history.back(). Popping fires a real history
      // navigation on the current route, and the App Router reacts to it: it
      // cancelled in-flight transitions (the menu-navigation stall) and, when a
      // sheet closes itself right after a successful mutation, it reverted the
      // route to the pre-mutation payload — which is how Socialize and Hangout
      // activation could write to the database and still snap back to OFF.
      //
      // replaceState neutralises the sentinel in place with no navigation, so
      // Back-to-close still works (that path pops before this cleanup runs and
      // is skipped by the guard) and nothing else observes a route change. The
      // cost is one inert history entry per opened sheet, i.e. one extra Back
      // press to leave the page afterwards — far cheaper than cancelling
      // navigations and discarding fresh state.
      if (window.history.state?.mbSheet) window.history.replaceState(null, "");
    };
  }, [open]);
}
