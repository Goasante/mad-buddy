import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(join(process.cwd(), "app/mobile-shell-stability.css"), "utf8");

describe("iOS standalone PWA bottom navigation safe-area correction", () => {
  it("moves the fixed nav frame through the standalone-only safe-area gap", () => {
    expect(css).toContain("@media (max-width: 767px) and (display-mode: standalone)");
    expect(css).toContain("@supports (-webkit-touch-callout: none)");
    expect(css).toContain("bottom: calc(0px - env(safe-area-inset-bottom, 0px));");
  });

  it("keeps the control-safe padding inside the nav while correcting only the frame", () => {
    expect(css).toContain("--mobile-nav-safe-bottom: min(env(safe-area-inset-bottom, 0px), 0.75rem)");
    expect(css).toContain("padding-bottom: var(--mobile-nav-safe-bottom) !important");
  });
});
