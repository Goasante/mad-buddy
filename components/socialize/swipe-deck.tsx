"use client";

import type { Route } from "next";
import Link from "next/link";
import { ArrowLeft, ArrowRight, RotateCcw, X } from "lucide-react";
import { FeatureIcon } from "@/components/ui/feature-icon";
import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";

import { haptic } from "@/lib/device/haptics";

import { PremiumPlanBadge } from "@/components/premium/premium-plan-badge";
import { TrustedMemberMark } from "@/components/trust/trusted-member-mark";
import { GlowAvatar } from "@/components/glow/glow-avatar";
import { publicMembershipTier } from "@/lib/billing/premium-identity";
import { presenceLabel } from "@/lib/presence/freshness";
import {
  DECK_PERSPECTIVE,
  DECK_VISIBLE_CARDS,
  canWave,
  cardTransform,
  depthTransform,
  dragDirection,
  isHorizontalSwipe,
  resolveSwipe,
  stackStyle,
  swipeProgress,
  type DeckDecision
} from "@/lib/social/swipe-deck";
import type { SocializePerson } from "@/lib/social/socialize-mobile";
import { cn } from "@/lib/utils";

/**
 * The Linkr people deck.
 *
 * A stack of cards: swipe right to wave, left to pass, tap to open a profile.
 * All the decision logic — thresholds, direction, stack depth, eligibility —
 * lives in `lib/social/swipe-deck.ts` and is unit tested. This component owns
 * pointers, transforms and paint, and nothing else.
 *
 * WHAT THE CARD SHOWS, and why it is not more: a portrait, a name, a
 * membership badge where one is real, an approximate proximity phrase and the
 * person's own note. There is no age, no occupation, no verification tick and
 * no exact distance, because the product has none of those. A card that
 * renders them would be inventing facts about a real person.
 *
 * Accessibility: swiping is an enhancement, never the only route. The three
 * buttons under the deck are the canonical controls — they carry the same
 * actions, are reachable by keyboard, and are what a screen reader announces.
 */

const PROXIMITY_LABEL: Record<string, string> = {
  close: "Close by",
  near: "Nearby",
  far: "Around you"
};

/**
 * The live drag, tagged with the card it belongs to.
 *
 * `userId` is part of the state rather than a ref because a refreshed feed can
 * replace the top card mid-gesture, and the new card must not inherit the
 * previous card's offset. Storing the owner alongside the offset lets the
 * comparison happen during render — an effect that reset it would paint one
 * frame with the stale transform applied to the wrong person.
 */
type Drag = { userId: string | null; dx: number; dy: number; velocity: number };
const NO_DRAG: Drag = { userId: null, dx: 0, dy: 0, velocity: 0 };

export type SwipeDeckProps = {
  people: readonly SocializePerson[];
  onWave: (person: SocializePerson) => void;
  onPass: (person: SocializePerson) => void;
  /** Instant undo of the last skip. Absent when there is nothing in session. */
  onUndo?: () => void;
  /** Opens the full list of skipped people. Always available. */
  onOpenSkipped?: () => void;
  pending?: boolean;
};

