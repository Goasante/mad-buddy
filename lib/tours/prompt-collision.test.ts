import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
const runner = read("components/tours/tour-runner.tsx");

/**
 * The automatic floating tour invitation is OFF (owner decision, 2026-08-31).
 *
 * WHY. Pinned above the bottom navigation, the unsolicited prompt reached into
 * the page on shorter viewports and sat over primary actions -- measured
 * covering Safe Arrival's "Count me in" at 360x800 and "Message …" at 390x844,
 * with elementFromPoint returning the prompt rather than the CTA. Optional
 * education must not intercept a safety control, and rather than keep tuning
 * placement against every surface the prompt simply does not render.
 */
describe("the automatic tour invitation does not render", () => {
  it("returns before drawing anything in the invitation phase", () => {
    expect(runner).toContain('if (phase === "invitation") return null;');
  });

  it("draws no floating invitation card", () => {
    // The card, its title and its actions are gone -- not merely hidden, which
    // would still let it take a tap.
    expect(runner).not.toContain("tour-invite-title");
    expect(runner).not.toContain("Take the tour");
  });
});

describe("the tour framework itself is intact", () => {
  it("keeps the running phase, so an explicitly requested tour still works", () => {
    expect(runner).toContain('phase === "running"');
    expect(runner).toContain("autoStart");
  });

  it("keeps step analytics", () => {
    expect(runner).toContain("recordStep");
  });
});

describe("safety controls do not move because a tour exists", () => {
  const safeArrival = read("components/safety/safe-arrival-page.tsx");

  it("has no tour-conditional spacing in Safe Arrival", () => {
    // The prompt was fixed in the tour, never by padding every surface it
    // might cover; that must stay true if the invitation ever returns.
    for (const smell of ["tourOpen", "hasTour", "tour-offset", "isTourVisible"]) {
      expect(safeArrival, smell).not.toContain(smell);
    }
  });
});
