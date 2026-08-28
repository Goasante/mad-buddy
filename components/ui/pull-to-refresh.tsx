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
/** How long the "done" state holds before retracting. */
const SETTLE_MS = 650;
/**
 * The indicator strip's height. FIXED and compact — deliberately independent
 * of pull distance, so the overlay can never grow into a large block above
 * the header. The indicator animates within this band; the band itself only
 * ever transitions between 0 and this value.
 */
const STRIP_HEIGHT_PX = 44;

/**
 * The indicator's five states. Each maps to one label and one visual, so the
 * component never has to infer what to show from a combination of booleans.
 */
type RefreshPhase = "resting" | "pulling" | "ready" | "refreshing" | "complete";

const PHASE_LABEL: Record<RefreshPhase, string> = {
  resting: "",
  pulling: "Pull to refresh",
  ready: "Release to refresh",
  refreshing: "Refreshing nearby…",
  complete: "You're up to date"
};

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
  const [done, setDone] = useState(false);
  const [failed, setFailed] = useState(false);
  const startY = useRef<number | null>(null);
  const startX = useRef(0);
  const committed = useRef(false);
  // Mirrored into state because render needs it to decide whether the transform
  // should animate: reading a ref during render is both a lint error and wrong,
  // since a ref change would not re-render.
  const [dragging, setDragging] = useState(false);
  const refreshingRef = useRef(false);

  const run = useCallback(async () => {
    // Concurrency guard: a second pull while one is in flight is ignored
    // rather than queued, so a rapid double gesture cannot fire two refreshes.
    if (refreshingRef.current) return;
    refreshingRef.current = true;
    setRefreshing(true);
    setFailed(false);
    try {
      // Always re-run the server render, then let any page holding its own
      // client state refetch. One implementation covers both kinds of page
      // instead of each one growing its own gesture handling.
      router.refresh();
      if (onRefresh) await onRefresh();
      window.dispatchEvent(new CustomEvent(PULL_REFRESH_EVENT));
      setDone(true);
    } catch {
      // Network failure keeps the existing content on screen and says so,
      // rather than blanking the page or silently pretending it worked.
      setFailed(true);
    } finally {
      // Hold the done/failed state briefly so it reads as a result rather
      // than a flicker, then retract.
      window.setTimeout(() => {
        refreshingRef.current = false;
        setRefreshing(false);
        setDone(false);
        setFailed(false);
        setPull(0);
      }, SETTLE_MS);
    }
  }, [onRefresh, router]);

  useEffect(() => {
    if (disabled) return;

    /** True when the gesture must be left entirely to the browser. */
    const shouldIgnore = (target: EventTarget | null): boolean => {
      // A modal or sheet open ANYWHERE blocks the gesture, not just when the
      // touch starts inside it — Radix portals its overlays to <body>, so a
      // sheet covering the page is not an ancestor of whatever is underneath.
      if (document.querySelector("[role='dialog'][data-state='open']")) return true;
      // An open keyboard turns a downward drag into caret/selection work.
      const active = document.activeElement;
      if (
        active instanceof HTMLElement &&
        (active.tagName === "INPUT" || active.tagName === "TEXTAREA" || active.isContentEditable)
      ) {
        return true;
      }
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

    const atTop = () => {
      const scrollOwner = document.querySelector<HTMLElement>("[data-app-scroll-owner]");
      return scrollOwner
        ? scrollOwner.scrollTop <= 0
        : window.scrollY <= 0 && document.documentElement.scrollTop <= 0;
    };

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
  // One derived phase drives both the visual and the label, so the two can
  // never describe different things.
  const phase: RefreshPhase = refreshing
    ? done || failed
      ? "complete"
      : "refreshing"
    : pull >= THRESHOLD_PX
      ? "ready"
      : pull > 0
        ? "pulling"
        : "resting";
  const label = failed && phase === "complete" ? "Couldn't refresh. Pull to try again." : PHASE_LABEL[phase];

  // How far into the strip the indicator has travelled. Clamped to the strip
  // height so it can never escape the clip region, however hard the user pulls.
  const travel = Math.min(1, pull / THRESHOLD_PX);

  return (
    // NO wrapper transform and NO flow height anywhere in this component.
    //
    // Both were structural bugs. The old version translated a div wrapping
    // {children} — which includes the page header — so (a) the header moved
    // with the pull, and (b) that transform made the wrapper a containing
    // block for any `position: sticky` descendant, re-basing the header onto
    // it instead of the viewport. It also grew a real-height spacer above the
    // content, pushing everything down and leaving a gap after a refresh.
    //
    // Now the indicator is a FIXED, clipped overlay pinned to the top of the
    // viewport, and the content is never moved at all.
    <div className={cn("contents", className)}>
      <div
        aria-hidden={!active}
        className="pointer-events-none fixed inset-x-0 z-30 overflow-hidden md:hidden"
        style={{
          // Pinned directly BELOW the fixed header, not behind it. The header
          // is opaque (content scrolls under it), so a strip sharing the
          // header's band would be completely hidden — visually correct in the
          // sense that nothing moves, but useless as feedback.
          //
          // Anchoring here means the indicator appears in the gap between the
          // header and the content, overlaying the content rather than
          // displacing it.
          top: "var(--mobile-header-height)",
          // Fixed, compact strip — the height never depends on pull distance,
          // so nothing can grow. The indicator moves WITHIN it.
          height: active ? STRIP_HEIGHT_PX : 0,
          opacity: active ? 1 : 0,
          transition: dragging
            ? "opacity 120ms ease"
            : "height 220ms ease, opacity 220ms ease"
        }}
      >
        {/* Full-width opaque surface, NOT transformed. This strip floats over
            page content, so the surface must stay edge to edge and still —
            translating it would expose a sliver of the content beneath. Only
            the indicator inside it animates. */}
        <div className="flex h-full w-full items-center justify-center gap-2 bg-background dark:bg-[#111112]">
          <div
            className="flex items-center justify-center gap-2"
            style={{
              // The indicator eases up into the strip as you pull and retracts
              // by the same path. Transform only — no layout is touched.
              transform: `translateY(${(1 - (refreshing ? 1 : travel)) * -STRIP_HEIGHT_PX * 0.5}px)`,
              opacity: refreshing ? 1 : Math.max(0, travel),
              transition: dragging
                ? undefined
                : "transform 220ms cubic-bezier(0.22, 1, 0.36, 1), opacity 180ms ease"
            }}
          >
          <span
            className={cn(
              "grid h-6 w-6 shrink-0 place-items-center rounded-full border border-border/70 bg-card shadow-sm",
              phase === "refreshing" && !reducedMotion && "pull-refresh-spin"
            )}
            style={
              reducedMotion || phase !== "pulling"
                ? undefined
                : { transform: `rotate(${progress * 270}deg)` }
            }
          >
            {phase === "complete" ? (
              failed ? (
                <RefreshAlertMark />
              ) : (
                <RefreshCheckMark />
              )
            ) : (
              <RefreshRing progress={phase === "refreshing" ? 0.75 : progress} ready={phase === "ready"} />
            )}
          </span>
            {label ? (
              <span className="shrink-0 text-[11px] font-medium leading-none text-muted-foreground">
                {label}
              </span>
            ) : null}
          </div>
        </div>
      </div>

      {children}

      {/* Announced politely rather than as an alert: a refresh is routine.
          Only the outcome states are announced — narrating every pixel of the
          pull would be noise. */}
      <span role="status" aria-live="polite" className="sr-only">
        {phase === "refreshing" ? "Refreshing" : phase === "complete" ? label : ""}
      </span>
    </div>
  );
}

/**
 * The pull/refresh ring: a brand-orange arc on a neutral track that fills as
 * the gesture progresses, then sits at 75% while the refresh runs (the
 * rotation, not the length, carries "working").
 */
function RefreshRing({ progress, ready }: { progress: number; ready: boolean }) {
  const circumference = 2 * Math.PI * 9;
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="9" stroke="hsl(var(--border))" strokeWidth="2.5" />
      <circle
        cx="12"
        cy="12"
        r="9"
        stroke="var(--color-brand-orange)"
        strokeWidth={ready ? 3 : 2.5}
        strokeLinecap="round"
        strokeDasharray={circumference}
        strokeDashoffset={circumference * (1 - progress)}
        transform="rotate(-90 12 12)"
      />
    </svg>
  );
}

/** Success: a brand-orange check, matching the ring's accent. */
function RefreshCheckMark() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" aria-hidden="true">
      <path
        d="M5 12.5l4.5 4.5L19 7.5"
        stroke="var(--color-brand-orange)"
        strokeWidth="2.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** Failure: a muted alert, deliberately quieter than the success check. */
function RefreshAlertMark() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" aria-hidden="true">
      <path d="M12 7v6" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
      <circle cx="12" cy="17" r="1.25" fill="currentColor" />
    </svg>
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
