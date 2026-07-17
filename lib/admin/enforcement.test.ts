import { describe, expect, it } from "vitest";
import { SUSPENSION_BLOCKS } from "@/lib/admin/governance";
import { GUARDED_SURFACES } from "@/lib/admin/enforcement";

/**
 * Drift guard. `SUSPENSION_BLOCKS` (batch 13 §19, the spec's list of what a
 * suspension must block) and `GUARDED_SURFACES` (what the enforcement gate
 * actually knows how to block) are separate lists. If a future batch adds a
 * surface to one and forgets the other, a suspended user keeps access to it —
 * silently, and exactly the "partial bypass" §19 forbids. This test fails loudly.
 */
describe("enforcement covers every surface a suspension must block (spec §19)", () => {
  it("guards every surface the spec lists", () => {
    for (const surface of SUSPENSION_BLOCKS) {
      expect(GUARDED_SURFACES, `"${surface}" is in SUSPENSION_BLOCKS but the guard can't block it`).toContain(
        surface
      );
    }
  });

  it("has no guarded surface the spec doesn't recognise", () => {
    for (const surface of GUARDED_SURFACES) {
      expect(SUSPENSION_BLOCKS as readonly string[], `"${surface}" is guarded but not in SUSPENSION_BLOCKS`).toContain(
        surface
      );
    }
  });
});
