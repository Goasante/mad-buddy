import { describe, expect, it } from "vitest";

import {
  LINKR_INTENTS,
  areIntentsCompatible,
  assertSymmetric,
  compatibleIntentsFor,
  isLinkrIntent,
  type LinkrIntent
} from "@/lib/linkr/intent";

const ALL: LinkrIntent[] = ["friends", "dating", "networking", "anything"];

describe("Linkr intent compatibility", () => {
  it("matches the documented v1 matrix exactly", () => {
    // Written out in full rather than derived, so a change to the rules has to
    // change this table too. A test that recomputes the matrix from the matrix
    // proves nothing.
    const expected: Record<LinkrIntent, LinkrIntent[]> = {
      friends: ["friends", "anything"],
      dating: ["dating", "anything"],
      networking: ["networking", "anything"],
      anything: ["friends", "dating", "networking", "anything"]
    };

    for (const viewer of ALL) {
      for (const candidate of ALL) {
        expect(areIntentsCompatible(viewer, candidate)).toBe(
          expected[viewer].includes(candidate)
        );
      }
    }
  });

  it("is symmetric in every direction", () => {
    expect(assertSymmetric()).toBe(true);
    for (const a of ALL) {
      for (const b of ALL) {
        expect(areIntentsCompatible(a, b)).toBe(areIntentsCompatible(b, a));
      }
    }
  });

  it("keeps Friends and Dating apart in both directions", () => {
    // The mismatch that matters most: someone looking for friends must not be
    // shown to someone looking for a partner, or the reverse.
    expect(areIntentsCompatible("friends", "dating")).toBe(false);
    expect(areIntentsCompatible("dating", "friends")).toBe(false);
  });

  it("keeps Dating and Networking apart in both directions", () => {
    expect(areIntentsCompatible("dating", "networking")).toBe(false);
    expect(areIntentsCompatible("networking", "dating")).toBe(false);
  });

  it("keeps Friends and Networking apart in both directions", () => {
    expect(areIntentsCompatible("friends", "networking")).toBe(false);
    expect(areIntentsCompatible("networking", "friends")).toBe(false);
  });

  it("lets Anything reach every intent, and every intent reach Anything", () => {
    for (const intent of ALL) {
      expect(areIntentsCompatible("anything", intent)).toBe(true);
      expect(areIntentsCompatible(intent, "anything")).toBe(true);
    }
  });

  it("always includes the same intent as itself", () => {
    for (const intent of ALL) {
      expect(areIntentsCompatible(intent, intent)).toBe(true);
    }
  });

  it("compatibleIntentsFor agrees with areIntentsCompatible", () => {
    // The discovery query uses the set form for speed; a disagreement between
    // the two would widen or narrow discovery silently.
    for (const viewer of ALL) {
      const set = new Set(compatibleIntentsFor(viewer));
      for (const candidate of ALL) {
        expect(set.has(candidate)).toBe(areIntentsCompatible(viewer, candidate));
      }
    }
  });

  it("rejects values that are not intents", () => {
    expect(isLinkrIntent("friends")).toBe(true);
    expect(isLinkrIntent("romance")).toBe(false);
    expect(isLinkrIntent("")).toBe(false);
    expect(isLinkrIntent(null)).toBe(false);
    expect(isLinkrIntent(undefined)).toBe(false);
    expect(isLinkrIntent(2)).toBe(false);
    // Prototype keys are `in` an object literal's chain; the guard must not
    // treat them as valid intents.
    expect(isLinkrIntent("toString")).toBe(false);
    expect(isLinkrIntent("constructor")).toBe(false);
  });

  it("offers exactly the four approved options", () => {
    expect(LINKR_INTENTS.map((option) => option.id)).toEqual([
      "friends",
      "dating",
      "networking",
      "anything"
    ]);
  });
});

describe("intent compatibility mutation tests", () => {
  // Each of these asserts a property that a plausible "simplification" would
  // break. They are here to bite, not to describe.

  it("BITES: a matrix where everything is compatible", () => {
    const alwaysTrue = () => true;
    let broken = false;
    for (const a of ALL) {
      for (const b of ALL) {
        if (alwaysTrue() !== areIntentsCompatible(a, b)) broken = true;
      }
    }
    expect(broken).toBe(true);
  });

  it("BITES: dropping 'anything' from a specific intent's list", () => {
    // If COMPATIBILITY.friends became ["friends"], someone who chose Anything
    // would stop seeing people who chose Friends, in one direction only --
    // which is also how the matrix would become asymmetric.
    expect(compatibleIntentsFor("friends")).toContain("anything");
    expect(compatibleIntentsFor("dating")).toContain("anything");
    expect(compatibleIntentsFor("networking")).toContain("anything");
  });

  it("BITES: making 'anything' one-directional", () => {
    // The classic asymmetry bug: Anything sees Dating but Dating does not see
    // Anything. Symmetry is asserted above; this names the specific pair.
    expect(areIntentsCompatible("anything", "dating")).toBe(
      areIntentsCompatible("dating", "anything")
    );
  });
});
