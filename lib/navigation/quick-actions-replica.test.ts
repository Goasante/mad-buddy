import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

const component = read("components/app-shell/quick-actions-launcher.tsx");
const css = read("app/quick-actions-replica.css");

describe("quick actions reference treatment", () => {
  it("loads the dedicated visual layer from the canonical launcher", () => {
    expect(component).toContain('import "@/app/quick-actions-replica.css"');
  });

  it("uses a smaller circular branded launcher with an open-state X", () => {
    expect(css).toContain("--quick-actions-size: 3.5rem");
    expect(css).toContain("linear-gradient(145deg, #f2a043 0%, #e88c2b 58%, #d87418 100%)");
    expect(css).toContain("border-radius: 999px");
    expect(css).toContain("0 0 0 5px rgba(232, 140, 43, 0.09)");
    expect(css).toContain(".quick-actions-trigger::before");
    expect(component).toContain("<X");
  });

  it("renders compact warm-paper pill actions with the icon disc visually on the left", () => {
    expect(css).toContain("linear-gradient(135deg, rgba(254, 251, 243, 0.99), rgba(255, 247, 234, 0.97))");
    expect(css).toContain("flex-direction: row-reverse");
    expect(css).toContain("min-height: 2.95rem");
    expect(css).toContain("width: min(10.75rem, calc(100vw - 1.7rem))");
  });

  it("alternates the icon discs between Mad Buddy orange and deep maroon", () => {
    expect(css).toContain(".quick-actions-item:nth-child(even) .quick-actions-glyph");
    expect(css).toContain("linear-gradient(145deg, #6a0b07, #4e0401 62%, #350201)");
    expect(css).toContain("color: #fff");
  });

  it("keeps reduced-motion and short-screen fallbacks", () => {
    expect(css).toContain("@media (prefers-reduced-motion: reduce)");
    expect(css).toContain("@media (max-height: 700px)");
    expect(css).toContain("overflow-y: auto");
  });
});