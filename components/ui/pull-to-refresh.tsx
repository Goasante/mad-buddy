"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useReducedMotion } from "@/hooks/use-reduced-motion";
import { cn } from "@/lib/utils";

/**
 * One reusable pull-to-refresh for the whole app.
 *
 * Its job in the data architecture is narrow and explicit: the server is the
 * source of truth, optimistic UI gives the actor an immediate local response,
 * Realtime is a cross-client enhancement, and THIS is the manual way to force a
 * canonical refresh when any of that has drifted. It never polls.
 *
 * It deliberately does not blank the page. Existing content stays on screen with
 * a small indicator above it, so a refresh never causes a layout jump or a
 * flash of empty state.
 *
 * Guard rails, because a naive implementation breaks ordinary scrolling:
 *  - Only arms when the scroll container is genuinely at the top.
 *  - Only arms for a single touch, so pinch-zoom is unaffected.
 *  - Bails the moment horizontal movement dominates, so carousels and swipes
 *    keep working.
 *  - Ignores gestures starting inside a horizontal scroller, a modal/sheet, or
 *    anything opted out via `data-no-pull-refresh`.
 *  - Never calls preventDefault until the gesture is committed as a pull, so
 *    text selection and native overscroll are left alone up to that point.
 */

/**
 * Dispatched after a pull completes. A page that keeps canonical data in client
 * state (a feed it refetches through an action) listens for this instead of
 * mounting a second pull-to-refresh of its own.
 */
export const PULL_REFRESH_EVENT = "mad-buddy:pull-refresh";

const THRESHOLD_PX = 72;
const MAX_PULL_PX = 110;
/** Below this, treat the gesture as a tap/scroll rather than a pull. */
const ARM_PX = 6;

