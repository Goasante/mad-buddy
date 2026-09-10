import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { stripComments } from "@/lib/content/strip-comments";
import { LONG_PRESS_DURATION_MS, LONG_PRESS_MOVE_TOLERANCE_PX } from "@/hooks/use-long-press";

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");
const hook = stripComments(read("hooks/use-long-press.ts"));
const page = stripComments(read("components/friends/friends-page.tsx"));
const grid = stripComments(read("components/friends/muddies-grid.tsx"));

describe("press and hold matches the platform convention", () => {
  it("fires at the duration both iOS and Android use", () => {
    // Shorter fires while someone is still deciding; longer feels broken.
    expect(LONG_PRESS_DURATION_MS).toBe(500);
  });

  it("cancels when the finger moves, so a scroll is not a hold", () => {
    // Without this, every attempt to scroll a horizontal rail would open a
    // menu under the finger.
    expect(LONG_PRESS_MOVE_TOLERANCE_PX).toBeGreaterThan(0);
    expect(hook).toContain("onPointerMove");
    expect(hook).toContain("if (movedFar) clear()");
  });

  it("clears the timer on unmount", () => {
    // A press interrupted by navigation must not fire into a component that no
    // longer exists.
    expect(hook).toContain("useEffect(() => clear, [clear])");
  });

  it("suppresses the click that follows a fired hold", () => {
    // Otherwise the element's own tap action runs too, opening the profile
    // behind the menu that just appeared.
    expect(hook).toContain("firedRef");
    expect(hook).toContain("event.preventDefault()");
    expect(hook).toContain("event.stopPropagation()");
  });

  it("maps right-click to the same menu, so it is not mobile-only", () => {
    expect(hook).toContain("onContextMenu");
  });

  it("ignores non-primary buttons on pointer down", () => {
    // A right-click must go through onContextMenu once, not start a hold too.
    expect(hook).toContain("if (event.button !== 0) return");
  });
});

describe("being online never hides an action", () => {
  it("gives the Active-now strip the same actions as a list row", () => {
    // Active Muddies move OUT of the list and into the strip, which previously
    // offered only "open profile" — so Remove became unreachable for anyone
    // who happened to be online.
    expect(page).toContain("renderActions={muddyActions}");
  });

  it("defines those actions exactly once", () => {
    // Two definitions is how an action ends up on one surface and missing from
    // the other.
    expect(page.match(/const muddyActions =/g) ?? []).toHaveLength(1);
  });

  it("includes Remove among them", () => {
    const actions = page.slice(page.indexOf("const muddyActions ="));
    expect(actions.slice(0, 1600)).toContain('label: "Remove Muddy"');
    expect(actions.slice(0, 1600)).toContain("removeFriendAction(user.id)");
  });

  it("opens the strip menu by hold rather than a visible button", () => {
    // The gesture is the affordance; the trigger exists only to anchor the
    // menu, so it is inert and invisible.
    const avatar = page.slice(page.indexOf("function ActiveNowAvatar"));
    expect(avatar.slice(0, 2200)).toContain("useLongPress(() => setMenuOpen(true))");
    expect(avatar.slice(0, 2200)).toContain("pointer-events-none");
  });

  it("carries the same actions onto the My Muddies list rows", () => {
    // "My Muddies" (the All tab) used to be a two-column card grid
    // (MuddiesGrid) with its own long-press wiring; it now renders the same
    // MuddyRow list item Close Friends/Circles already use, via
    // renderUserRow, so there is only one place actions are wired for a
    // Muddy rather than a second copy that could drift from the first.
    expect(page).toContain("gridPeople.map(renderUserRow)");
    expect(page).toContain("const renderUserRow = (user: UserSummary) =>");
  });

  it("does not arm the unused grid card's gesture when there is nothing to show", () => {
    // MuddiesGrid itself is unused today (see above) but stays in the tree in
    // case another surface needs the card layout; its own long-press guard
    // must still hold if that ever happens.
    expect(grid).toContain("disabled: !hasActions");
  });
});
