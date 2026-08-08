"use client";

import type { Route } from "next";
import Link from "next/link";
import { Heart, RotateCcw, X } from "lucide-react";
import { useCallback, useRef, useState, type CSSProperties } from "react";

import { PremiumPlanBadge } from "@/components/premium/premium-plan-badge";
import { GlowAvatar } from "@/components/glow/glow-avatar";
import { publicMembershipTier } from "@/lib/billing/premium-identity";
import { presenceLabel } from "@/lib/presence/freshness";
import {
  DECK_VISIBLE_CARDS,
  canWave,
  cardTransform,
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
  /** Absent when there is nothing to undo. */
  onUndo?: () => void;
  pending?: boolean;
};

export function SwipeDeck({ people, onWave, onPass, onUndo, pending = false }: SwipeDeckProps) {
  const [drag, setDrag] = useState<Drag>(NO_DRAG);
  /** The card flying off screen, so its exit animates before it unmounts. */
  const [exiting, setExiting] = useState<{ userId: string; decision: DeckDecision } | null>(null);

  const pointerRef = useRef<{ id: number; x: number; y: number; time: number } | null>(null);
  const cardRef = useRef<HTMLDivElement | null>(null);

  const top = people[0] ?? null;

  // The drag applies only to the card it started on. Derived, never synced.
  const activeDrag = top && drag.userId === top.userId ? drag : NO_DRAG;

  const commit = useCallback(
    (person: SocializePerson, decision: DeckDecision) => {
      setExiting({ userId: person.userId, decision });
      setDrag(NO_DRAG);
      // Let the exit transition play before the parent removes the person.
      // 300ms matches the shared motion timing; the callback is what actually
      // mutates the deck, so a dropped frame delays the animation, never the
      // action.
      window.setTimeout(() => {
        setExiting(null);
        if (decision === "wave") onWave(person);
        else onPass(person);
      }, 260);
    },
    [onWave, onPass]
  );

  function handlePointerDown(event: React.PointerEvent) {
    if (!top || pending || exiting) return;
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
    setDrag({ userId: top.userId, dx, dy, velocity: dx / elapsed });
  }

  function endDrag(event: React.PointerEvent) {
    const start = pointerRef.current;
    pointerRef.current = null;
    if (!start || !top) {
      setDrag(NO_DRAG);
      return;
    }
    if (cardRef.current?.hasPointerCapture(event.pointerId)) {
      cardRef.current.releasePointerCapture(event.pointerId);
    }

    const decision = resolveSwipe(activeDrag);
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

  const visible = people.slice(0, DECK_VISIBLE_CARDS);
  const direction = dragDirection(activeDrag.dx);
  const progress = swipeProgress(activeDrag.dx);

  return (
    <div className="linkr-deck-wrap">
      <div className="linkr-deck" role="group" aria-roledescription="card deck" aria-label="People near you">
        {/* Painted back-to-front so the live card sits on top without z-index
            juggling: the last child is index 0. */}
        {visible
          .map((person, index) => ({ person, index }))
          .reverse()
          .map(({ person, index }) => {
            const isTop = index === 0;
            const depth = stackStyle(index);
            const isExiting = exiting?.userId === person.userId;

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
                : `translate3d(0, ${depth.translateY}px, 0) scale(${depth.scale})`;

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
                  (isTop && activeDrag.dx !== 0) || isExiting ? "linkr-deck-card-active" : null
                )}
                style={{ transform, opacity: isExiting ? 0 : depth.opacity, zIndex: DECK_VISIBLE_CARDS - index }}
                onPointerDown={isTop ? handlePointerDown : undefined}
                onPointerMove={isTop ? handlePointerMove : undefined}
                onPointerUp={isTop ? endDrag : undefined}
                onPointerCancel={isTop ? endDrag : undefined}
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
          disabled={!top || pending}
          onClick={() => top && commit(top, "pass")}
          aria-label={top ? `Skip ${top.displayName || top.username}` : "Skip"}
        >
          <X className="h-5 w-5" aria-hidden="true" />
        </button>

        {/* Undo sits between the two decisions because it belongs to whichever
            one just happened. Rendered disabled rather than removed, so the
            row never reflows after the first swipe. */}
        <button
          type="button"
          className="linkr-deck-action linkr-deck-action-undo"
          disabled={!onUndo || pending}
          onClick={() => onUndo?.()}
          aria-label="Undo last skip"
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
          disabled={!top || pending || !canWave(top)}
          onClick={() => top && commit(top, "wave")}
          aria-label={
            top
              ? canWave(top)
                ? `Wave at ${top.displayName || top.username}`
                : "Wave already sent"
              : "Wave"
          }
        >
          <Heart className="h-5 w-5" aria-hidden="true" />
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
          {/* Membership, never presented as identity verification. */}
          <PremiumPlanBadge plan={person.plan} compact />
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
