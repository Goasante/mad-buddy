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

  it("uses one large circular orange launcher with an open-state X", () => {
    expect(css).toContain("--quick-actions-size: 4.25rem");
    expect(css).toContain("background: #e88c2b");
    expect(css).toContain("border-radius: 999px");
    expect(css).toContain("0 0 0 7px rgba(232, 140, 43, 0.12)");
    expect(component).toContain("<X");
  });

  it("renders warm-paper pill actions with the icon disc visually on the left", () => {
    expect(css).toContain("background: rgba(254, 251, 243, 0.98)");
    expect(css).toContain("flex-direction: row-reverse");
    expect(css).toContain("min-height: 3.45rem");
    expect(css).toContain("width: min(12rem, calc(100vw - 2rem))");
  });

  it("alternates the icon discs between Mad Buddy orange and deep maroon", () => {
    expect(css).toContain(".quick-actions-item:nth-child(even) .quick-actions-glyph");
    expect(css).toContain("background: #4e0401");
    expect(css).toContain("color: #fff");
  });

  it("keeps reduced-motion and short-screen fallbacks", () => {
    expect(css).toContain("@media (prefers-reduced-motion: reduce)");
    expect(css).toContain("@media (max-height: 700px)");
    expect(css).toContain("overflow-y: auto");
  });
});
