import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(path, "utf8");
const shell = read("components/app-shell/app-shell.tsx");
const linkrCss = read("app/globals.css");
const scrolled = read("hooks/use-has-scrolled.ts");
const pullToRefresh = read("components/ui/pull-to-refresh.tsx");

describe("canonical authenticated viewport contract", () => {
  it("has one bounded viewport and one vertical page scroll owner", () => {
    expect(shell).toContain("h-[100svh] h-[100dvh]");
    expect(shell).toContain("overflow-hidden");
    expect(shell).toContain("data-app-scroll-owner");
    expect(shell).toContain("min-h-0 flex-1 overflow-y-auto overscroll-y-contain");
    expect(shell).toContain("scroll-pb-[calc(var(--mobile-nav-height)");
  });

  it("does not reserve the fixed bottom navigation outside main", () => {
    const shellRoot = shell.slice(shell.indexOf("<div"), shell.indexOf('<main'));
    expect(shellRoot).not.toContain("var(--mobile-nav-height)");
  });

  it("makes scroll-aware chrome and pull-to-refresh observe the same owner", () => {
    for (const source of [scrolled, pullToRefresh]) {
      expect(source).toContain('[data-app-scroll-owner]');
      expect(source).toContain("scrollTop");
    }
  });

  it("does not make Linkr activation pay the navigation footprint again", () => {
    const activation = linkrCss.slice(
      linkrCss.lastIndexOf(".linkr-activate {"),
      linkrCss.indexOf("/* The match screen", linkrCss.lastIndexOf(".linkr-activate {"))
    );
    expect(activation).not.toContain("--mobile-nav-height");
    expect(activation).not.toContain("safe-area-inset-bottom");
  });

  it("does not invent canonical headers for nested detail surfaces", () => {
    const registry = shell.slice(shell.indexOf("function hasOwnHeader"), shell.indexOf("function hasWallpaper"));
    expect(shell).toContain('pathname.startsWith("/settings/") && pathname !== "/settings/access"');
    expect(shell).toContain('return pathname === "/events/top"');
    expect(registry).not.toContain('pathname.startsWith(`${href}/`)');
  });
});
