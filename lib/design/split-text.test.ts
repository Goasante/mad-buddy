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

  it("animates exactly one Home heading", () => {
    /* The INVARIANT is "one animated h1 on Home", not which words it holds.
     *
     * This used to pin the literal "Welcome", which was a fixed title sitting
     * directly above the time-of-day greeting -- Home greeted the same person
     * twice. The title is gone and the greeting is now the heading, so the
     * assertion moves to the property that actually matters: still one
     * SplitText, still the h1. */
    expect(home).toContain("<SplitText");
    expect(home).toContain('tag="h1"');
    expect(home).toContain("greetingSubtitle(displayName || null, new Date())");
    expect((home.match(/<SplitText/g) ?? []).length).toBe(1);
  });
});
