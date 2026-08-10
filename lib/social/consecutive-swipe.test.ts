import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { stripComments } from "@/lib/content/strip-comments";
import { removeFromDeck, resolveSwipe, restoreToDeck } from "@/lib/social/swipe-deck";
import type { SocializePerson } from "@/lib/social/socialize-mobile";

/**
 * Consecutive swiping.
 *
 * THE BUG THESE EXIST FOR: the first swipe worked and the next was silently
 * dropped. `handlePointerDown` returned early on `pending` -- the page's
 * useTransition flag, which stays true for the whole wave/pass round trip.
 * Every swipe fires one, so the deck locked itself out for as long as the
 * network took, and on a slow connection stayed dead for seconds.
 *
 * The buttons kept working throughout, because they call commit() directly
 * and never reach pointerdown. That asymmetry is what made it look like a
 * gesture problem rather than a lock.
 */

const deck = stripComments(read("components/socialize/swipe-deck.tsx"));

function read(path: string) {
  return readFileSync(join(process.cwd(), path), "utf8");
}

function person(userId: string): SocializePerson {
  return { userId, waveState: "none" } as SocializePerson;
}

const A = person("a");
const B = person("b");
const C = person("c");
const D = person("d");

const COMMIT_DISTANCE = 120;

/** A settled drag past the commit threshold, in the given direction. */
function flick(userId: string, direction: "wave" | "pass") {
  const dx = direction === "wave" ? COMMIT_DISTANCE : -COMMIT_DISTANCE;
  return { userId, dx, dy: 0, velocity: dx / 200 };
}

// ---------------------------------------------------------------------------
// The lock that caused it
// ---------------------------------------------------------------------------

describe("the gesture is never gated on the network", () => {
  it("does not block pointerdown while a request is in flight", () => {
    // THE FIX. `pending` is the page's transition flag; gating the gesture on
    // it meant one swipe disabled the next for a whole round trip.
    const handler = deck.slice(deck.indexOf("function handlePointerDown"));
    const guard = handler.slice(0, handler.indexOf("}"));
    expect(guard).toContain("if (!top || exiting) return;");
    expect(guard).not.toContain("pending ||");
  });

  it("does not block the action buttons on it either", () => {
    // Optimistic actions mean the previous decision is already applied
    // locally; blocking the next on its network call feels broken.
    expect(deck).toContain("disabled={!top || Boolean(exiting)}");
  });

  it("still blocks a card that is mid-flight", () => {
    // 260ms of local animation, not an unbounded wait.
    expect(deck).toContain("if (!top || exiting) return;");
  });

  it("keeps undo gated, where a race would matter", () => {
    // Undo is a rollback; letting it race a decision in flight could restore
    // the wrong person.
    expect(deck).toContain("disabled={pending || (!onUndo && !onOpenSkipped)}");
  });
});

// ---------------------------------------------------------------------------
// TESTS 1-3: consecutive decisions advance the stack
// ---------------------------------------------------------------------------

describe("every card in the stack can be decided in turn", () => {
  it("advances through consecutive right swipes", () => {
    let people = [A, B, C];

    expect(resolveSwipe(flick("a", "wave"))).toBe("wave");
    people = removeFromDeck(people, "a");
    expect(people[0]?.userId).toBe("b");

    expect(resolveSwipe(flick("b", "wave"))).toBe("wave");
    people = removeFromDeck(people, "b");
    expect(people[0]?.userId).toBe("c");
  });

  it("advances through consecutive left swipes", () => {
    let people = [A, B, C];

    expect(resolveSwipe(flick("a", "pass"))).toBe("pass");
    people = removeFromDeck(people, "a");
    expect(people[0]?.userId).toBe("b");

    expect(resolveSwipe(flick("b", "pass"))).toBe("pass");
    people = removeFromDeck(people, "b");
    expect(people[0]?.userId).toBe("c");
  });

  it("advances through alternating directions", () => {
    let people = [A, B, C, D];

    for (const [id, direction] of [
      ["a", "wave"],
      ["b", "pass"],
      ["c", "wave"]
    ] as const) {
      expect(resolveSwipe(flick(id, direction))).toBe(direction);
      people = removeFromDeck(people, id);
    }

    expect(people).toHaveLength(1);
    expect(people[0]?.userId).toBe("d");
  });

  it("removes by identity, so a reorder cannot drop the wrong person", () => {
    // A concurrent refresh may reorder the feed between decisions.
    const reordered = [C, A, B];
    expect(removeFromDeck(reordered, "a").map((entry) => entry.userId)).toEqual(["c", "b"]);
  });
});

// ---------------------------------------------------------------------------
// TESTS 4-6: state resets, and one gesture means one decision
// ---------------------------------------------------------------------------

