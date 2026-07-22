import { useEffect, useRef } from "react";

/**
 * A tiny global registry of open overlays (dropdowns, sheets, menus) so a single
 * shared handler can dismiss them — outside-press, Escape, and the Android
 * hardware back button — instead of every screen wiring its own listeners.
 *
 * The most-recently-opened overlay is the top of the stack; back/Escape closes
 * that one first. Enforce "one open at a time" by calling dismissAllOverlays()
 * before opening a new one.
 */

type Dismisser = { id: number; dismiss: () => void };

const stack: Dismisser[] = [];
let counter = 0;

export function pushOverlay(dismiss: () => void): number {
  const id = ++counter;
  stack.push({ id, dismiss });
  return id;
}

export function removeOverlay(id: number): void {
  const index = stack.findIndex((entry) => entry.id === id);
  if (index >= 0) stack.splice(index, 1);
}

/** Closes the top overlay. Returns true if one was open (so the caller can
 *  swallow the Android back / Escape instead of navigating). */
export function dismissTopOverlay(): boolean {
  const top = stack.pop();
  if (!top) return false;
  top.dismiss();
  return true;
}

export function dismissAllOverlays(): void {
  while (stack.length > 0) stack.pop()!.dismiss();
}

export function hasOpenOverlay(): boolean {
  return stack.length > 0;
}

/** Registers an overlay's dismisser while `open` is true. */
export function useOverlayDismiss(open: boolean, dismiss: () => void): void {
  const dismissRef = useRef(dismiss);
  dismissRef.current = dismiss;
  useEffect(() => {
    if (!open) return;
    const id = pushOverlay(() => dismissRef.current());
    return () => removeOverlay(id);
  }, [open]);
}
