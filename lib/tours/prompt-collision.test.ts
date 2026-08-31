import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const runner = readFileSync(join(process.cwd(), "components/tours/tour-runner.tsx"), "utf8");
// The invitation branch only: from its `if` to the `</aside>` that closes it.
const inviteStart = runner.indexOf('if (phase === "invitation")');
const invitation = runner.slice(inviteStart, runner.indexOf("</aside>", inviteStart));

/**
 * A tour is optional education. It must never take a tap meant for a control
 * underneath it -- least of all a safety control.
 *
 * WHAT HAPPENED. The invitation card is fixed above the bottom navigation and
 * nearly full width, so its padding and artwork covered whatever the page had
 * there. At 390px that was Safe Arrival's "Count me in": elementFromPoint at
 * the button's centre returned the tour's image, and Accept could not be
 * tapped until the tour was dismissed. Found by driving the real screen.
 */
describe("the tour invitation cannot swallow a tap meant for the page", () => {
  it("declares itself non-modal", () => {
    // A prompt nobody asked for does not get to trap interaction.
    expect(invitation).toContain('aria-modal="false"');
  });

  it("lets pointer events pass through the card itself", () => {
    expect(invitation).toContain("pointer-events-none fixed");
  });

  it("keeps its own actions clickable", () => {
    // Passing through must not disarm the prompt's own buttons.
    expect(invitation).toContain("pointer-events-auto");
  });

  it("does not reach for a higher stacking order instead", () => {
    // Raising z-index would hide the collision rather than remove it.
    expect(invitation).not.toContain("z-[99]");
    expect(invitation).toContain("z-[95]");
  });

  it("stays clear of the bottom navigation and the safe area", () => {
    expect(invitation).toContain("bottom-[calc(5.75rem+env(safe-area-inset-bottom,0px))]");
  });
});

describe("safety controls do not move because a tour exists", () => {
  const safeArrival = readFileSync(
    join(process.cwd(), "components/safety/safe-arrival-page.tsx"),
    "utf8"
  );

  it("has no tour-conditional spacing in Safe Arrival", () => {
    // The fix belongs in the tour, not in every surface it might cover.
    for (const smell of ["tourOpen", "hasTour", "tour-offset", "isTourVisible"]) {
      expect(safeArrival, smell).not.toContain(smell);
    }
  });
});
