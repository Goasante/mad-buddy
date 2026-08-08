import { describe, expect, it } from "vitest";

import {
  DECK_COMMIT_DISTANCE,
  DECK_COMMIT_VELOCITY,
  DECK_VISIBLE_CARDS,
  canWave,
  cardTransform,
  dragDirection,
  isHorizontalSwipe,
  removeFromDeck,
  resolveSwipe,
  restoreToDeck,
  stackStyle,
  swipeProgress
} from "@/lib/social/swipe-deck";
import type { SocializePerson } from "@/lib/social/socialize-mobile";

function person(overrides: Partial<SocializePerson> = {}): SocializePerson {
  return {
    userId: "user-1",
    presenceState: "fresh",
    lastPresenceUpdate: null,
    approxDistance: null,
    displayName: "Ama",
    username: "ama",
    avatarUrl: null,
    activity: "chilling",
    note: null,
    plan: "free",
    proximityTier: "close",
    waveState: "none",
    ...overrides
  } as SocializePerson;
}

describe("gesture ownership", () => {
  it("ignores drags below the noise floor so a tap is never a swipe", () => {
    expect(isHorizontalSwipe({ dx: 4, dy: 0 })).toBe(false);
    expect(dragDirection(4)).toBe("none");
  });

  it("leaves vertical drags to the page so the deck cannot hijack scrolling", () => {
    // The deck sits in a scrolling page. A mostly-vertical drag must not
    // commit, or scrolling past the deck would pass on people.
    expect(isHorizontalSwipe({ dx: 30, dy: 120 })).toBe(false);
    expect(resolveSwipe({ dx: 30, dy: 120, velocity: 1 })).toBeNull();
  });

  it("claims clearly horizontal drags", () => {
    expect(isHorizontalSwipe({ dx: 120, dy: 20 })).toBe(true);
  });
});

describe("commit thresholds", () => {
  it("commits on distance alone, with no velocity", () => {
    expect(resolveSwipe({ dx: DECK_COMMIT_DISTANCE, dy: 0, velocity: 0 })).toBe("wave");
  });

  it("commits on a flick that never travels the full distance", () => {
    // Requiring distance alone makes quick flicks feel broken.
    expect(resolveSwipe({ dx: 40, dy: 0, velocity: DECK_COMMIT_VELOCITY })).toBe("wave");
  });

  it("springs back on a short slow drag", () => {
    expect(resolveSwipe({ dx: 40, dy: 0, velocity: 0.1 })).toBeNull();
  });

  it("maps right to wave and left to pass", () => {
    expect(resolveSwipe({ dx: 200, dy: 0, velocity: 1 })).toBe("wave");
    expect(resolveSwipe({ dx: -200, dy: 0, velocity: -1 })).toBe("pass");
  });
});

describe("live affordance", () => {
  it("ramps progress and clamps at 1 so overdragging cannot exceed full opacity", () => {
    expect(swipeProgress(0)).toBe(0);
    expect(swipeProgress(DECK_COMMIT_DISTANCE / 2)).toBeCloseTo(0.5);
    expect(swipeProgress(DECK_COMMIT_DISTANCE * 5)).toBe(1);
  });

  it("caps rotation so a long drag never spins the card absurdly", () => {
    expect(cardTransform(4000, 0).rotate).toBe(14);
    expect(cardTransform(-4000, 0).rotate).toBe(-14);
  });

  it("dampens vertical travel so the card tracks the thumb without drifting off", () => {
    expect(cardTransform(0, 100).y).toBeCloseTo(35);
  });
});

describe("stack depth", () => {
  it("leaves the live card completely untouched by the depth effect", () => {
    // The card being decided on must never be dimmed, blurred or tilted by
    // the treatment applied to the stack behind it.
    const live = stackStyle(0);
    expect(live.translateZ).toBeCloseTo(0);
    expect(live.rotateY).toBeCloseTo(0);
    expect(live.blur).toBeCloseTo(0);
    expect(live.brightness).toBe(1);
    expect(live.opacity).toBe(1);
  });

  it("recedes each card further back, dimmer and blurrier", () => {
    expect(stackStyle(2).translateZ).toBeLessThan(stackStyle(1).translateZ);
    expect(stackStyle(2).brightness).toBeLessThan(stackStyle(1).brightness);
    expect(stackStyle(2).blur).toBeGreaterThan(stackStyle(1).blur);
    expect(stackStyle(2).zIndex).toBeLessThan(stackStyle(1).zIndex);
  });

  it("shares one tilt angle rather than fanning further with depth", () => {
    // Clamped: an unclamped tilt turns the stack into a splayed fan.
    expect(stackStyle(3).rotateY).toBe(stackStyle(1).rotateY);
  });

  it("advances smoothly as a card leaves, rather than snapping a slot", () => {
    // Mid-exit, card 1 sits between its own position and the live one.
    const mid = stackStyle(1, 0.5);
    expect(mid.translateZ).toBeGreaterThan(stackStyle(1).translateZ);
    expect(mid.translateZ).toBeLessThan(stackStyle(0).translateZ + 1);
  });

  it("hides cards beyond the visible depth rather than paying for their images", () => {
    expect(stackStyle(DECK_VISIBLE_CARDS).opacity).toBe(0);
  });
});

describe("wave eligibility", () => {
  it("offers a wave only when none is outstanding", () => {
    expect(canWave(person({ waveState: "none" }))).toBe(true);
  });

  it("refuses a second wave, so a swipe never fires an action the server rejects", () => {
    expect(canWave(person({ waveState: "sent" }))).toBe(false);
  });

  it("refuses on an inbound wave, which is an accept rather than a wave", () => {
    expect(canWave(person({ waveState: "received" }))).toBe(false);
  });
});

describe("deck mutation", () => {
  const deck = [person({ userId: "a" }), person({ userId: "b" }), person({ userId: "c" })];

  it("removes by id, not index, so a concurrent reorder cannot drop the wrong person", () => {
    expect(removeFromDeck(deck, "b").map((p) => p.userId)).toEqual(["a", "c"]);
  });

  it("leaves the deck untouched when the id is absent", () => {
    expect(removeFromDeck(deck, "zzz")).toHaveLength(3);
  });

  it("restores an undone pass to the front, where the user last saw it", () => {
    const undone = person({ userId: "b" });
    expect(restoreToDeck([person({ userId: "a" })], undone).map((p) => p.userId)).toEqual(["b", "a"]);
  });

  it("does not duplicate someone a refresh already re-added", () => {
    expect(restoreToDeck(deck, person({ userId: "a" }))).toHaveLength(3);
  });

  it("never mutates the array it was given", () => {
    const original = [...deck];
    removeFromDeck(deck, "a");
    restoreToDeck(deck, person({ userId: "z" }));
    expect(deck).toEqual(original);
  });
});
