import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { stripComments } from "@/lib/content/strip-comments";
import { showsQuickActions } from "@/lib/navigation/quick-actions";

/**
 * A floating control must not come to rest on top of a real one.
 *
 * The shell reserves the bottom bar's height plus the launcher's own
 * footprint on every scrolling page that shows the launcher, so the page's
 * last control never terminates underneath a fixed element. The launcher
 * itself additionally computes a safe vertical band at runtime (see
 * quick-actions-launcher.tsx) because, unlike the old fixed bottom-right
 * pill, it can now rest anywhere along either edge.
 */

const globalsCss = readFileSync("app/globals.css", "utf8");
const replicaCss = readFileSync("app/quick-actions-replica.css", "utf8");
const shell = stripComments(readFileSync("components/app-shell/app-shell.tsx", "utf8"));
const component = stripComments(readFileSync("components/app-shell/quick-actions-launcher.tsx", "utf8"));

/** The token block, so an unrelated later rule cannot satisfy these. */
const tokens = globalsCss.slice(globalsCss.indexOf("--quick-actions-gap"), globalsCss.indexOf("}", globalsCss.indexOf("--quick-actions-reserve")));

describe("the pill's reserved footprint has one source", () => {
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

  it("the visual stylesheet restates --quick-actions-size, not a second literal", () => {
    // The replica stylesheet loads after globals.css and legitimately
    // overrides the token's VALUE (a smaller, quieter control) -- but it must
    // still go through the same variable app-shell.tsx reserves space from,
    // not a parallel hardcoded size that could drift from the reservation.
    expect(replicaCss).toContain("--quick-actions-size:");
    expect(replicaCss).not.toMatch(/\.quick-actions-trigger\s*{[^}]*width:\s*[\d.]+rem/);
  });
});

describe("the shell owns the reservation, not the pages", () => {
  it("reserves the launcher footprint on the scrolling element", () => {
    expect(shell).toContain("var(--quick-actions-reserve)");
  });

  it("keeps using the shared nav and safe-area tokens", () => {
    expect(shell).toContain("var(--mobile-nav-height)");
    // The bar moved to its own module so mobile can share it; the invariant
    // is unchanged, only its home.
    expect(stripComments(readFileSync("components/app-shell/mobile-nav.tsx", "utf8"))).toContain("env(safe-area-inset-bottom,0px)");
  });

  it("hard-codes no device dimensions in the reservation", () => {
    const main = shell.slice(shell.indexOf('id="app-main-content"'), shell.indexOf("</main>"));
    const padding = main.match(/pb-\[[^\]]+\]/g) ?? [];
    expect(padding.length).toBeGreaterThan(0);
    for (const rule of padding) {
      expect(rule.replaceAll("safe-area-inset-bottom,0px", "")).not.toMatch(/\d+px/);
    }
  });

  it("reserves only where the launcher actually renders", () => {
    expect(shell).toContain("showsQuickActions(pathname)");
    expect(shell).toContain("reservesQuickActions");
  });

  it("uses the launcher's own visibility rule rather than a second list", () => {
    expect(shell).toContain('from "@/lib/navigation/quick-actions"');
  });
});

describe("immersive surfaces stay flush", () => {
  it("drops the reservation when the bar and pill step aside", () => {
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
    const source = stripComments(readFileSync(path, "utf8"));
    expect(source).not.toContain("quick-actions");
    expect(source).not.toContain("--quick-actions-reserve");
  });
});

describe("the exclusion rule still holds", () => {
  it("keeps the pill off surfaces that own their lower-right corner", () => {
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
  it("keeps the launcher below the bottom bar in the visual stylesheet", () => {
    const block = replicaCss.slice(replicaCss.indexOf(".quick-actions {"), replicaCss.indexOf(".quick-actions--unpositioned"));
    expect(block).toContain("z-index: 40");
  });

  it("the launcher computes its own safe vertical band at runtime", () => {
    // Unlike the old fixed bottom-right pill, this control can rest anywhere
    // along either edge, so a static CSS reservation alone cannot keep it off
    // the nav -- verticalBounds() is what does that job now.
    expect(component).toContain("function verticalBounds()");
    expect(component).toContain("--mobile-nav-height");
  });

  it("only the trigger itself receives pointer events, never its fixed container", () => {
    // The container spans the whole viewport corner-to-corner conceptually
    // (top/left are set inline once positioned); only the 44px+ control
    // inside it should ever intercept a tap.
    const block = replicaCss.slice(replicaCss.indexOf(".quick-actions {"), replicaCss.indexOf(".quick-actions--unpositioned"));
    expect(block).toContain("pointer-events: none");
    expect(replicaCss).toContain(".quick-actions-trigger {");
    const trigger = replicaCss.slice(replicaCss.indexOf(".quick-actions-trigger {"));
    expect(trigger.slice(0, trigger.indexOf("}"))).toContain("pointer-events: auto");
  });
});
