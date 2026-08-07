"use client";

import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { VisibleMoment } from "@/lib/content/service";
import { MomentImage } from "@/components/ui/moment-image";
import { UserAvatar } from "@/components/ui/user-avatar";
import { publicMembershipTier } from "@/lib/billing/premium-identity";
import { useDismissOnBack } from "@/hooks/use-dismiss-on-back";
import { useReducedMotion } from "@/hooks/use-reduced-motion";
import { cn, formatRelativeTime } from "@/lib/utils";

/**
 * Full-screen media layer.
 *
 * Shows the tapped Moment's media at full size and steps through the rest of
 * the ALREADY-AUTHORISED sequence it is handed. It is not a second feed: it
 * loads nothing, authorises nothing and holds no content model — the page owns
 * all of that and passes a rotated view of its own list (see
 * rotateSequenceToTarget), so the tapped Moment leads and the feed's order is
 * otherwise untouched.
 *
 * Dismissal is swipe-down (media follows the finger, backdrop fades), the close
 * button, Escape, and hardware/browser Back via the shared useDismissOnBack.
 */

/** Fraction of viewport height a drag must pass to dismiss on release. */
const DISMISS_THRESHOLD = 0.22;
/** Downward flick speed that dismisses regardless of distance (px/ms). */
const DISMISS_VELOCITY = 0.5;

