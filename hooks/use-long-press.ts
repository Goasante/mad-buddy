"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Long-press to open a contextual menu.
 *
 * On a phone there is no right-click and no hover, so a press-and-hold is the
 * only gesture left for "tell me more about this thing". Nothing in the app
 * offered it, which meant any surface without a visible menu button had no
 * secondary actions at all.
 *
 * Deliberate choices:
 *
 *   - 500ms, matching the platform convention on both iOS and Android. Shorter
 *     fires while someone is still deciding; longer feels broken.
 *   - MOVEMENT CANCELS. A press that drifts more than a few pixels is a scroll,
 *     not a hold — without this, every attempt to scroll a horizontal rail
 *     would open a menu under the finger.
 *   - The click that follows a fired long-press is suppressed. A touch that
 *     opens a menu must not ALSO trigger the button's own tap action, or the
 *     profile would open behind the menu.
 *   - Right-click maps to the same menu on desktop, so the affordance is not
 *     mobile-only.
 */

export const LONG_PRESS_DURATION_MS = 500;

/** Movement beyond this many pixels means the gesture was a scroll. */
export const LONG_PRESS_MOVE_TOLERANCE_PX = 8;

export function useLongPress(
  onLongPress: () => void,
  { durationMs = LONG_PRESS_DURATION_MS, disabled = false }: { durationMs?: number; disabled?: boolean } = {}
) {
  const timerRef = useRef<number | null>(null);
  const originRef = useRef<{ x: number; y: number } | null>(null);
  // Set when a long press fires, read by the click handler that follows.
  const firedRef = useRef(false);
  const [pressing, setPressing] = useState(false);

  const clear = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    originRef.current = null;
    setPressing(false);
  }, []);

  // A press interrupted by unmount must not leave a timer that fires into a
  // component that no longer exists.
  useEffect(() => clear, [clear]);

  const start = useCallback(
    (x: number, y: number) => {
      if (disabled) return;
      firedRef.current = false;
      originRef.current = { x, y };
      setPressing(true);
      timerRef.current = window.setTimeout(() => {
        firedRef.current = true;
        setPressing(false);
        timerRef.current = null;
        onLongPress();
      }, durationMs);
    },
    [disabled, durationMs, onLongPress]
  );

  return {
    /** True while a press is being held, for optional press feedback. */
    pressing,
    handlers: {
      onPointerDown: (event: React.PointerEvent) => {
        // Primary button only: a right-click is handled by onContextMenu.
        if (event.button !== 0) return;
        start(event.clientX, event.clientY);
      },
      onPointerMove: (event: React.PointerEvent) => {
        const origin = originRef.current;
        if (!origin) return;
        const movedFar =
          Math.abs(event.clientX - origin.x) > LONG_PRESS_MOVE_TOLERANCE_PX ||
          Math.abs(event.clientY - origin.y) > LONG_PRESS_MOVE_TOLERANCE_PX;
        // The gesture turned into a scroll, so it is no longer a hold.
        if (movedFar) clear();
      },
      onPointerUp: clear,
      onPointerLeave: clear,
      onPointerCancel: clear,
      onContextMenu: (event: React.MouseEvent) => {
        if (disabled) return;
        // Replaces the browser menu with the app's own, so desktop gets the
        // same actions rather than a native menu that knows nothing about them.
        event.preventDefault();
        firedRef.current = true;
        onLongPress();
      },
      onClick: (event: React.MouseEvent) => {
        // Swallows the click synthesised after a hold, so the element's own
        // tap action does not also run beneath the menu that just opened.
        if (firedRef.current) {
          event.preventDefault();
          event.stopPropagation();
          firedRef.current = false;
        }
      }
    }
  };
}
