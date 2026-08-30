import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const source = readFileSync(join(process.cwd(), "hooks/use-countdown-clock.ts"), "utf8");

/**
 * The runtime behaviour is proven in a real browser (see the C2 resume proof,
 * which backgrounds a page, advances the clock and asserts the label is correct
 * on the first visible frame). These assertions pin the structural reasons it
 * works, so the listeners cannot be quietly dropped later.
 */
describe("the countdown clock recovers from being backgrounded", () => {
  it("re-reads the clock when the page becomes visible again", () => {
    // An interval alone is not enough: a throttled or suspended timer in a
    // backgrounded tab may not fire at all, so reopening would show the label
    // that was true when the screen went off.
    expect(source).toContain('document.addEventListener("visibilitychange", onVisibility)');
    expect(source).toContain('document.visibilityState === "visible"');
  });

  it("re-reads on pageshow, for a restore from the back/forward cache", () => {
    // bfcache restores a page with no timers having run at all.
    expect(source).toContain('window.addEventListener("pageshow", sync)');
  });

  it("does not do work while hidden", () => {
    // Syncing on the way out would burn a wakeup nobody is there to see.
    expect(source).toMatch(/if \(document\.visibilityState === "visible"\) sync\(\);/);
  });

  it("removes every listener it adds", () => {
    for (const listener of ["visibilitychange", "pageshow"]) {
      expect(source, listener).toContain(`removeEventListener("${listener}"`);
    }
    expect(source).toContain("clearInterval(timer)");
  });

  it("still ticks on an interval between resumes", () => {
    expect(source).toContain("setInterval(sync, intervalMs)");
  });
});
