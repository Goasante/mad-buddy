import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const component = readFileSync("components/ui/split-text.tsx", "utf8");
const home = readFileSync("components/dashboard/dashboard-page.tsx", "utf8");

describe("Home SplitText welcome", () => {
  it("uses the requested GSAP SplitText architecture", () => {
    expect(component).toContain('from "gsap/SplitText"');
    expect(component).toContain('from "@gsap/react"');
    expect(component).toContain("new GSAPSplitText");
  });

  it("runs once per mount without a scroll-trigger dependency", () => {
    expect(component).toContain("gsap.fromTo");
    expect(component).not.toContain("ScrollTrigger");
    expect(component).not.toContain("sessionStorage");
  });

  it("respects reduced motion and keeps semantic heading support", () => {
    expect(component).toContain("useReducedMotion()");
    expect(component).toContain("reducedMotion) return");
    expect(component).toContain('type SplitTag = "h1"');
  });

  it("animates only the fixed Home welcome heading", () => {
    expect(home).toContain("<SplitText");
    expect(home).toContain('tag="h1"');
    expect(home).toContain('text="Welcome"');
    expect((home.match(/<SplitText/g) ?? []).length).toBe(1);
  });
});
