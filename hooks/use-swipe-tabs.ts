"use client";

import { useCallback, useRef, useState } from "react";
import {
  decideSwipe,
  isSwipeExempt,
  nextTabId,
  SWIPE_DISTANCE_THRESHOLD
} from "@/lib/navigation/swipe-tabs";

/**
 * Binds horizontal swiping to a tab strip.
 *
 * All of the judgement lives in `lib/navigation/swipe-tabs` as pure functions;
 * this only tracks the pointer and reports a live offset so the panel can
 * follow the finger.
 *
 * Pointer Events rather than Touch Events: they cover touch, pen and mouse
 * drag with one code path, and match the Moments viewer, which is the existing
 * gesture idiom in this codebase.
 */
export function useSwipeTabs<T extends string>({
  tabIds,
  activeId,
  onSelect,
  enabled = true
}: {
  tabIds: readonly T[];
  activeId: T;
  onSelect: (id: T) => void;
  /** Disabled under reduced motion? No — see below. Disabled when there is nothing to swipe. */
  enabled?: boolean;
}) {
  const startRef = useRef<{ x: number; y: number; t: number } | null>(null);
  const [offsetX, setOffsetX] = useState(0);

  const onPointerDown = useCallback(
    (event: React.PointerEvent) => {
      if (!enabled) return;
      // A mouse drag across text is a selection, not a swipe. Touch and pen
      // are the pointer types this gesture is for.
      if (event.pointerType === "mouse") return;
      if (isSwipeExempt(event.target as Element, event.currentTarget as Element)) return;
      startRef.current = { x: event.clientX, y: event.clientY, t: event.timeStamp };
    },
    [enabled]
  );

  const onPointerMove = useCallback((event: React.PointerEvent) => {
    const start = startRef.current;
    if (!start) return;

    const deltaX = event.clientX - start.x;
    const deltaY = event.clientY - start.y;

    // Once the gesture is clearly vertical, abandon it for good rather than
    // re-testing every frame: a scroll that drifts sideways halfway down must
    // not suddenly become a tab change.
    if (Math.abs(deltaY) > Math.abs(deltaX) && Math.abs(deltaY) > 12) {
      startRef.current = null;
      setOffsetX(0);
      return;
    }

    // Resistance at the ends of the strip: the panel still moves, so the
    // gesture feels alive, but the short travel says "nothing over here".
    const atStart = tabIds.indexOf(activeId) === 0 && deltaX > 0;
    const atEnd = tabIds.indexOf(activeId) === tabIds.length - 1 && deltaX < 0;
    const resisted = atStart || atEnd ? deltaX * 0.25 : deltaX;
    setOffsetX(Math.max(Math.min(resisted, SWIPE_DISTANCE_THRESHOLD * 2), -SWIPE_DISTANCE_THRESHOLD * 2));
  }, [activeId, tabIds]);

  const finish = useCallback(
    (event: React.PointerEvent) => {
      const start = startRef.current;
      startRef.current = null;
      setOffsetX(0);
      if (!start) return;

      const decision = decideSwipe({
        deltaX: event.clientX - start.x,
        deltaY: event.clientY - start.y,
        elapsedMs: event.timeStamp - start.t
      });
      const target = nextTabId(tabIds, activeId, decision);
      if (target) onSelect(target);
    },
    [activeId, onSelect, tabIds]
  );

  return {
    /** Live horizontal offset, for the follow-the-finger transform. */
    offsetX,
    swiping: offsetX !== 0,
    handlers: {
      onPointerDown,
      onPointerMove,
      onPointerUp: finish,
      // A cancelled pointer (the browser taking over for a scroll) must reset,
      // never commit — otherwise an interrupted gesture changes tab.
      onPointerCancel: () => {
        startRef.current = null;
        setOffsetX(0);
      }
    }
  };
}
