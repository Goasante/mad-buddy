"use client";

import { useCallback, useRef, useState } from "react";
import { BadgeCheck, Hand, RotateCcw, X } from "lucide-react";

import { nextPhotoIndex, previousPhotoIndex, tapZone } from "@/lib/linkr/photos";
import type { LinkrCandidate } from "@/lib/linkr/candidate-service";
import { cn } from "@/lib/utils";

/**
 * The candidate card. The person is the hero: a full-bleed portrait with the
 * details laid over its foot, and no chrome competing with their face.
 *
 * THE INTERACTION MODEL, which is deliberate and is the reason the two
 * gestures are separated so carefully:
 *
 *   tap left third   previous photo      -- explores the person
 *   tap right        next photo          -- explores the person
 *   swipe left       Pass                -- decides about the person
 *   swipe right      Connect             -- decides about the person
 *
 * Tap explores, swipe decides. A tap that accidentally reads as a decision is
 * the worst failure this component can have, so the drag threshold is
 * generous and a gesture that has not clearly committed snaps back.
 *
 * SWIPE IS NEVER THE ONLY WAY. The Pass and Connect buttons below are real
 * controls with accessible names, reachable by keyboard and screen reader, and
 * every gesture here has a button equivalent.
 */

export type CandidateCardProps = {
  candidate: LinkrCandidate;
  onPass: () => void;
  onConnect: () => void;
  onUndo?: () => void;
  canUndo?: boolean;
  busy?: boolean;
};

/** How far a drag must travel before it counts as a decision. */
const COMMIT_PX = 110;

/** One compositor-friendly transform for stationary, dragged and exiting cards. */
export function linkrCardTransform(offset: number): string {
  return `translate3d(${offset}px, 0, 0) rotate(${offset / 26}deg)`;
}