export function SwipeDeck({
  people,
  onWave,
  onPass,
  onUndo,
  onOpenSkipped,
  pending = false
}: SwipeDeckProps) {
  const [drag, setDrag] = useState<Drag>(NO_DRAG);
  /** The card flying off screen, so its exit animates before it unmounts. */
  const [exiting, setExiting] = useState<{ userId: string; decision: DeckDecision } | null>(null);
  // Shown once per mount, then never again. See the note above showHint.
  const [showSwipeHint, setShowSwipeHint] = useState(true);

  const pointerRef = useRef<{ id: number; x: number; y: number; time: number } | null>(null);
  const cardRef = useRef<HTMLDivElement | null>(null);
  /**
   * Pointer moves are coalesced to one state update per animation frame.
   *
   * A touch screen can deliver well over 120 pointermove events a second, and
   * re-rendering the whole stack on each one is what makes a drag feel heavy.
   * The latest position is held here and flushed on the next frame, so the
   * card tracks the thumb at display rate instead of event rate.
   */
  const frameRef = useRef<number | null>(null);
  const pendingRef = useRef<Drag | null>(null);
  /** The in-flight exit timer, so a rapid second swipe can cancel it. */
  const exitTimerRef = useRef<number | null>(null);

  const top = people[0] ?? null;

  // A pending exit must not fire into an unmounted deck.
  useEffect(
    () => () => {
      if (exitTimerRef.current !== null) window.clearTimeout(exitTimerRef.current);
      if (frameRef.current !== null) window.cancelAnimationFrame(frameRef.current);
    },
    []
  );

  // Retires on its own after one cycle, so it does not sit there indefinitely
  // for someone reading the card rather than acting on it.
  useEffect(() => {
    if (!showSwipeHint) return;
    const timer = window.setTimeout(() => setShowSwipeHint(false), 4200);
    return () => window.clearTimeout(timer);
  }, [showSwipeHint]);

  // The drag applies only to the card it started on. Derived, never synced.
  const activeDrag = top && drag.userId === top.userId ? drag : NO_DRAG;

  const commit = useCallback(
    (person: SocializePerson, decision: DeckDecision) => {
      // Fires when the decision is made, not when the animation ends -- the
      // tick should land under the thumb that made it. Waving is the
      // affirmative choice and gets the firmer of the two patterns.
      haptic(decision === "wave" ? "select" : "tick");

      // ONE DECISION PER GESTURE. A queued exit from the previous card is
      // dropped rather than left to fire later: its callback would clear the
      // NEW card's exit state mid-flight and hand the parent a second
      // decision for a person already dealt with.
      if (exitTimerRef.current !== null) {
        window.clearTimeout(exitTimerRef.current);
        exitTimerRef.current = null;
      }

      setExiting({ userId: person.userId, decision });
      setDrag(NO_DRAG);
      // Let the exit transition play before the parent removes the person.
      // 300ms matches the shared motion timing; the callback is what actually
      // mutates the deck, so a dropped frame delays the animation, never the
      // action.
      exitTimerRef.current = window.setTimeout(() => {
        exitTimerRef.current = null;
        // Cleared by identity, not blindly: if a newer card is already
        // exiting, this stale callback must leave it alone.
        setExiting((current) => (current?.userId === person.userId ? null : current));
        if (decision === "wave") onWave(person);
        else onPass(person);
      }, 260);
    },
    [onWave, onPass]
  );

  function handlePointerDown(event: React.PointerEvent) {
    // Touching the deck at all proves the affordance was understood.
    setShowSwipeHint(false);

    // GATED ON THE DECK'S OWN STATE, never on the network.
    //
    // This used to include `pending`, which is the page's useTransition flag
    // covering the wave/pass request. Every swipe fires one, so the deck
    // locked itself for the whole round trip: the first swipe worked, and the
    // next was dropped before pointerRef was even set. On a slow connection it
    // stayed dead for seconds, and the card gave no sign why -- the buttons
    // kept working, because they call commit() directly and never reach here.
    //
    // `exiting` stays: a card mid-flight is genuinely not draggable, and that
    // window is 260ms of local animation rather than an unbounded wait.
    if (!top || exiting) return;
    // Ignore secondary buttons and anything starting on a real control.
    if (event.button !== 0) return;
    pointerRef.current = { id: event.pointerId, x: event.clientX, y: event.clientY, time: event.timeStamp };
  }

  function handlePointerMove(event: React.PointerEvent) {
    const start = pointerRef.current;
    if (!start || start.id !== event.pointerId) return;

    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;

    // Until the gesture is clearly horizontal it belongs to the page, so the
    // deck neither captures the pointer nor moves. This is what lets a user
    // scroll past the deck without passing on three people.
    if (!isHorizontalSwipe({ dx, dy })) return;

    if (cardRef.current && !cardRef.current.hasPointerCapture(event.pointerId)) {
      cardRef.current.setPointerCapture(event.pointerId);
    }

    const elapsed = Math.max(event.timeStamp - start.time, 1);
    pendingRef.current = { userId: top.userId, dx, dy, velocity: dx / elapsed };

    if (frameRef.current === null) {
      frameRef.current = window.requestAnimationFrame(() => {
        frameRef.current = null;
        if (pendingRef.current) setDrag(pendingRef.current);
      });
    }
  }

  /**
   * The pointer was taken away mid-gesture.
   *
   * NEVER RESOLVES A DECISION. A cancel is the browser or the OS saying the
   * gesture is no longer the user's -- a scroll took it over, a phone call
   * arrived, the tab lost the pointer. Reading a decision out of that would
   * wave at somebody because a notification interrupted a scroll, so this only
   * puts the card back.
   *
   * It shares no code with endDrag on purpose: they looked identical when both
   * were pointerup, which is exactly how a cancel came to be treated as a
   * completed swipe.
   */
  function cancelDrag(event: React.PointerEvent) {
    pointerRef.current = null;
    pendingRef.current = null;
    if (frameRef.current !== null) {
      window.cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    }
    if (cardRef.current?.hasPointerCapture(event.pointerId)) {
      cardRef.current.releasePointerCapture(event.pointerId);
    }
    setDrag(NO_DRAG);
  }

  function endDrag(event: React.PointerEvent) {
    const start = pointerRef.current;
    pointerRef.current = null;

    // Drop any frame still queued: landing after the gesture ends would snap
    // the card back to a stale offset.
    if (frameRef.current !== null) {
      window.cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    }
    const finalDrag = pendingRef.current;
    pendingRef.current = null;
    if (!start || !top) {
      setDrag(NO_DRAG);
      return;
    }
    if (cardRef.current?.hasPointerCapture(event.pointerId)) {
      cardRef.current.releasePointerCapture(event.pointerId);
    }

    // Resolve from the final coalesced sample rather than the last rendered
    // one: a fast flick can end before the queued frame commits, and reading
    // stale state there loses the gesture entirely.
    const settled = finalDrag && finalDrag.userId === top.userId ? finalDrag : activeDrag;
    const decision = resolveSwipe(settled);
    // A right swipe on someone with a wave already outstanding springs back
    // rather than firing an action the server would reject.
    if (decision === "wave" && !canWave(top)) {
      setDrag(NO_DRAG);
      return;
    }
    if (decision) commit(top, decision);
    else setDrag(NO_DRAG);
  }

  if (people.length === 0) return null;

  /**
   * The one-time nudge.
   *
   * A stack of cards does not announce that it is swipeable, and the buttons
   * below are easy to read as the only way to act. This shows once per visit
   * and never repeats: a hint that keeps appearing is a distraction, and by
   * the second card the gesture has either been learned or the buttons are
   * being used instead.
   *
   * Hidden the moment a drag or an exit begins -- somebody already swiping
   * does not need to be told to swipe.
   */
  const showHint = showSwipeHint && activeDrag.dx === 0 && !exiting;

  const visible = people.slice(0, DECK_VISIBLE_CARDS);
  const direction = dragDirection(activeDrag.dx);
  const progress = swipeProgress(activeDrag.dx);

  return (
    <div className="linkr-deck-wrap">
      {/* Purely decorative and aria-hidden: the deck already carries a real
          role and label, and the buttons below state both actions in words,
          so a screen reader loses nothing by skipping this. */}
      {showHint ? (
        <div className="linkr-swipe-hint" aria-hidden="true">
          <span className="linkr-swipe-hint-side linkr-swipe-hint-pass">
            <ArrowLeft className="h-4 w-4" />
            Pass
          </span>
          <span className="linkr-swipe-hint-card" />
          <span className="linkr-swipe-hint-side linkr-swipe-hint-wave">
            Wave
            <ArrowRight className="h-4 w-4" />
          </span>
        </div>
      ) : null}

      <div
        className="linkr-deck"
        role="group"
        aria-roledescription="card deck"
        aria-label="People near you"
        style={{ perspective: `${DECK_PERSPECTIVE}px` }}
      >
        {/* Painted back-to-front so the live card sits on top without z-index
            juggling: the last child is index 0. */}
        {visible
          .map((person, index) => ({ person, index }))
          .reverse()
          .map(({ person, index }) => {
            const isTop = index === 0;
            const isExiting = exiting?.userId === person.userId;
            // Cards behind advance a full slot while the front card exits.
            const depth = stackStyle(index, exiting ? 1 : 0);

            /**
             * While the top card flies out, the stack behind it advances by
             * the same fraction, so cards rise forward smoothly instead of
             * snapping one slot when the exiting card unmounts.
             */
            const transform = isExiting
              ? // Fly off in the direction of the decision, well past the
                // viewport edge so the card is gone before it unmounts.
                `translate3d(${exiting.decision === "wave" ? 140 : -140}%, 0, 0) rotate(${
                  exiting.decision === "wave" ? 18 : -18
                }deg)`
              : isTop && activeDrag.dx !== 0
                ? (() => {
                    const t = cardTransform(activeDrag.dx, activeDrag.dy);
                    return `translate3d(${t.x}px, ${t.y}px, 0) rotate(${t.rotate}deg)`;
                  })()
                : depthTransform(depth);

            return (
              <article
                key={person.userId}
                ref={isTop ? cardRef : undefined}
                aria-hidden={!isTop}
                className={cn(
                  "linkr-deck-card",
                  isTop && "linkr-deck-card-live",
                  // Suppress the settle transition while the thumb is down, or
                  // the card lags behind the pointer.
                  isTop && activeDrag.dx !== 0 && !isExiting ? "linkr-deck-card-active" : null,
                  // The exit runs on its own longer curve.
                  isExiting && "linkr-deck-card-exiting"
                )}
                style={{
                  transform,
                  opacity: isExiting ? 0 : depth.opacity,
                  zIndex: depth.zIndex,
                  // Dimming and blur recede the stack without touching the
                  // live card, which always resolves to brightness(1) blur(0).
                  filter: `brightness(${depth.brightness}) blur(${depth.blur}px)`
                }}
                onPointerDown={isTop ? handlePointerDown : undefined}
                onPointerMove={isTop ? handlePointerMove : undefined}
                onPointerUp={isTop ? endDrag : undefined}
                onPointerCancel={isTop ? cancelDrag : undefined}
              >
                <PersonFace person={person} interactive={isTop} />

                {/* Live swipe stamps. Opacity tracks the drag, so the meaning of
                    the gesture is visible before it commits rather than only
                    after. */}
                {isTop ? (
                  <>
                    <span
                      aria-hidden="true"
                      className="linkr-stamp linkr-stamp-wave"
                      style={{ opacity: direction === "right" ? progress : 0 }}
                    >
                      Wave
                    </span>
                    <span
                      aria-hidden="true"
                      className="linkr-stamp linkr-stamp-pass"
                      style={{ opacity: direction === "left" ? progress : 0 }}
                    >
                      Skip
                    </span>
                  </>
                ) : null}
              </article>
            );
          })}
      </div>

      {/* THE CANONICAL CONTROLS. Swiping is a shortcut for these, not a
          replacement — every action here is reachable by keyboard and
          announced properly. */}
      <div className="linkr-deck-actions">
        <button
          type="button"
          className={cn(
            "linkr-deck-action linkr-deck-action-pass",
            // Lights with the drag, so the gesture and the button read as the
            // same action rather than two separate ways to do it.
            direction === "left" && "linkr-deck-action-armed"
          )}
          style={{ "--linkr-arm": direction === "left" ? progress : 0 } as CSSProperties}
          // Also freed from `pending`. Optimistic actions mean the previous
          // decision is already applied locally; blocking the next one on its
          // network call just makes the deck feel broken.
          disabled={!top || Boolean(exiting)}
          onClick={() => top && commit(top, "pass")}
          aria-label={top ? `Skip ${top.displayName || top.username}` : "Skip"}
        >
          <X className="h-5 w-5" aria-hidden="true" />
        </button>

        {/* Undo sits between the two decisions because it belongs to whichever
            one just happened. Rendered disabled rather than removed, so the
            row never reflows after the first swipe. */}
        {/* One control, two jobs. The last skip undoes instantly; with nothing
            in session it opens the full list instead of sitting disabled.
            A disabled recovery control is worst exactly when it is needed —
            after a reload, when the in-memory undo is already gone. */}
        <button
          type="button"
          className="linkr-deck-action linkr-deck-action-undo"
          disabled={pending || (!onUndo && !onOpenSkipped)}
          onClick={() => (onUndo ? onUndo() : onOpenSkipped?.())}
          aria-label={onUndo ? "Undo last skip" : "See people you skipped"}
        >
          <RotateCcw className="h-4 w-4" aria-hidden="true" />
        </button>

        <button
          type="button"
          className={cn(
            "linkr-deck-action linkr-deck-action-wave",
            direction === "right" && "linkr-deck-action-armed"
          )}
          style={{ "--linkr-arm": direction === "right" ? progress : 0 } as CSSProperties}
          // Freed from `pending` alongside pass. Leaving it here meant the two
          // halves of the same row disagreed: on a slow connection pass stayed
          // live while wave went dead, which reads as the wave button being
          // broken rather than as the deck waiting. `canWave` stays -- that is
          // about this person, not about the network.
          disabled={!top || Boolean(exiting) || !canWave(top)}
          onClick={() => top && commit(top, "wave")}
          aria-label={
            top
              ? canWave(top)
                ? `Wave at ${top.displayName || top.username}`
                : "Wave already sent"
              : "Wave"
          }
        >
          <FeatureIcon feature="wave" size={20} decorative />
        </button>
      </div>
    </div>
  );
}

