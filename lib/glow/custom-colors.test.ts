import { describe, expect, it } from "vitest";
import { GLOW_COLORS, GLOW_COLOR_ID_MAX_LENGTH, glowColorById, isGlowColorId } from "@/lib/glow/custom-colors";

describe("custom glow colours", () => {
  it("accepts only known palette ids", () => {
    for (const color of GLOW_COLORS) {
      expect(isGlowColorId(color.id)).toBe(true);
    }
    for (const bad of ["", "  ", "red", "#ff0000", "amber ", "AMBER", 42, null, undefined, {}]) {
      expect(isGlowColorId(bad)).toBe(false);
    }
  });

  it("resolves an id to its swatch, and null for anything unknown", () => {
    expect(glowColorById("violet")?.label).toBe("Violet");
    expect(glowColorById("nope")).toBeNull();
    expect(glowColorById(null)).toBeNull();
    expect(glowColorById(undefined)).toBeNull();
  });

  it("exposes a well-formed rgb triple and gradient for every colour", () => {
    for (const color of GLOW_COLORS) {
      expect(color.rgb).toMatch(/^\d{1,3} \d{1,3} \d{1,3}$/);
      expect(color.ring).toContain("linear-gradient");
      expect(color.swatch).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });

  it("has unique ids that fit the storage bound", () => {
    const ids = GLOW_COLORS.map((color) => color.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) {
      expect(id.length).toBeLessThanOrEqual(GLOW_COLOR_ID_MAX_LENGTH);
    }
  });
});