export function MomentMediaViewer({
  moment,
  sequence = [],
  onActiveChange,
  open,
  onClose,
  /**
   * Larger asset for full-screen, when the caller has one. Falls back to the
   * feed-sized URL already loaded, so the layer always has something to show
   * and never blocks on a fetch.
   */
  fullResUrl = null,
  /** Playback position (seconds) to resume a video from. */
  initialVideoTime = 0,
  /** Reports the position back so the card can resume where full-screen left off. */
  onVideoTimeChange
}: {
  moment: VisibleMoment;
  /**
   * The authorised sequence ROTATED so `moment` leads (see
   * rotateSequenceToTarget). Next/previous step through it circularly, so the
   * order is the feed's own — just started from the tapped Moment.
   */
  sequence?: readonly VisibleMoment[];
  /** Reports the active Moment so the caller can replace the URL parameter. */
  onActiveChange?: (moment: VisibleMoment) => void;
  open: boolean;
  onClose: () => void;
  fullResUrl?: string | null;
  initialVideoTime?: number;
  onVideoTimeChange?: (seconds: number) => void;
}) {
  const reducedMotion = useReducedMotion();
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const closeRef = useRef<HTMLButtonElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  // Where focus came from, so it can be handed back on dismissal.
  const returnFocusRef = useRef<HTMLElement | null>(null);

  // Position within the rotated sequence. Index 0 IS the tapped Moment, so the
  // layer always opens on it.
  const [activeIndex, setActiveIndex] = useState(0);
  // Derived reset: a newly tapped Moment starts at the front of its own
  // rotation. This is the "adjust state when a prop changes" pattern React
  // sanctions, and it avoids the cascading render an effect would cause.
  const [trackedMomentId, setTrackedMomentId] = useState(moment.id);
  if (trackedMomentId !== moment.id) {
    setTrackedMomentId(moment.id);
    setActiveIndex(0);
  }
  // The sequence always contains at least the tapped Moment, so there is
  // something to show even when the caller passes no sequence at all.
  const items = sequence.length > 0 ? sequence : [moment];
  const active = items[Math.min(activeIndex, items.length - 1)] ?? moment;

  // Drag state. Kept in state (not a ref) because the transform renders.
  const [dragY, setDragY] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [zoomed, setZoomed] = useState(false);
  const startRef = useRef<{ x: number; y: number; t: number } | null>(null);

  const isVideo = active.contentType === "video";
  const isText = active.contentType === "text";

  // Circular: past the end wraps to the front, so the sequence continues
  // rather than dead-ending on the Moment before the one that was tapped.
  const step = useCallback(
    (delta: number) => {
      setActiveIndex((current) => (current + delta + items.length) % items.length);
      setZoomed(false);
    },
    [items.length]
  );

  const dismiss = useCallback(() => {
    // Hand the current position back before unmounting, so returning to the
    // card resumes rather than restarting.
    if (videoRef.current) onVideoTimeChange?.(videoRef.current.currentTime);
    setDragY(0);
    setDragging(false);
    setZoomed(false);
    onClose();
  }, [onClose, onVideoTimeChange]);

  // Hardware/browser Back closes the layer instead of leaving the page. This is
  // what makes the back sequence full-screen → Moment → page.
  useDismissOnBack(open, dismiss);

  // Focus management: trap inside the dialog, restore on the way out.
  useEffect(() => {
    if (!open) return;
    returnFocusRef.current = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        dismiss();
        return;
      }
      if (event.key === "ArrowRight") {
        event.preventDefault();
        step(1);
        return;
      }
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        step(-1);
        return;
      }
      if (event.key !== "Tab") return;
      // Focus trap: the layer covers the page, so Tab must not reach the feed
      // behind it.
      const focusables = dialogRef.current?.querySelectorAll<HTMLElement>(
        'button, [href], video, [tabindex]:not([tabindex="-1"])'
      );
      if (!focusables || focusables.length === 0) return;
      const first = focusables[0]!;
      const last = focusables[focusables.length - 1]!;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", onKeyDown);
    // The page behind must not scroll while a full-screen layer is up.
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
      returnFocusRef.current?.focus?.();
    };
  }, [open, dismiss, step]);

  // Tell the caller which Moment is showing, so it can REPLACE the ?moment=
  // parameter — stepping through the sequence must not push a history entry
  // per swipe, or Back would have to unwind every step.
  useEffect(() => {
    if (open) onActiveChange?.(active);
  }, [open, active, onActiveChange]);

  // Resume a video at the position the card was at.
  useEffect(() => {
    if (!open || !videoRef.current || initialVideoTime <= 0) return;
    videoRef.current.currentTime = initialVideoTime;
  }, [open, initialVideoTime]);

  if (!open) return null;

  const progress = Math.min(Math.abs(dragY) / 400, 1);
  // The backdrop thins as the media is dragged away, so the gesture reads as
  // "pulling the photo off the screen" rather than a modal that just vanishes.
  const backdropOpacity = 1 - progress * 0.6;

  function onPointerDown(event: React.PointerEvent) {
    // Zoomed-in panning must not be read as a dismissal drag.
    if (zoomed || isVideo) return;
    startRef.current = { x: event.clientX, y: event.clientY, t: event.timeStamp };
    setDragging(true);
  }

  function onPointerMove(event: React.PointerEvent) {
    const start = startRef.current;
    if (!start || !dragging) return;
    const deltaY = event.clientY - start.y;
    // A clearly horizontal gesture is Moment navigation, not dismissal, so the
    // media must not follow the finger downward while it happens.
    if (Math.abs(event.clientX - start.x) > Math.abs(deltaY)) {
      setDragY(0);
      return;
    }
    // Downward only. An upward drag is not a dismissal, and allowing it would
    // fight the vertical scroll of the page underneath.
    setDragY(deltaY > 0 ? deltaY : 0);
  }

  function onPointerUp(event: React.PointerEvent) {
    const start = startRef.current;
    startRef.current = null;
    setDragging(false);
    if (!start) return;

    const distanceX = event.clientX - start.x;
    const distance = event.clientY - start.y;
    // Horizontal wins when it dominates: swipe left/right steps through the
    // sequence and never dismisses.
    if (Math.abs(distanceX) > Math.abs(distance) && Math.abs(distanceX) > 48) {
      setDragY(0);
      step(distanceX < 0 ? 1 : -1);
      return;
    }
    const elapsed = Math.max(event.timeStamp - start.t, 1);
    const velocity = distance / elapsed;
    const far = distance > window.innerHeight * DISMISS_THRESHOLD;
    const fast = velocity > DISMISS_VELOCITY;

    if (far || fast) dismiss();
    // Under the threshold: spring back rather than dismissing.
    else setDragY(0);
  }

  const alt = active.caption?.trim() || `Moment from ${active.authorName}`;

  return (
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-label={`${alt}, full screen`}
      className="fixed inset-0 z-[100] flex items-center justify-center overscroll-none"
      style={{
        backgroundColor: `rgba(0,0,0,${backdropOpacity})`,
        transition: dragging || reducedMotion ? "none" : "background-color 200ms ease-out"
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      <button
        ref={closeRef}
        type="button"
        onClick={dismiss}
        aria-label="Close full screen"
        className="focus-ring absolute right-3 top-[max(0.75rem,env(safe-area-inset-top))] z-10 grid h-10 w-10 place-items-center rounded-full bg-black/50 text-white backdrop-blur-sm"
      >
        <X className="h-5 w-5" aria-hidden="true" />
      </button>

      {items.length > 1 && !zoomed ? (
        <>
          <button
            type="button"
            onClick={() => step(-1)}
            aria-label="Previous Moment"
            className="focus-ring absolute left-2 top-1/2 z-10 grid h-11 w-11 -translate-y-1/2 place-items-center rounded-full bg-black/45 text-white backdrop-blur-sm"
          >
            <ChevronLeft className="h-5 w-5" aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={() => step(1)}
            aria-label="Next Moment"
            className="focus-ring absolute right-2 top-1/2 z-10 grid h-11 w-11 -translate-y-1/2 place-items-center rounded-full bg-black/45 text-white backdrop-blur-sm"
          >
            <ChevronRight className="h-5 w-5" aria-hidden="true" />
          </button>
          <p className="absolute bottom-[max(1rem,env(safe-area-inset-bottom))] left-1/2 z-10 -translate-x-1/2 text-xs font-medium text-white/70">
            {activeIndex + 1} of {items.length}
          </p>
        </>
      ) : null}

      <div
        className={cn("flex max-h-full w-full items-center justify-center", zoomed && "overflow-auto")}
        style={{
          transform: `translateY(${dragY}px) scale(${1 - progress * 0.08})`,
          transition: dragging || reducedMotion ? "none" : "transform 220ms cubic-bezier(0.2, 0, 0, 1)"
        }}
      >
        {isText ? (
          <p className="max-w-md whitespace-pre-wrap px-6 text-center text-lg leading-7 text-white">
            {active.textContent}
          </p>
        ) : isVideo ? (
          <video
            ref={videoRef}
            src={(activeIndex === 0 ? fullResUrl : null) ?? active.mediaUrl ?? undefined}
            controls
            playsInline
            // Never restarts: the position is set from initialVideoTime above
            // and handed back on the way out.
            onTimeUpdate={(event) => onVideoTimeChange?.(event.currentTarget.currentTime)}
            aria-label={alt}
            className="max-h-[100dvh] w-full bg-black object-contain"
          />
        ) : (
          <button
            type="button"
            // Double-tap/click toggles zoom. While zoomed, swipe-to-dismiss is
            // disabled above so panning the image cannot dismiss by accident.
            onDoubleClick={() => setZoomed((current) => !current)}
            aria-label={zoomed ? "Zoom out" : "Zoom in"}
            className="focus-ring block w-full"
          >
            <MomentImage
              src={(activeIndex === 0 ? fullResUrl : null) ?? active.mediaUrl}
              alt={alt}
              priority
              // object-contain: the whole image fits, letterboxed. Cropping a
              // photo the viewer deliberately opened full-screen would defeat
              // the point.
              className={cn(
                "mx-auto max-h-[100dvh] w-full object-contain transition-transform duration-200 motion-reduce:transition-none",
                zoomed && "scale-[1.75]"
              )}
              fallbackClassName="rounded-none bg-transparent text-white/70"
            />
          </button>
        )}
      </div>

      {/* THE MOMENT'S IDENTITY LAYER.
          Previously the viewer showed media and nothing else — no caption, no
          author, no time — so a full-screen Moment was an anonymous picture.
          The caption now reads as part of the media rather than as a row
          beneath it, which is the whole idea of the Hero language.

          Hidden while zoomed or dragging: both are moments when the viewer
          wants the photograph and nothing on top of it. */}
      {!zoomed && !isText ? (
        <div
          className="pointer-events-none absolute inset-x-0 bottom-0 z-10"
          style={{
            opacity: dragging ? 0 : 1,
            transition: reducedMotion ? "none" : "opacity 180ms ease-out"
          }}
        >
          {/* The same progressive ramp the Hero uses: stacked, upward-masked
              bands so there is never a hard edge across the picture. */}
          <div aria-hidden="true" className="absolute inset-x-0 bottom-0 h-40">
            {[0.4, 0.7, 1].map((step, index) => (
              <div
                key={step}
                className="absolute inset-x-0 bottom-0"
                style={{
                  height: `${step * 100}%`,
                  backdropFilter: `blur(${(index + 1) * 6}px)`,
                  WebkitBackdropFilter: `blur(${(index + 1) * 6}px)`,
                  maskImage: "linear-gradient(to top, black 40%, transparent 100%)",
                  WebkitMaskImage: "linear-gradient(to top, black 40%, transparent 100%)"
                }}
              />
            ))}
            <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/35 to-transparent" />
          </div>

          <div className="relative space-y-2 px-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-6 text-white">
            {active.caption ? (
              <p className="text-[0.9375rem] leading-snug text-white/95">{active.caption}</p>
            ) : null}
            <div className="flex items-center gap-2 text-[0.8125rem] text-white/75">
              <UserAvatar
                src={active.authorAvatarUrl}
                name={active.authorName}
                size="xs"
                membershipTier={publicMembershipTier(active.authorPlan)}
                decorative
              />
              <span className="truncate font-semibold text-white">{active.authorName}</span>
              <span aria-hidden="true">·</span>
              <time dateTime={active.createdAt}>{formatRelativeTime(active.createdAt)}</time>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
