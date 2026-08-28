import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { stripComments } from "@/lib/content/strip-comments";
import { showsQuickActions } from "@/lib/navigation/quick-actions";

/**
 * A floating control must not come to rest on top of a real one.
 *
 * The shell cleared the bottom bar's height but not the Quick Actions pill
 * sitting above it, so the last stretch of every scrolling page ended
 * underneath a fixed element -- a primary CTA could land there and be
 * unreadable, or lose the tap entirely.
 */

const css = readFileSync("app/globals.css", "utf8");
const shell = stripComments(readFileSync("components/app-shell/app-shell.tsx", "utf8"));

/** The token block, so an unrelated later rule cannot satisfy these. */
const tokens = css.slice(css.indexOf("--quick-actions-gap"), css.indexOf(".quick-actions {"));

describe("the pill's geometry has one source", () => {
  it("declares the gap and size as tokens", () => {
    expect(tokens).toContain("--quick-actions-gap");
    expect(tokens).toContain("--quick-actions-size");
  });

  it("derives the reservation from that same geometry", () => {
    /* Not a number that happens to be big enough: if the pill is resized, the
     * space a page clears has to move with it, or the collision returns
     * silently. */
    const reserve = tokens.slice(tokens.indexOf("--quick-actions-reserve"));
    expect(reserve).toContain("var(--quick-actions-gap)");
    expect(reserve).toContain("var(--quick-actions-size)");
  });

  it("positions the pill from the tokens too", () => {
    const block = css.slice(css.indexOf(".quick-actions {"), css.indexOf(".quick-actions-stack"));
    expect(block).toContain("var(--quick-actions-gap)");
  });

  it("sizes the trigger from the token the shell reserves", () => {
    const trigger = css.slice(
      css.indexOf(".quick-actions-trigger {"),
      css.indexOf(".quick-actions-trigger:hover")
    );
    expect(trigger).toContain("height: var(--quick-actions-size)");
    // The 44x60 touch target is unchanged by tokenising it.
    expect(tokens).toContain("--quick-actions-size: 3.75rem");
  });
});

describe("the shell owns the reservation, not the pages", () => {
  it("reserves the launcher footprint on the scrolling element", () => {
    expect(shell).toContain("var(--quick-actions-reserve)");
  });

  it("keeps using the shared nav and safe-area tokens", () => {
    // Never a per-device number: the bar's own height and the device inset.
    expect(shell).toContain("var(--mobile-nav-height)");
    expect(shell).toContain("env(safe-area-inset-bottom,0px)");
  });

  it("hard-codes no device dimensions in the reservation", () => {
    /* Scoped to the padding expressions, and `0px` inside the safe-area
     * fallback is not a device dimension -- the first version of this flagged
     * it, which would have forced the shell to write `env()` differently just
     * to satisfy a test. */
    const main = shell.slice(shell.indexOf('id="app-main-content"'), shell.indexOf("</main>"));
    const padding = main.match(/pb-\[[^\]]+\]/g) ?? [];
    expect(padding.length).toBeGreaterThan(0);
    for (const rule of padding) {
      expect(rule.replaceAll("safe-area-inset-bottom,0px", "")).not.toMatch(/\d+px/);
    }
  });

  it("reserves only where the launcher actually renders", () => {
    /* Safe Arrival and open conversations exclude the pill deliberately.
     * Reserving there would leave a dead strip under a page with nothing
     * floating above it. */
    expect(shell).toContain("showsQuickActions(pathname)");
    expect(shell).toContain("reservesQuickActions");
  });

  it("uses the launcher's own visibility rule rather than a second list", () => {
    expect(shell).toContain('from "@/lib/navigation/quick-actions"');
  });
});

describe("immersive surfaces stay flush", () => {
  it("drops the reservation when the bar and pill step aside", () => {
    // A dead strip under an open conversation is its own bug.
    // Immersive keeps its flush padding; the reserve is gated alongside it.
    expect(shell).toContain("!immersive && showsQuickActions(pathname)");
    const main = shell.slice(shell.indexOf('id="app-main-content"'), shell.indexOf("</main>"));
    expect(main).toContain("immersive");
    expect(main).toContain('"pb-5"');
  });
});

describe("no screen carries a launcher-specific workaround", () => {
  it.each([
    ["components/activation/activation-card.tsx"],
    ["components/activation/first-muddy-card.tsx"],
    ["components/dashboard/dashboard-page.tsx"]
  ])("%s has no pill-avoidance padding", (path) => {
    /* The collision was noticed on the activation CTA, but it belonged to
     * every scrolling page. A margin here would have fixed one screen and
     * left the rest broken. */
    const source = stripComments(readFileSync(path, "utf8"));
    expect(source).not.toContain("quick-actions");
    expect(source).not.toContain("--quick-actions-reserve");
  });
});

describe("the exclusion rule still holds", () => {
  it("keeps the pill off surfaces that own their lower-right corner", () => {
    // Safety controls must never be under a floating shortcut.
    expect(showsQuickActions("/safe-arrival")).toBe(false);
    expect(showsQuickActions("/scan")).toBe(false);
    expect(showsQuickActions("/linkr")).toBe(false);
    expect(showsQuickActions("/messages/abc")).toBe(false);
  });

  it("still shows it on ordinary surfaces", () => {
    expect(showsQuickActions("/dashboard")).toBe(true);
    expect(showsQuickActions("/plans")).toBe(true);
  });
});

describe("navigation is untouched", () => {
  it("keeps the launcher below the bottom bar in the stack", () => {
    const block = css.slice(css.indexOf(".quick-actions {"), css.indexOf(".quick-actions-stack"));
    expect(block).toContain("z-index: 40");
  });

  it("leaves the collapsed control with no hit area", () => {
    // Collapsed, it must not intercept a tap meant for the page beneath.
    const listAt = css.indexOf(".quick-actions-list {");
    const list = css.slice(listAt, css.indexOf(".quick-actions[data-open", listAt));
    expect(list).toContain("max-height: 0");
    expect(list).toContain("pointer-events: none");
  });

  it("lets the page stay interactive around the pill", () => {
    const block = css.slice(css.indexOf(".quick-actions {"), css.indexOf(".quick-actions-stack"));
    expect(block).toContain("pointer-events: none");
  });
});
