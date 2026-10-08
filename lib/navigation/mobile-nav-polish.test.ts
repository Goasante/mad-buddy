import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");
const css = read("app/mobile-nav-polish.css");
const layout = read("app/layout.tsx");

/* The tab list moved to its own module so mobile can share the same nav. */
const navSource = read("components/app-shell/mobile-nav.tsx");

const mobileTabs = navSource.slice(navSource.indexOf("export const MOBILE_TABS"), navSource.indexOf("export function MobileNav("));

describe("Approved floating pill navigation", () => {
  it("loads after the safe-area geometry layer without redefining the canonical footprint", () => {
    expect(layout).toContain('import "./mobile-shell-stability.css";\nimport "./mobile-nav-polish.css";');
    expect(css).toContain('nav[aria-label="Mobile navigation"]');
    expect(css).toContain("keeps --mobile-nav-height untouched");
    expect(css).not.toContain("--mobile-nav-height:");
  });

  it("keeps the canonical Messages, Muddies, Linkr and Meetups destinations unchanged", () => {
    expect(mobileTabs).toContain('{ href: "/messages", label: "Messages"');
    expect(mobileTabs).toContain('{ href: "/friends", label: "Muddies"');
    expect(mobileTabs).toContain('{ href: "/linkr", label: "Linkr"');
    expect(mobileTabs).toContain('{ href: "/meet-up", label: "Meetups"');
    expect(mobileTabs).toContain('brandIcon: "linkr"');
    expect(mobileTabs).toContain('brandIcon: "upfor"');
  });

  it("makes the outer safe-area frame transparent and click-through so content can flow behind it", () => {
    expect(css).toContain("background: transparent !important");
    expect(css).toContain("pointer-events: none");
    expect(css).toContain("pointer-events: auto");
    expect(css).toContain("backdrop-filter: none !important");
  });

  it("renders the visible control as a compact floating glass dock", () => {
    expect(css).toContain("width: min(29rem, 100%)");
    expect(css).toContain("height: 64px");
    expect(css).toContain("border-radius: 999px");
    expect(css).toContain("background: #fff");
    expect(css).not.toContain("backdrop-filter: blur(");
    expect(css).toContain('.dark nav[aria-label="Mobile navigation"] > ul');
  });

  it("keeps five equal slots and visible labels below their icons", () => {
    expect(css).toContain("flex: 1 1 0");
    expect(css).toContain("flex-direction: column !important");
    expect(css).toContain(".mobile-nav-label");
    expect(css).not.toContain("content: attr(aria-label)");
    expect(navSource).toContain("mobile-nav-label max-w-full truncate");
  });

  it("uses a soft grey inset with orange selected icons and labels", () => {
    expect(css).toContain('a[aria-current="page"]');
    expect(css).toContain("background: #f1efec");
    expect(css).toContain("color: #f38b20");
    expect(navSource).toContain("<NavigationGlyph");
  });

  it("honours reduced-motion users without changing tab widths", () => {
    expect(css).toContain("background-color 160ms ease");
    expect(css).toContain("@media (prefers-reduced-motion: reduce)");
    expect(css).toContain("transition: none !important");
  });
});
