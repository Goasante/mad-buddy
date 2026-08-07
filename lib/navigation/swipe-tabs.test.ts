import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  decideSwipe,
  isSwipeExempt,
  nextTabId,
  SWIPE_AXIS_RATIO,
  SWIPE_DISTANCE_THRESHOLD,
  SWIPE_OPT_OUT_ATTRIBUTE
} from "@/lib/navigation/swipe-tabs";
import { stripComments } from "@/lib/content/strip-comments";

/**
 * Swipeable Muddies tabs.
 *
 * The gesture's value is mostly in what it REFUSES to do. A tab strip that
 * changes tab when the user was scrolling a list, or dragging the avatar rail,
 * is worse than one that does not swipe at all — so most of these tests are
 * about the swipe not firing.
 */

const TABS = ["all", "circles", "close", "requests", "blocked"] as const;
const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");
const page = stripComments(read("components/friends/friends-page.tsx"));
const hook = stripComments(read("hooks/use-swipe-tabs.ts"));

/** A deliberate horizontal swipe of `distance` px over a natural duration. */
const swipe = (distance: number, deltaY = 0, elapsedMs = 220) => ({
  deltaX: distance,
  deltaY,
  elapsedMs
});

// ---------------------------------------------------------------------------
// Direction
// ---------------------------------------------------------------------------

describe("swipe direction", () => {
  it("swiping left advances to the next tab", () => {
    // Finger travels right-to-left, so deltaX is negative and the content
    // moves the way the finger did.
    expect(decideSwipe(swipe(-120))).toEqual({ kind: "next" });
    expect(nextTabId(TABS, "all", { kind: "next" })).toBe("circles");
  });

  it("swiping right returns to the previous tab", () => {
    expect(decideSwipe(swipe(120))).toEqual({ kind: "previous" });
    expect(nextTabId(TABS, "circles", { kind: "previous" })).toBe("all");
  });

  it("a fast flick counts even when it is short", () => {
    // Confident swipes are quick and cover little ground; without a velocity
    // path they feel broken.
    const flick = { deltaX: -32, deltaY: 0, elapsedMs: 40 };
    expect(decideSwipe(flick)).toEqual({ kind: "next" });
  });
});

// ---------------------------------------------------------------------------
// Boundaries
// ---------------------------------------------------------------------------

