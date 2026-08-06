"use client";

import { useEffect, useRef, useState } from "react";
import { useReducedMotion } from "@/hooks/use-reduced-motion";

/**
 * Advances a single highlighted index around a list, one item at a time.
 *
 * ONE timer for the whole sequence, not one per item: the hook owns a single
 * timeout and only ever moves the active index, so a cycle re-renders the
 * cards' className rather than the section, and the animation itself runs in
 * CSS.
 *
 * Pauses — and resumes — automatically when the user is interacting or the
 * page is hidden, because a decorative sweep should never compete with a
 * scroll gesture or burn cycles in a background tab.
 *
 * Returns -1 when nothing should animate (reduced motion, an empty list, or
 * while paused), which callers use to mean "render every card static".
 */
export function useSequenceHighlight(
  count: number,
  {
    /** How long one item stays lit. Matches the CSS sweep duration. */
    durationMs = 2750,
    /** Quiet gap before the next item begins. */
    gapMs = 700,
    /** Externally-driven pause (a rail being dragged, a sheet being open). */
    paused = false
  }: { durationMs?: number; gapMs?: number; paused?: boolean } = {}
): number {
  const reducedMotion = useReducedMotion();
  const [active, setActive] = useState(0);
  const [hidden, setHidden] = useState(false);
  // Kept in a ref so the scheduling effect does not restart on every step.
  const activeRef = useRef(0);

  // Pause in a background tab.
  useEffect(() => {
    const read = () => setHidden(document.visibilityState === "hidden");
    read();
    document.addEventListener("visibilitychange", read);
    return () => document.removeEventListener("visibilitychange", read);
  }, []);

  const stopped = reducedMotion || paused || hidden || count <= 1;

  useEffect(() => {
    if (stopped) return;

    let timer = 0;
    const step = () => {
      // Light the current card for `durationMs`, then rest for `gapMs` with
      // nothing lit, then move on — so the sequence reads as one card at a
      // time with a beat between, never a continuous chase.
      setActive(activeRef.current);
      timer = window.setTimeout(() => {
        setActive(-1);
        timer = window.setTimeout(() => {
          activeRef.current = (activeRef.current + 1) % count;
          step();
        }, gapMs);
      }, durationMs);
    };

    step();
    return () => window.clearTimeout(timer);
  }, [stopped, count, durationMs, gapMs]);

  return stopped ? -1 : active;
}

/**
 * True while the user is touching or actively scrolling an element.
 *
 * Used to pause the sweep during a drag: an animation running under a moving
 * rail is both distracting and the most likely source of scroll jank.
 */
export function useInteractionPause(ref: React.RefObject<HTMLElement | null>): boolean {
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;

    let release = 0;
    const hold = () => {
      window.clearTimeout(release);
      setBusy(true);
    };
    const settle = () => {
      window.clearTimeout(release);
      // Momentum scrolling keeps firing after the finger lifts, so wait for
      // genuine quiet rather than resuming mid-glide.
      release = window.setTimeout(() => setBusy(false), 400);
    };

    element.addEventListener("pointerdown", hold, { passive: true });
    element.addEventListener("touchstart", hold, { passive: true });
    element.addEventListener("scroll", settle, { passive: true });
    element.addEventListener("pointerup", settle, { passive: true });
    element.addEventListener("touchend", settle, { passive: true });
    element.addEventListener("pointercancel", settle, { passive: true });

    return () => {
      window.clearTimeout(release);
      element.removeEventListener("pointerdown", hold);
      element.removeEventListener("touchstart", hold);
      element.removeEventListener("scroll", settle);
      element.removeEventListener("pointerup", settle);
      element.removeEventListener("touchend", settle);
      element.removeEventListener("pointercancel", settle);
    };
  }, [ref]);

  return busy;
}
