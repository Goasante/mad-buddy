import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { stripComments } from "@/lib/content/strip-comments";

/**
 * The notch is cleared ONCE, by exactly one owner.
 *
 * THE FAILURE THIS GUARDS. Two things can reserve the top inset: the fixed
 * header (which pads itself by env(safe-area-inset-top) internally) and
 * <main> (which reserves the header's footprint via a CSS variable that
 * already includes the same inset). Reserving in both places, or reserving a
 * header footprint for a page that draws its own header inline, produces a
 * large dead gap under the status bar -- content pushed far below the notch
 * rather than sitting just beneath it.
 *
 * These are STRUCTURAL assertions. They prove one owner is declared per route;
 * they cannot prove pixel geometry, which still needs a real viewport.
 */

const shell = stripComments(readFileSync("components/app-shell/app-shell.tsx", "utf8"));
const css = readFileSync("app/globals.css", "utf8");

const declaredOwnHeaderRoutes = (() => {
  const block = shell.slice(
    shell.indexOf("const PAGES_WITH_OWN_HEADER"),
    shell.indexOf("] as const;", shell.indexOf("const PAGES_WITH_OWN_HEADER"))
  );
  return (block.match(/"\/[a-z-]+"/g) ?? []).map((entry) => entry.replaceAll('"', ""));
})();

describe("one owner per route", () => {
  it("declares the routes that draw their own header", () => {
    expect(declaredOwnHeaderRoutes.length).toBeGreaterThan(10);
  });

  it("gives a page with its own header no global-header offset", () => {
    // hasGlobalHeader is false for these, so <main> must not add
    // --app-header-height on top of the header the page draws itself.
    expect(shell).toContain("hasGlobalHeader");
    expect(shell).toContain('"pt-[var(--app-header-height)]"');
  });

  it("gives an immersive page no reserved header footprint at all", () => {
    // An inline (non-fixed) header occupies real flow height and clears the
    // notch itself; reserving a fixed header's footprint too is the gap.
    expect(shell).toContain('? "pt-0"');
    expect(shell).toContain("immersiveHeader");
  });

  it("reserves the mobile header's footprint exactly once", () => {
    expect(shell).toContain('"pt-[var(--mobile-header-height)] md:pt-0"');
  });
});

describe("the canonical measurements include the inset exactly once", () => {
  it("--mobile-header-height is inset + content height", () => {
    const block = css.slice(css.indexOf("--mobile-header-height:"));
    expect(block.slice(0, 160)).toContain("env(safe-area-inset-top, 0px)");
    expect(block.slice(0, 160)).toContain("var(--mobile-header-content-height)");
  });

  it("--app-header-height is inset + content height", () => {
    const block = css.slice(css.indexOf("--app-header-height:"));
    expect(block.slice(0, 160)).toContain("env(safe-area-inset-top, 0px)");
  });

  it("the content-height variables carry no inset of their own", () => {
    // If the content height already included the inset, adding it again in the
    // composite variable would double it.
    const block = css.slice(css.indexOf("--mobile-header-content-height:"));
    expect(block.slice(0, 80)).not.toContain("safe-area-inset");
  });
});

describe("no page draws two headers", () => {
  const componentFiles: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = `${dir}/${entry.name}`;
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith(".tsx")) componentFiles.push(full);
    }
  };
  walk("components");

  it("never renders PageHeader and MobilePageHeader in the same file", () => {
    const offenders = componentFiles.filter((file) => {
      if (file.includes("app-shell")) return false;
      const source = stripComments(readFileSync(file, "utf8"));
      return source.includes("<PageHeader") && source.includes("<MobilePageHeader");
    });
    expect(offenders).toEqual([]);
  });

  it("every component drawing its own header belongs to a declared route", () => {
    // A page that draws a header while the shell still thinks it needs the
    // global one gets both, which is the doubled-gap case.
    const drawsOwnHeader = componentFiles.filter(
      (file) =>
        file.endsWith("-page.tsx") &&
        !file.includes("app-shell") &&
        stripComments(readFileSync(file, "utf8")).includes("<PageHeader")
    );
    expect(drawsOwnHeader.length).toBeGreaterThan(5);
  });
});