export function PullToRefresh({
  onRefresh,
  children,
  className,
  disabled = false
}: {
  /**
   * Canonical refresh. Defaults to `router.refresh()`, which re-runs the
   * server render — the right thing for a Server-Component page. Pass a custom
   * handler for pages holding client state that also needs re-fetching.
   */
  onRefresh?: () => void | Promise<unknown>;
  children: React.ReactNode;
  className?: string;
  disabled?: boolean;
}) {
  const router = useRouter();
  const reducedMotion = useReducedMotion();
  const [pull, setPull] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const startY = useRef<number | null>(null);
  const startX = useRef(0);
  const committed = useRef(false);
  // Mirrored into state because render needs it to decide whether the transform
  // should animate: reading a ref during render is both a lint error and wrong,
  // since a ref change would not re-render.
  const [dragging, setDragging] = useState(false);
  const refreshingRef = useRef(false);

  const run = useCallback(async () => {
    if (refreshingRef.current) return;
    refreshingRef.current = true;
    setRefreshing(true);
    try {
      // Always re-run the server render, then let any page holding its own
      // client state refetch. One implementation covers both kinds of page
      // instead of each one growing its own gesture handling.
      router.refresh();
      if (onRefresh) await onRefresh();
      window.dispatchEvent(new CustomEvent(PULL_REFRESH_EVENT));
    } finally {
      // Brief hold so the indicator reads as "done" rather than flickering.
      window.setTimeout(() => {
        refreshingRef.current = false;
        setRefreshing(false);
        setPull(0);
      }, 400);
    }
  }, [onRefresh, router]);

  useEffect(() => {
    if (disabled) return;

    /** True when the gesture must be left entirely to the browser. */
    const shouldIgnore = (target: EventTarget | null): boolean => {
      if (!(target instanceof Element)) return false;
      // A sheet/dialog scrolls itself; pulling inside one must not refresh the
      // page underneath.
      if (target.closest("[role='dialog'], [data-no-pull-refresh]")) return true;
      // Any horizontally scrollable ancestor (avatar rows, chip rails).
      let node: Element | null = target;
      while (node) {
        if (node.scrollWidth > node.clientWidth + 1) {
          const overflowX = window.getComputedStyle(node).overflowX;
          if (overflowX === "auto" || overflowX === "scroll") return true;
        }
        node = node.parentElement;
      }
      return false;
    };

    const atTop = () => window.scrollY <= 0 && document.documentElement.scrollTop <= 0;

    const onTouchStart = (event: TouchEvent) => {
      // Single touch only, so pinch-zoom is never hijacked.
      if (event.touches.length !== 1 || refreshingRef.current) return;
      if (!atTop() || shouldIgnore(event.target)) return;
      startY.current = event.touches[0].clientY;
      startX.current = event.touches[0].clientX;
      committed.current = false;
    };

    const onTouchMove = (event: TouchEvent) => {
      if (startY.current === null || event.touches.length !== 1) return;
      const deltaY = event.touches[0].clientY - startY.current;
      const deltaX = Math.abs(event.touches[0].clientX - startX.current);

      // Upward, or mostly sideways: not a pull. Release it back to the browser.
      if (deltaY <= 0 || deltaX > Math.abs(deltaY)) {
        if (!committed.current) startY.current = null;
        return;
      }
      if (deltaY < ARM_PX) return;
      // Scrolled away mid-gesture (momentum): abandon.
      if (!atTop()) {
        startY.current = null;
        setPull(0);
        return;
      }

      committed.current = true;
      setDragging(true);
      // Only now, with the gesture committed as a pull, suppress native
      // overscroll — never before, so selection and scrolling stay intact.
      if (event.cancelable) event.preventDefault();
      // Resistance: the further you pull, the slower it moves.
      setPull(Math.min(MAX_PULL_PX, deltaY * 0.5));
    };

    const onTouchEnd = () => {
      const pulled = committed.current;
      startY.current = null;
      committed.current = false;
      setDragging(false);
      if (!pulled) return;
      setPull((current) => {
        if (current >= THRESHOLD_PX) {
          void run();
          return THRESHOLD_PX;
        }
        return 0;
      });
    };

    // Non-passive on move only, since that is the one that may preventDefault.
    window.addEventListener("touchstart", onTouchStart, { passive: true });
    window.addEventListener("touchmove", onTouchMove, { passive: false });
    window.addEventListener("touchend", onTouchEnd, { passive: true });
    window.addEventListener("touchcancel", onTouchEnd, { passive: true });
    return () => {
      window.removeEventListener("touchstart", onTouchStart);
      window.removeEventListener("touchmove", onTouchMove);
      window.removeEventListener("touchend", onTouchEnd);
      window.removeEventListener("touchcancel", onTouchEnd);
    };
  }, [disabled, run]);

  const active = pull > 0 || refreshing;
  const progress = Math.min(1, pull / THRESHOLD_PX);

  return (
    <div className={cn("relative", className)}>
      {/* Indicator sits ABOVE the content and does not displace it, so nothing
          below shifts while refreshing. */}
      <div
        aria-hidden={!active}
        className="pointer-events-none absolute inset-x-0 top-0 z-10 flex justify-center"
        style={{
          height: active ? Math.max(pull, refreshing ? THRESHOLD_PX * 0.6 : 0) : 0,
          opacity: active ? 1 : 0,
          transition: dragging ? undefined : "height 200ms ease, opacity 200ms ease"
        }}
      >
        <span
          className={cn(
            "mt-2 grid h-8 w-8 place-items-center rounded-full border border-border/70 bg-card/90 shadow-sm",
            refreshing && !reducedMotion && "pull-refresh-spin"
          )}
          style={reducedMotion || refreshing ? undefined : { transform: `rotate(${progress * 270}deg)` }}
        >
          {/* Mad Buddy mark: a brand-orange arc that fills as you pull. */}
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" aria-hidden="true">
            <circle cx="12" cy="12" r="9" stroke="hsl(var(--border))" strokeWidth="2.5" />
            <circle
              cx="12"
              cy="12"
              r="9"
              stroke="var(--color-brand-orange)"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeDasharray={2 * Math.PI * 9}
              strokeDashoffset={2 * Math.PI * 9 * (1 - (refreshing ? 0.75 : progress))}
              transform="rotate(-90 12 12)"
            />
          </svg>
        </span>
      </div>

      <div
        style={{
          transform: active ? `translateY(${refreshing ? Math.min(pull, THRESHOLD_PX * 0.5) : pull}px)` : undefined,
          transition: dragging ? undefined : "transform 220ms cubic-bezier(0.22, 1, 0.36, 1)"
        }}
      >
        {children}
      </div>

      {/* Announced politely rather than as an alert: a refresh is routine. */}
      <span role="status" aria-live="polite" className="sr-only">
        {refreshing ? "Refreshing" : ""}
      </span>
    </div>
  );
}

/**
 * Subscribes a page's own refetch to the shell-level pull gesture.
 *
 * Exists so there is exactly ONE pull-to-refresh implementation: the shell owns
 * the gesture and the indicator, and pages that hold client state just say what
 * to reload.
 */
export function usePullRefreshListener(onRefresh: () => void) {
  const handler = useRef(onRefresh);
  useEffect(() => {
    handler.current = onRefresh;
  }, [onRefresh]);
  useEffect(() => {
    const listener = () => handler.current();
    window.addEventListener(PULL_REFRESH_EVENT, listener);
    return () => window.removeEventListener(PULL_REFRESH_EVENT, listener);
  }, []);
}