/**
 * The face of a card: portrait, identity, proximity.
 *
 * Split out so the stacked cards behind the live one render identically
 * without duplicating the markup — a back card that differs from the front is
 * what makes a deck look fake as it advances.
 */
function PersonFace({ person, interactive }: { person: SocializePerson; interactive: boolean }) {
  const name = person.displayName || person.username;
  const profileHref = `/friends/${person.username}` as Route;

  // A hedged presence REPLACES proximity: if we are unsure they are still
  // there, we must not also claim how close they are.
  const hedge = presenceLabel(person.presenceState);
  const isActiveNow = person.presenceState === "fresh";
  const proximity = PROXIMITY_LABEL[person.proximityTier] ?? null;
  const locationLine = hedge ?? proximity;

  return (
    <>
      <div className="linkr-deck-photo">
        {person.avatarUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- signed avatar URL, not a static asset
          <img
            src={person.avatarUrl}
            alt=""
            loading="lazy"
            decoding="async"
            draggable={false}
            className="h-full w-full object-cover"
          />
        ) : (
          <span className="grid h-full w-full place-items-center bg-secondary/40">
            <GlowAvatar
              name={name}
              src={null}
              size="xl"
              proximityLevel={person.proximityTier}
              membershipTier={publicMembershipTier(person.plan)}
            />
          </span>
        )}

        {/* The scrim the name sits on. Without it a bright photo swallows the
            text entirely. */}
        <span aria-hidden="true" className="linkr-deck-scrim" />

        {isActiveNow ? (
          <span className="linkr-deck-presence">
            <span className="linkr-deck-dot" aria-hidden="true" />
            Active now
          </span>
        ) : null}
      </div>

      <div className="linkr-deck-identity">
        <p className="linkr-deck-name">
          {interactive ? (
            <Link href={profileHref} className="focus-ring truncate hover:underline">
              {name}
            </Link>
          ) : (
            <span className="truncate">{name}</span>
          )}
          {/* TWO SEPARATE SIGNALS, never merged into one badge: membership is
              a plan someone pays for, Trusted Member is standing they earned
              and staff approved. Both compact, so the name keeps the weight
              and neither competes with proximity or the action beneath. */}
          <PremiumPlanBadge plan={person.plan} compact />
          <TrustedMemberMark trustedSince={person.trustedSince} compact />
        </p>

        {/* Their own words when they wrote any, otherwise proximity. Never an
            invented occupation. */}
        {person.note ? <p className="linkr-deck-note">{person.note}</p> : null}

        {locationLine ? (
          <p className="linkr-deck-meta">
            <span className="linkr-deck-pin" aria-hidden="true" />
            {locationLine}
          </p>
        ) : null}
      </div>
    </>
  );
}
