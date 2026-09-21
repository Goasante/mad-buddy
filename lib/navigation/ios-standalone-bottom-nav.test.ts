import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(join(process.cwd(), "app/mobile-shell-stability.css"), "utf8");

describe("iOS installed-PWA bottom navigation", () => {
  it("uses the standalone 100vh workaround instead of pushing the nav below the viewport", () => {
    expect(css).toContain("(display-mode: standalone)");
    expect(css).toContain("@supports (-webkit-touch-callout: none)");
    expect(css).toContain("height: 100vh");
    expect(css).toContain("min-height: 100vh");
    expect(css).toContain('nav[aria-label="Mobile navigation"]');
    expect(css).toContain("bottom: 0");
    expect(css).not.toContain("bottom: calc(0px - env(safe-area-inset-bottom");
  });

  it("keeps the real safe-area padding inside the navigation", () => {
    expect(css).toContain("--mobile-nav-safe-bottom: min(env(safe-area-inset-bottom, 0px), 0.75rem)");
    expect(css).toContain("padding-bottom: var(--mobile-nav-safe-bottom) !important");
  });

  it("matches the exposed standalone dark root paint to the authenticated shell", () => {
    expect(css).toContain("html.dark body");
    expect(css).toContain("background: #111112");
  });
});