describe("boundaries", () => {
  it("does nothing before the first tab", () => {
    expect(nextTabId(TABS, "all", { kind: "previous" })).toBeNull();
  });

  it("does nothing past the last tab", () => {
    expect(nextTabId(TABS, "blocked", { kind: "next" })).toBeNull();
  });

  it("never wraps around the ends", () => {
    // Wrapping would make one confident swipe jump the entire strip, and the
    // user cannot tell a wrap from a mis-swipe.
    expect(nextTabId(TABS, "blocked", { kind: "next" })).not.toBe("all");
    expect(nextTabId(TABS, "all", { kind: "previous" })).not.toBe("blocked");
  });

  it("ignores a tab id that is not in the strip", () => {
    expect(nextTabId(TABS, "ghost" as (typeof TABS)[number], { kind: "next" })).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Refusals — the important half
// ---------------------------------------------------------------------------

describe("accidental gestures", () => {
  it("ignores a small drag", () => {
    expect(decideSwipe(swipe(SWIPE_DISTANCE_THRESHOLD - 10)).kind).toBe("ignore");
  });

  it("ignores a vertical scroll", () => {
    expect(decideSwipe({ deltaX: 4, deltaY: 200, elapsedMs: 300 })).toEqual({
      kind: "ignore",
      reason: "too-vertical"
    });
  });

  it("ignores a diagonal scroll that drifts sideways", () => {
    // The real failure mode: a thumb scrolling a long list wanders sideways.
    // A plain |dx| > |dy| test would fire here; the ratio refuses.
    const drifting = { deltaX: 90, deltaY: 100, elapsedMs: 300 };
    expect(Math.abs(drifting.deltaX)).toBeGreaterThan(SWIPE_DISTANCE_THRESHOLD);
    expect(decideSwipe(drifting).kind).toBe("ignore");
  });

  it("rejects vertical intent before distance, not after", () => {
    // A long, fast, mostly-vertical drag travels far enough horizontally to
    // pass a distance-first check. Axis must be tested first.
    const longScroll = { deltaX: 140, deltaY: 400, elapsedMs: 250 };
    expect(decideSwipe(longScroll)).toEqual({ kind: "ignore", reason: "too-vertical" });
  });

  it("accepts a swipe that is comfortably past the axis ratio", () => {
    const clean = { deltaX: -150, deltaY: 150 / SWIPE_AXIS_RATIO - 10, elapsedMs: 220 };
    expect(decideSwipe(clean).kind).toBe("next");
  });
});

// ---------------------------------------------------------------------------
// Nested horizontal content
// ---------------------------------------------------------------------------

describe("nested horizontal content", () => {
  /**
   * A minimal stand-in for the parts of Element the walker touches.
   *
   * The suite runs in the `node` environment, matching every other test here,
   * so rather than pull in jsdom for four assertions this models exactly the
   * surface `isSwipeExempt` uses: `hasAttribute`, the scroll sizes, and
   * `parentElement`.
   */
  function element(
    { optOut = false, scrollable = false }: { optOut?: boolean; scrollable?: boolean } = {},
    parent?: Element
  ): Element {
    return {
      hasAttribute: (name: string) => optOut && name === SWIPE_OPT_OUT_ATTRIBUTE,
      scrollWidth: scrollable ? 500 : 100,
      clientWidth: 100,
      parentElement: parent ?? null
    } as unknown as Element;
  }

  it("exempts a subtree that opts out", () => {
    expect(isSwipeExempt(element({ optOut: true }))).toBe(true);
  });

  it("exempts a child deep inside an opted-out rail", () => {
    // The pointer lands on an avatar, not on the rail that declared the
    // opt-out, so the check has to walk upward.
    const rail = element({ optOut: true });
    const avatar = element({}, element({}, rail));
    expect(isSwipeExempt(avatar)).toBe(true);
  });

  it("does not exempt ordinary content", () => {
    expect(isSwipeExempt(element())).toBe(false);
  });

  it("stops walking at the gesture root", () => {
    // Anything above the swipe container is irrelevant; an unrelated ancestor
    // scroller must not disable tab swiping for the whole page.
    const outer = element({ optOut: true });
    const root = element({}, outer);
    const child = element({}, root);
    expect(isSwipeExempt(child, root)).toBe(false);
  });

  it("the Muddies avatar rail declares the opt-out", () => {
    expect(page).toContain(`{...{ [SWIPE_OPT_OUT_ATTRIBUTE]: "" }}`);
  });

  it("the tab strip itself opts out, so it can scroll to reach Blocked", () => {
    // The opt-out sits on the scrolling wrapper that CONTAINS the tablist, so
    // the assertion looks between the tour marker that opens that wrapper and
    // the tablist itself.
    const wrapperStart = page.indexOf("TOUR_TARGET_IDS.MUDDIES_TABS");
    const stripStart = page.indexOf('role="tablist"');
    expect(wrapperStart).toBeGreaterThan(-1);
    expect(wrapperStart).toBeLessThan(stripStart);
    expect(page.slice(wrapperStart, stripStart)).toContain("SWIPE_OPT_OUT_ATTRIBUTE");
  });
});

// ---------------------------------------------------------------------------
// Pointer handling
// ---------------------------------------------------------------------------

describe("pointer handling", () => {
  it("ignores mouse drags, which are text selection", () => {
    expect(hook).toContain('event.pointerType === "mouse"');
  });

  it("abandons a gesture that turns vertical mid-drag", () => {
    expect(hook).toContain("startRef.current = null");
  });

  it("resets rather than commits when the pointer is cancelled", () => {
    // The browser taking over for a scroll must not change tab.
    expect(hook).toContain("onPointerCancel");
  });
});

// ---------------------------------------------------------------------------
// Accessibility and the page wiring
// ---------------------------------------------------------------------------

describe("accessibility", () => {
  it("uses tablist, tab and tabpanel semantics", () => {
    expect(page).toContain('role="tablist"');
    expect(page).toContain('role="tab"');
    expect(page).toContain('role="tabpanel"');
  });

  it("marks the selected tab with aria-selected", () => {
    expect(page).toContain("aria-selected={activeTab === tab.id}");
  });

  it("links each tab to its panel", () => {
    expect(page).toContain("aria-controls={`muddies-panel-${tab.id}`}");
    expect(page).toContain("aria-labelledby={`muddies-tab-${activeTab}`}");
  });

  it("uses a roving tabindex so the strip is one tab stop", () => {
    expect(page).toContain("tabIndex={activeTab === tab.id ? 0 : -1}");
  });

  it("supports arrow, Home and End keys", () => {
    expect(page).toContain('event.key === "ArrowRight"');
    expect(page).toContain('event.key === "ArrowLeft"');
    expect(page).toContain('event.key === "Home"');
    expect(page).toContain('event.key === "End"');
  });

  it("keeps tapping a tab working", () => {
    // Swipe is an addition, never the only way through.
    expect(page).toContain("onClick={() => selectTab(tab.id)}");
  });
});

describe("motion", () => {
  it("respects reduced motion", () => {
    expect(page).toContain("reducedMotion");
    expect(page).toContain("transition: swiping || reducedMotion ? undefined");
  });

  it("lets the browser keep vertical scrolling", () => {
    // pan-y: this element owns horizontal movement, the page keeps vertical.
    expect(page).toContain('touchAction: "pan-y"');
  });
});

describe("URL synchronisation", () => {
  it("writes the tab to the query string", () => {
    expect(page).toContain('params.set("tab", id)');
  });

  it("replaces rather than pushes, so Back leaves the page", () => {
    // Pushing would bury the previous page under one history entry per swipe.
    expect(page).toContain("router.replace(");
    expect(page).toContain("{ scroll: false }");
  });

  it("derives the open tab from the URL rather than mirroring it in state", () => {
    // One source of truth: Back, Forward, a deep link and a tap cannot
    // disagree, and there is no effect copying the query parameter into state.
    expect(page).toContain("const activeTab: FriendTab = tabIds.includes(requestedTab as FriendTab)");
    expect(page).not.toContain("setActiveTab(");
  });

  it("validates the tab from the URL before trusting it", () => {
    // An unrecognised ?tab= falls back to "all" instead of rendering nothing.
    // Asserted as single-line tokens: this file is CRLF, so a multi-line
    // `toContain` with "\n" would never match.
    expect(page).toContain("tabIds.includes(requestedTab as FriendTab)");
    expect(page).toContain(': "all"');
  });

  it("routes tap, swipe and keyboard through one selector", () => {
    // One code path means the URL, the indicator and the cleared filters can
    // never disagree about which tab is open.
    expect(page).toContain("const selectTab = useCallback(");
    expect(page).toContain("onSelect: selectTab");
  });
});
