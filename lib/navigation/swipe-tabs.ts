/**
 * Horizontal swipe-between-tabs, as a pure decision.
 *
 * Kept out of the component so the rules that actually matter — what counts as
 * a horizontal intent, what must never steal the gesture, what happens at the
 * ends of the list — are testable without a DOM, a pointer, or a browser.
 *
 * The hard part of a swipeable tab strip is not moving the tab. It is
 * NOT moving it: a page full of vertical scrolling, horizontal avatar rails,
 * carousels and row actions gives a naive handler a dozen ways to fire when
 * the user meant something else. Every rule below exists to refuse.
 */

/** Minimum horizontal travel before a drag is a tab change, in px. */
export const SWIPE_DISTANCE_THRESHOLD = 56;

/**
 * How much more horizontal than vertical the gesture must be.
 *
 * A plain `|dx| > |dy|` check fires on a diagonal flick during a scroll. A
 * ratio makes the gesture declare itself: at 1.5 the finger has to travel
 * clearly sideways, which a scrolling thumb does not do.
 */
export const SWIPE_AXIS_RATIO = 1.5;

/** A fast flick counts even when short, in px per ms. */
export const SWIPE_VELOCITY_THRESHOLD = 0.45;

/**
 * The DOM attribute that opts a subtree OUT of tab swiping.
 *
 * Placed on anything horizontally scrollable or independently draggable — an
 * avatar rail, a carousel, a swipe-to-act row. Consulted by walking up from
 * the gesture's target, so a nested scroller keeps its own gesture and never
 * has to know a tab strip exists above it.
 */
export const SWIPE_OPT_OUT_ATTRIBUTE = "data-no-tab-swipe";

export type SwipeSample = {
  /** Horizontal travel, positive when the finger moved right. */
  deltaX: number;
  /** Vertical travel, positive when the finger moved down. */
  deltaY: number;
  /** Milliseconds between pointer down and up. */
  elapsedMs: number;
};

export type SwipeDecision =
  | { kind: "ignore"; reason: "too-short" | "too-vertical" }
  | { kind: "previous" }
  | { kind: "next" };

/**
 * Whether a completed drag should change tabs, and in which direction.
 *
 * Order matters: the axis test runs BEFORE the distance test, so a long
 * vertical scroll with a little sideways wobble is rejected as vertical rather
 * than accepted for having travelled far enough.
 */
export function decideSwipe(sample: SwipeSample): SwipeDecision {
  const { deltaX, deltaY, elapsedMs } = sample;
  const horizontal = Math.abs(deltaX);
  const vertical = Math.abs(deltaY);

  // Vertical intent wins outright. Scrolling a list must never change tab.
  if (horizontal < vertical * SWIPE_AXIS_RATIO) {
    return { kind: "ignore", reason: "too-vertical" };
  }

  const velocity = horizontal / Math.max(elapsedMs, 1);
  const farEnough = horizontal >= SWIPE_DISTANCE_THRESHOLD;
  // A flick is short but decisive. Without this, quick confident swipes feel
  // broken; with it, a slow accidental nudge still does nothing.
  const fastEnough = velocity >= SWIPE_VELOCITY_THRESHOLD && horizontal >= SWIPE_DISTANCE_THRESHOLD / 2;

  if (!farEnough && !fastEnough) {
    return { kind: "ignore", reason: "too-short" };
  }

  // Swiping LEFT (finger moves right-to-left, deltaX negative) advances, the
  // same direction the content moves under the finger.
  return deltaX < 0 ? { kind: "next" } : { kind: "previous" };
}

/**
 * The tab a decision lands on, or null when nothing should change.
 *
 * Boundaries do NOT wrap. Wrapping from Blocked back to All would make a
 * confident swipe jump the whole strip, and the user has no way to tell a wrap
 * from a mis-swipe. Stopping is legible; wrapping is a surprise.
 */
export function nextTabId<T extends string>(
  tabIds: readonly T[],
  currentId: T,
  decision: SwipeDecision
): T | null {
  if (decision.kind === "ignore") return null;
  const index = tabIds.indexOf(currentId);
  if (index === -1) return null;

  const target = decision.kind === "next" ? index + 1 : index - 1;
  if (target < 0 || target >= tabIds.length) return null;
  return tabIds[target] ?? null;
}

/**
 * Whether the gesture began inside something that owns its own horizontal
 * movement.
 *
 * Walks up the ancestor chain from the event target, because the opt-out is
 * declared on the container while the pointer lands on a child deep inside it.
 * Also treats any actually-overflowing horizontal scroller as opted out, so a
 * carousel added later is protected without anyone remembering the attribute.
 */
export function isSwipeExempt(target: Element | null, root?: Element | null): boolean {
  let node: Element | null = target;
  while (node) {
    if (node.hasAttribute?.(SWIPE_OPT_OUT_ATTRIBUTE)) return true;
    // scrollWidth > clientWidth means there is somewhere to scroll sideways.
    // Guarded because the values are 0 in jsdom and on non-rendered nodes.
    if (node.scrollWidth > node.clientWidth + 1) {
      const overflowX = readOverflowX(node);
      if (overflowX === "auto" || overflowX === "scroll") return true;
    }
    if (root && node === root) break;
    node = node.parentElement;
  }
  return false;
}

function readOverflowX(node: Element): string {
  if (typeof window === "undefined" || !window.getComputedStyle) return "";
  try {
    return window.getComputedStyle(node).overflowX;
  } catch {
    return "";
  }
}
