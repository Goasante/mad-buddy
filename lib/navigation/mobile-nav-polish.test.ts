import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");
const css = read("app/mobile-nav-polish.css");
const layout = read("app/layout.tsx");
const shell = read("components/app-shell/app-shell.tsx");

const mobileTabs = shell.slice(shell.indexOf("const MOBILE_TABS"), shell.indexOf("function MobileNav("));

describe("polished mobile navigation", () => {
  it("loads after the safe-area geometry layer without owning geometry itself", () => {
    expect(layout).toContain('import "./mobile-shell-stability.css";\nimport "./mobile-nav-polish.css";');
    expect(css).toContain('nav[aria-label="Mobile navigation"]');
    expect(css).toContain("do NOT add bottom offsets or change --mobile-nav-height");
    expect(css).not.toMatch(/bottom:\s*[1-9]/);
    expect(css).not.toContain("--mobile-nav-height:");
  });

  it("keeps the canonical Messages, Muddies, Linkr and UpFor destinations unchanged", () => {
    expect(mobileTabs).toContain('{ href: "/messages", label: "Messages"');
    expect(mobileTabs).toContain('{ href: "/friends", label: "Muddies"');
    expect(mobileTabs).toContain('{ href: "/linkr", label: "Linkr"');
    expect(mobileTabs).toContain('{ href: "/hangout-mode", label: "UpFor"');
    expect(mobileTabs).toContain('brandIcon: "linkr"');
    expect(mobileTabs).toContain('brandIcon: "upfor"');
  });

  it("turns every destination into a labelled button instead of showing only the active label", () => {
    expect(css).toContain('content: attr(aria-label)');
    expect(css).toContain('nav[aria-label="Mobile navigation"] > ul > li > a::after');
    expect(css).toContain("min-height: 58px");
    expect(css).toContain("border-radius: 1rem");
  });

  it("gives the active destination a restrained Mad Buddy button treatment", () => {
    expect(css).toContain('a[aria-current="page"]');
    expect(css).toContain("#4e0401");
    expect(css).toContain("#fefbf3");
    expect(css).toContain("rgba(232, 140, 43, 0.34)");
    expect(css).toContain("background: #e88c2b");
  });

  it("keeps the dock contained and theme-aware", () => {
    expect(css).toContain("width: min(30rem, calc(100% - 0.75rem))");
    expect(css).toContain("border-radius: 1.45rem");
    expect(css).toContain('.dark nav[aria-label="Mobile navigation"]');
    expect(css).toContain("backdrop-filter: blur(22px)");
  });

  it("honours reduced motion", () => {
    expect(css).toContain("@media (prefers-reduced-motion: reduce)");
    expect(css).toContain("transition: none !important");
  });
});
