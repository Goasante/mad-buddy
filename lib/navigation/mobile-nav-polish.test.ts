import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");
const css = read("app/mobile-nav-polish.css");
const layout = read("app/layout.tsx");
const shell = read("components/app-shell/app-shell.tsx");

const mobileTabs = shell.slice(shell.indexOf("const MOBILE_TABS"), shell.indexOf("function MobileNav("));

describe("Dribbble-inspired mobile navigation", () => {
  it("loads after the safe-area geometry layer without redefining the canonical footprint", () => {
    expect(layout).toContain('import "./mobile-shell-stability.css";\nimport "./mobile-nav-polish.css";');
    expect(css).toContain('nav[aria-label="Mobile navigation"]');
    expect(css).toContain("keeps --mobile-nav-height untouched");
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

  it("makes the outer safe-area frame transparent and click-through so content can flow behind it", () => {
    expect(css).toContain("background: transparent !important");
    expect(css).toContain("pointer-events: none");
    expect(css).toContain("pointer-events: auto");
    expect(css).toContain("backdrop-filter: none !important");
  });

  it("renders the visible control as a compact floating glass dock", () => {
    expect(css).toContain("width: min(29rem, 100%)");
    expect(css).toContain("height: 4rem");
    expect(css).toContain("border-radius: 1.55rem");
    expect(css).toContain("background: rgba(254, 251, 243, 0.82)");
    expect(css).toContain("backdrop-filter: blur(24px) saturate(1.18)");
    expect(css).toContain('.dark nav[aria-label="Mobile navigation"] > ul');
  });

  it("keeps inactive destinations icon-only and expands the active destination", () => {
    expect(css).toContain('li:has(> a[aria-current="page"])');
    expect(css).toContain("flex: 1.72 1 0");
    expect(css).toContain("content: attr(aria-label)");
    expect(css).toContain("max-width: 0");
    expect(css).toContain('a[aria-current="page"]::after');
    expect(css).toContain("max-width: 6.5rem");
    expect(css).toContain("opacity: 1");
  });

  it("uses Mad Buddy orange and maroon for the selected pill without replacing nav icons", () => {
    expect(css).toContain('a[aria-current="page"]');
    expect(css).toContain("background: #e88c2b");
    expect(css).toContain("color: #4e0401");
    expect(css).toContain("Keep every Mad Buddy icon exactly as supplied");
  });

  it("uses spring-like expansion timing but honours reduced-motion users", () => {
    expect(css).toContain("cubic-bezier(0.22, 1, 0.36, 1)");
    expect(css).toContain("@media (prefers-reduced-motion: reduce)");
    expect(css).toContain("transition: none !important");
  });
});