export function CandidateCard({
  candidate,
  onPass,
  onConnect,
  onUndo,
  canUndo = false,
  busy = false
}: CandidateCardProps) {
  const [photoIndex, setPhotoIndex] = useState(0);
  const [drag, setDrag] = useState(0);
  const [leaving, setLeaving] = useState<"pass" | "connect" | null>(null);
  /**
   * Whether a pointer is currently down, as STATE rather than only a ref.
   *
   * The transition below has to differ while dragging (none, so the card
   * tracks the finger exactly) and after release (eased, so it snaps back).
   * Reading the ref during render to decide that is a render-phase ref read --
   * React may not re-render when a ref changes, so the value is unreliable
   * precisely when it matters. The ref is kept for the pointer identity and
   * start coordinates, which are only ever read inside handlers.
   */
  const [dragging, setDragging] = useState(false);
  const surfaceRef = useRef<HTMLDivElement | null>(null);
  const pointerStart = useRef<{ x: number; y: number; id: number } | null>(null);
  const moved = useRef(false);

  const photos = candidate.photos.length > 0 ? candidate.photos : [""];
  const total = photos.length;
  /**
   * The photos either side of the current one. Recomputed per render rather
   * than memoised: it is two array lookups, and a stale memo here would defeat
   * the entire point by warming the wrong images.
   */
  const neighbourPhotos = [photos[photoIndex - 1], photos[photoIndex + 1]].filter(
    (url): url is string => Boolean(url)
  );

  // A new person means a new card, starting at their first photo. This needs
  // no effect: the parent renders this component with key={candidate.userId},
  // so a different person remounts it and every piece of state above resets to
  // its initial value.

  const decide = useCallback(
    (decision: "pass" | "connect") => {
      if (busy || leaving) return;
      setLeaving(decision);
      // Let the card clear the screen before the parent swaps in the next one,
      // so a decision reads as the card leaving rather than as a flicker.
      window.setTimeout(() => (decision === "pass" ? onPass() : onConnect()), 180);
    },
    [busy, leaving, onPass, onConnect]
  );

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (busy || leaving) return;
    pointerStart.current = { x: event.clientX, y: event.clientY, id: event.pointerId };
    setDragging(true);
    moved.current = false;
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const start = pointerStart.current;
    if (!start || start.id !== event.pointerId) return;
    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;
    // Vertical intent belongs to the page, not the card: a scroll must not be
    // read as a decision.
    if (Math.abs(dy) > Math.abs(dx) && Math.abs(dy) > 12) {
      pointerStart.current = null;
      setDragging(false);
      setDrag(0);
      return;
    }
    if (Math.abs(dx) > 6) moved.current = true;
    setDrag(dx);
  };

  const handlePointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    const start = pointerStart.current;
    pointerStart.current = null;
    setDragging(false);
    if (!start || start.id !== event.pointerId) return;

    const dx = event.clientX - start.x;
    if (dx <= -COMMIT_PX) return decide("pass");
    if (dx >= COMMIT_PX) return decide("connect");

    // Not a decision. If it was not really a drag either, it was a tap, and a
    // tap navigates photos.
    if (!moved.current && surfaceRef.current) {
      const rect = surfaceRef.current.getBoundingClientRect();
      const zone = tapZone(event.clientX - rect.left, rect.width);
      setPhotoIndex((current) =>
        zone === "previous" ? previousPhotoIndex(current) : nextPhotoIndex(current, total)
      );
    }
    setDrag(0);
  };

  const offset = leaving === "pass" ? -520 : leaving === "connect" ? 520 : drag;
  const intent = drag <= -60 ? "pass" : drag >= 60 ? "connect" : null;

  return (
    <div className="linkr-card-stage">
      <div
        ref={surfaceRef}
        className={cn("linkr-card", leaving && "is-leaving")}
        style={{
          transform: linkrCardTransform(offset),
          transition: dragging ? "none" : "transform 180ms ease-out"
        }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={() => {
          pointerStart.current = null;
          setDragging(false);
          setDrag(0);
        }}
      >
        {photos[photoIndex] ? (
          // eslint-disable-next-line @next/next/no-img-element -- signed, short-lived media URLs
          <img
            src={photos[photoIndex]}
            alt={`${candidate.displayName}, photo ${photoIndex + 1} of ${total}`}
            className="linkr-card__photo"
            draggable={false}
          />
        ) : (
          <div className="linkr-card__photo linkr-card__photo--empty" aria-hidden />
        )}

        {/* The neighbouring photos, fetched but not shown. Tapping through a
            card should not flash a blank frame while the next image loads, and
            the browser cache is the cheapest possible way to do that -- no
            preloader, no new pipeline. Only the immediate neighbours, so a
            four-photo card never fetches more than it needs. */}
        {neighbourPhotos.map((url) => (
          // eslint-disable-next-line @next/next/no-img-element -- warming the cache
          <img key={url} src={url} alt="" aria-hidden className="linkr-card__preload" />
        ))}

        <div className="linkr-card__scrim" aria-hidden />

        {/* Photo progress. Reference shows a segmented bar; segments are also
            easier to read at a glance than dots when there are four. */}
        {total > 1 ? (
          <div className="linkr-card__progress" aria-hidden>
            {photos.map((photo, index) => (
              <span
                key={`${photo}-${index}`}
                className={cn("linkr-card__progress-seg", index === photoIndex && "is-active")}
              />
            ))}
          </div>
        ) : null}

        <div className="linkr-card__meta">
          {candidate.activeNow ? <span className="linkr-chip linkr-chip--live">Active now</span> : null}
          {/* Only when there is somewhere to go. "1/1" is chrome that
              describes nothing and invites a tap that does nothing. */}
          {total > 1 ? (
            <span className="linkr-card__counter">
              {photoIndex + 1}/{total}
            </span>
          ) : null}
        </div>

        {/* Decision feedback, shown only while a drag is actually committing. */}
        {intent ? (
          <div className={cn("linkr-card__verdict", `is-${intent}`)} aria-hidden>
            {intent === "pass" ? "Pass" : "Connect"}
          </div>
        ) : null}

        <div className="linkr-card__body">
          <h2 className="linkr-card__name">
            {candidate.displayName}
            {candidate.age !== null ? `, ${candidate.age}` : ""}
            {candidate.isVerifiedAccount ? (
              <BadgeCheck className="linkr-card__verified" aria-label="Verified account" />
            ) : null}
          </h2>

          <p className="linkr-card__proximity">
            <span className="linkr-card__proximity-dot" aria-hidden />
            {candidate.eventName ? `${candidate.proximityLabel} · ${candidate.eventName}` : candidate.proximityLabel}
          </p>

          {candidate.interests.length > 0 ? (
            <ul className="linkr-card__interests">
              {candidate.interests.slice(0, 3).map((interest) => (
                <li key={interest} className="linkr-chip">
                  {interest}
                </li>
              ))}
            </ul>
          ) : null}

          {candidate.bio ? <p className="linkr-card__bio">{candidate.bio}</p> : null}
        </div>
      </div>

      {/* The accessible path. Every gesture above has an equivalent here. */}
      <div className="linkr-actions">
        <button
          type="button"
          className="linkr-action linkr-action--pass"
          onClick={() => decide("pass")}
          disabled={busy || Boolean(leaving)}
        >
          <X aria-hidden />
          <span>Pass</span>
        </button>

        <button
          type="button"
          className="linkr-action linkr-action--undo"
          onClick={onUndo}
          disabled={!canUndo || busy || Boolean(leaving)}
        >
          <RotateCcw aria-hidden />
          <span>Undo</span>
        </button>

        <button
          type="button"
          className="linkr-action linkr-action--connect"
          onClick={() => decide("connect")}
          disabled={busy || Boolean(leaving)}
        >
          <Hand aria-hidden />
          <span>Connect</span>
        </button>
      </div>

      {/* Keyboard-only photo navigation. The card surface handles pointers;
          these give the same reach without one, and are announced. */}
      {total > 1 ? (
        <div className="linkr-photo-nav">
          <button
            type="button"
            onClick={() => setPhotoIndex((current) => previousPhotoIndex(current))}
            disabled={photoIndex === 0}
            aria-label={`Previous photo of ${candidate.displayName}`}
          >
            ‹
          </button>
          <span aria-live="polite">
            Photo {photoIndex + 1} of {total}
          </span>
          <button
            type="button"
            onClick={() => setPhotoIndex((current) => nextPhotoIndex(current, total))}
            disabled={photoIndex === total - 1}
            aria-label={`Next photo of ${candidate.displayName}`}
          >
            ›
          </button>
        </div>
      ) : null}
    </div>
  );
}
