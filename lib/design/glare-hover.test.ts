import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

describe("canonical GlareHover", () => {
  const component = read("components/ui/glare-hover.tsx");
  const css = read("components/ui/glare-hover.module.css");

  it("keeps the React Bits controls reusable and typed", () => {
    for (const prop of ["glareColor", "glareOpacity", "glareAngle", "glareSize", "transitionDuration", "playOnce"]) {
      expect(component).toContain(prop);
    }
    expect(component).toContain("colorWithOpacity");
  });

  it("never intercepts card actions and respects reduced motion", () => {
    expect(css).toContain("pointer-events: none");
    expect(css).toContain("prefers-reduced-motion: reduce");
    expect(css).toContain("background-position: -100% -100%");
    expect(css).toContain("@media (hover: none), (pointer: coarse)");
    expect(css).toContain("animation: none");
  });

  it("supports delayed automatic glare without changing desktop hover", () => {
    expect(component).toContain("autoOnTouch?: boolean");
    expect(component).toContain("autoDelay?: number");
    expect(component).toContain("autoInterval?: number");
    expect(css).toContain("glareAutoSweep");
  });

  it.each([
    "components/journey/smart-card.tsx",
    "components/socialize/socialize-plan-card.tsx",
    "components/socialize/socialize-hero.tsx"
  ])("adds one restrained glare layer to %s", (path) => {
    const source = read(path);
    expect((source.match(/<GlareHover/g) ?? [])).toHaveLength(1);
    expect(source).toContain("triggerOnParent");
    expect(source).toContain("autoOnTouch");
    expect(source).toContain("pointer-events-none");
  });
});