describe("a completed swipe leaves no state behind", () => {
  it("clears the drag on commit", () => {
    expect(deck).toContain("setDrag(NO_DRAG)");
  });

  it("cancels a queued frame when the gesture ends", () => {
    // A frame landing after the gesture would snap the card to a stale offset.
    const end = deck.slice(deck.indexOf("function endDrag"));
    expect(end.slice(0, 500)).toContain("window.cancelAnimationFrame(frameRef.current)");
    expect(end.slice(0, 500)).toContain("frameRef.current = null");
  });

  it("releases pointer capture", () => {
    const end = deck.slice(deck.indexOf("function endDrag"));
    expect(end.slice(0, 900)).toContain("releasePointerCapture(event.pointerId)");
  });

  it("ties the drag to the card it began on", () => {
    // Derived rather than synced, so a drag can never apply to a card that
    // was promoted underneath it.
    expect(deck).toContain("top && drag.userId === top.userId ? drag : NO_DRAG");
  });

  it("cancels the previous exit when a second swipe lands quickly", () => {
    // Otherwise the older timer fires into the newer card.
    const commit = deck.slice(deck.indexOf("const commit = useCallback"));
    expect(commit.slice(0, 1200)).toContain("window.clearTimeout(exitTimerRef.current)");
  });

  it("clears the exit only for the card that owns it", () => {
    // TEST 5: a stale callback must not clear a newer card's exit.
    expect(deck).toContain("current?.userId === person.userId ? null : current");
  });

  it("cleans up timers and frames on unmount", () => {
    expect(deck).toContain("if (exitTimerRef.current !== null) window.clearTimeout(exitTimerRef.current)");
  });

  it("produces exactly one decision per gesture", () => {
    // Only pointerup and pointercancel end a drag, and both route through
    // endDrag; there is no transitionend path that could advance again.
    expect(deck).not.toContain("onTransitionEnd");
    expect(deck).toContain("onPointerUp={isTop ? endDrag : undefined}");
    expect(deck).toContain("onPointerCancel={isTop ? endDrag : undefined}");
  });
});

// ---------------------------------------------------------------------------
// TESTS 7-8: buttons and gestures interleave
// ---------------------------------------------------------------------------

describe("buttons and swipes share one path", () => {
  it("routes both through commit", () => {
    // Same haptics, same exit animation, same advancement -- so a button
    // press cannot leave the deck in a state a swipe would not.
    expect(deck).toContain('commit(top, "wave")');
    expect(deck).toContain('commit(top, "pass")');
    expect(deck).toContain("if (decision) commit(top, decision);");
  });

  it("leaves the deck swipeable after a button press", () => {
    // Nothing in the button path sets a lock a gesture would then hit: both
    // clear on the same exit timer.
    const buttons = deck.slice(deck.indexOf("linkr-deck-action"));
    expect(buttons).not.toContain("setPending");
  });
});

// ---------------------------------------------------------------------------
// TESTS 9-10: identity and layering
// ---------------------------------------------------------------------------

describe("only the top card is interactive", () => {
  it("keys each card by person, not by index", () => {
    // An index key would let React reuse the element and carry gesture state
    // from one candidate to the next.
    expect(deck).toContain("key={person.userId}");
    expect(deck).not.toContain("key={index}");
  });

  it("attaches handlers to the top card alone", () => {
    for (const handler of ["onPointerDown", "onPointerMove", "onPointerUp", "onPointerCancel"]) {
      expect(deck, `${handler} must be top-only`).toContain(`${handler}={isTop ?`);
    }
  });

  it("hides the cards behind from assistive tech", () => {
    expect(deck).toContain("aria-hidden={!isTop}");
  });

  it("handles a cancelled gesture by restoring the card", () => {
    // A cancel must not leave the deck locked; endDrag is the same path.
    expect(deck).toContain("onPointerCancel={isTop ? endDrag : undefined}");
    const end = deck.slice(deck.indexOf("function endDrag"));
    expect(end.slice(0, 700)).toContain("setDrag(NO_DRAG)");
  });

  it("leaves vertical scrolling to the page", () => {
    const css = read("app/globals.css");
    const rule = css.slice(css.indexOf(".linkr-deck {"));
    expect(rule.slice(0, rule.indexOf("}"))).toContain("touch-action: pan-y");
  });
});

// ---------------------------------------------------------------------------
// Undo still works after consecutive passes
// ---------------------------------------------------------------------------

describe("undo restores the most recent pass", () => {
  it("puts the person back at the top", () => {
    let people = [A, B, C];
    people = removeFromDeck(people, "a");
    people = restoreToDeck(people, A);
    expect(people[0]?.userId).toBe("a");
  });

  it("does not duplicate someone a refresh already restored", () => {
    expect(restoreToDeck([A, B], A).filter((entry) => entry.userId === "a")).toHaveLength(1);
  });
});
