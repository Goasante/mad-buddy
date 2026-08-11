"use client";

import { useCallback, useSyncExternalStore } from "react";

/**
 * Subscribe to a CSS media query from React.
 *
 * Same shape as use-reduced-motion: useSyncExternalStore with a server
 * snapshot, so the value is defined during SSR instead of throwing on
 * `window`. The server always reports false, which is what makes the
 * server-rendered markup deterministic -- layout that must differ by viewport
 * is expressed in CSS, and this hook is reserved for BEHAVIOUR that cannot
 * be (which interaction model an accordion panel uses, for instance).
 */
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (callback: () => void) => {
      const mediaQuery = window.matchMedia(query);
      mediaQuery.addEventListener("change", callback);
      return () => mediaQuery.removeEventListener("change", callback);
    },
    [query]
  );

  const getSnapshot = useCallback(() => window.matchMedia(query).matches, [query]);

  return useSyncExternalStore(subscribe, getSnapshot, () => false);
}

/**
 * True on devices whose primary input can hover with a precise pointer --
 * i.e. a real mouse, not a touchscreen and not a stylus.
 *
 * `any-hover`/`any-pointer` are deliberately NOT used: a phone with a
 * Bluetooth mouse paired would satisfy those and get the hover interaction
 * model on a screen that is still mostly touched.
 */
export const FINE_POINTER_QUERY = "(hover: hover) and (pointer: fine)";
