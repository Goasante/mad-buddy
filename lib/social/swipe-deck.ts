/**
 * Linkr discovery deck — the pure decision layer.
 *
 * Everything here is a function of its arguments: no React, no DOM, no clock
 * reads, no network. The card component owns pointers and CSS; this owns what
 * a gesture MEANS. That split is what makes the deck testable — swipe physics
 * are miserable to assert through a rendered component, and trivial to assert
 * as arithmetic.
 */

import type { SocializePerson } from "@/lib/social/socialize-mobile";

/** The three outcomes of a card leaving the deck. */
export type DeckDecision = "wave" | "pass";

/** Which way a card is being dragged, once it passes the noise floor. */
export type DeckDirection = "left" | "right" | "none";

/**
 * Commit thresholds.
 *
 * A card commits on EITHER distance or velocity: a slow deliberate drag past
 * the distance threshold, or a quick flick that never travels far. Requiring
 * distance alone makes flicks feel broken; requiring velocity alone makes
 * careful drags feel unresponsive.
 */
export const DECK_COMMIT_DISTANCE = 96;
/** px per ms. Roughly a brisk flick, well above an accidental twitch. */
export const DECK_COMMIT_VELOCITY = 0.45;
/** Below this, a drag is a tap or a scroll attempt, not a swipe. */
export const DECK_NOISE_FLOOR = 8;

export type DragState = {
  /** Horizontal travel from where the pointer went down. */
  dx: number;
  /** Vertical travel. Used only to detect a scroll, never to commit. */
  dy: number;
  /** Horizontal px per ms over the gesture. */
  velocity: number;
};

/**
 * Is this gesture a horizontal swipe, or is the user trying to scroll the page?
 *
 * The deck sits inside a vertically scrolling page, so it must not swallow
 * vertical drags. A gesture belongs to the deck only when it is clearly more
 * horizontal than vertical — otherwise the page keeps it, and a user trying to
 * scroll past the deck does not accidentally pass on three people.
 */
export function isHorizontalSwipe({ dx, dy }: Pick<DragState, "dx" | "dy">): boolean {
  const absX = Math.abs(dx);
  const absY = Math.abs(dy);
  if (absX < DECK_NOISE_FLOOR) return false;
  return absX > absY * 1.2;
}

/** Which way the card is leaning right now, for live affordance rendering. */
export function dragDirection(dx: number): DeckDirection {
  if (Math.abs(dx) < DECK_NOISE_FLOOR) return "none";
  return dx > 0 ? "right" : "left";
}

/**
 * Should this drag commit, and to what?
 *
 * Right is the affirmative gesture (wave) and left is the dismissal (pass),
 * matching the near-universal convention. Returns null when the card should
 * spring back.
 */
export function resolveSwipe(drag: DragState): DeckDecision | null {
  if (!isHorizontalSwipe(drag)) return null;

  const travelled = Math.abs(drag.dx) >= DECK_COMMIT_DISTANCE;
  const flicked = Math.abs(drag.velocity) >= DECK_COMMIT_VELOCITY;
  if (!travelled && !flicked) return null;

  return drag.dx > 0 ? "wave" : "pass";
}

/**
 * How far through the commit is this drag, 0 to 1?
 *
 * Drives the live opacity of the WAVE / PASS stamps, so the affordance appears
 * progressively rather than snapping on at the threshold. Clamped, so
 * overdragging does not push opacity past 1.
 */
export function swipeProgress(dx: number): number {
  return Math.min(Math.abs(dx) / DECK_COMMIT_DISTANCE, 1);
}

/**
 * Card transform for a given drag.
 *
 * Rotation is proportional to travel and capped, which is what makes the card
 * feel like a physical object pivoting under the thumb rather than a div
 * sliding. The cap matters: uncapped rotation on a long drag spins the card to
 * an absurd angle.
 */
export function cardTransform(dx: number, dy: number): { x: number; y: number; rotate: number } {
  const rotate = Math.max(-14, Math.min(14, dx / 14));
  return { x: dx, y: dy * 0.35, rotate };
}

/**
 * Depth styling for a card at position `index` in the stack.
 *
 * Index 0 is live; the rest are scaled down and pushed back to read as a
 * physical pile. Only three are rendered — beyond that the difference is
 * invisible and each extra card is a wasted image fetch.
 */
export const DECK_VISIBLE_CARDS = 3;

export function stackStyle(index: number): { scale: number; translateY: number; opacity: number } {
  if (index === 0) return { scale: 1, translateY: 0, opacity: 1 };
  if (index >= DECK_VISIBLE_CARDS) return { scale: 0.9, translateY: 24, opacity: 0 };
  return {
    scale: 1 - index * 0.05,
    translateY: index * 12,
    opacity: 1
  };
}

/**
 * A person the viewer already waved at cannot be waved at again.
 *
 * The deck asks before offering the gesture, so a right-swipe never fires an
 * action the server would reject. `received` is excluded too: they waved
 * first, so the affirmative action is accepting, which the card routes
 * through its own control rather than a swipe.
 */
export function canWave(person: Pick<SocializePerson, "waveState">): boolean {
  return person.waveState === "none";
}

/**
 * Remove a decided person from the deck.
 *
 * Returns a new array; the caller holds it in state. Filtering by id rather
 * than splicing by index means a concurrent refresh that reorders the feed
 * cannot remove the wrong person.
 */
export function removeFromDeck(
  people: readonly SocializePerson[],
  userId: string
): SocializePerson[] {
  return people.filter((person) => person.userId !== userId);
}

/**
 * Restore an undone pass to the front of the deck.
 *
 * Undo puts the card back where it was seen — at the top — rather than at its
 * original sort position, which may be pages away. Guards against duplication
 * if a refresh already re-added them.
 */
export function restoreToDeck(
  people: readonly SocializePerson[],
  person: SocializePerson
): SocializePerson[] {
  if (people.some((existing) => existing.userId === person.userId)) {
    return [...people];
  }
  return [person, ...people];
}
