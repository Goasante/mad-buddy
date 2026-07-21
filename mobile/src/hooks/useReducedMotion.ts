import { useSyncExternalStore } from "react";

// Mirrors the web hook so shared motion code behaves identically.
const reducedMotionQuery = "(prefers-reduced-motion: reduce)";

function subscribe(callback: () => void) {
  const mediaQuery = window.matchMedia(reducedMotionQuery);
  mediaQuery.addEventListener("change", callback);
  return () => mediaQuery.removeEventListener("change", callback);
}

function getSnapshot() {
  return window.matchMedia(reducedMotionQuery).matches;
}

export function useReducedMotion() {
  return useSyncExternalStore(subscribe, getSnapshot, () => false);
}
