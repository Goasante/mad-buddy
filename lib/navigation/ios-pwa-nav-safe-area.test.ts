import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(join(process.cwd(), "app/mobile-shell-stability.css"), "utf8");

describe("iOS standalone PWA bottom navigation safe-area correction", () => {
  it("extends the standalone WebKit root viewport without pushing the nav below it", () => {
    expect(css).toContain("@media (max-width: 767px) and (display-mode: standalone)");
    expect(css).toContain("@supports (-webkit-touch-callout: none)");
    expect(css).toContain("height: 100vh;");
    expect(css).toContain("min-height: 100vh;");
    expect(css).toContain("bottom: 0;");
    expect(css).not.toContain("bottom: calc(0px - env(safe-area-inset-bottom, 0px));");
    expect(css).toContain("background: #111112;");
  });

  it("keeps the control-safe padding inside the nav while correcting only the viewport", () => {
    expect(css).toContain("--mobile-nav-safe-bottom: min(env(safe-area-inset-bottom, 0px), 0.75rem)");
    expect(css).toContain("padding-bottom: var(--mobile-nav-safe-bottom) !important");
  });
});
