import { describe, expect, it } from "vitest";

import {
  PROXIMITY_GLOW_LEVELS,
  PROXIMITY_GLOW_CONFIG,
  PROXIMITY_GLOW_SIZES,
  PROXIMITY_GLOW_REFERENCE_AVATAR_PX,
  resolveGlowGeometry,
  type ProximityGlowLevel,
  type ProximityGlowSize
} from "@/lib/proximity/glow-config";

/**
 * How much room a scroll container must reserve for the Glow.
 *
 * WHY THIS EXISTS. `overflow-x: auto` makes an element a scroll container, and
 * a scroll container clips on EVERY side -- there is no "scroll sideways,
 * overflow freely upwards". The Home Near strip shipped with 8px of vertical
 * padding and a comment asserting that was enough; measured against the real
 * geometry, the two closest states reach ~15.5px past the avatar, so the top
 * of the aura was being sliced flat on exactly the Muddies whose glow matters
 * most.
 *
 * These assert the NUMBERS a container has to clear, computed from the same
 * config the component renders from. If a future state grows its ring, this
 * fails and names the value the stylesheet has to keep up with -- rather than
 * the defect reappearing silently as a straight edge on someone's avatar.
 */

/**
 * Taken from the module, never re-listed here. A hard-coded copy silently
 * stops covering a level the moment one is added or renamed -- which is
 * exactly the drift this file exists to catch.
 */
const LEVELS: readonly ProximityGlowLevel[] = PROXIMITY_GLOW_LEVELS;

/**
 * How far the Glow's PAINTED edge reaches beyond the avatar, per side.
 *
 * Deliberately not `box`. `box` includes the radial field, whose conic
 * gradient is masked out by 76% of its radius -- it occupies that space but
 * paints nothing near the rim, so sizing a container to it would reserve ~47px
 * for something invisible. Browser measurement of the real layers agrees: the
 * closest state bleeds ~15.5px, not ~47px.
 *
 * The layers that draw a visible edge are the rings and the core, so those are
 * what a container actually has to clear.
 */
function bloomOverhangPx(level: ProximityGlowLevel, size: ProximityGlowSize): number {
  const geometry = resolveGlowGeometry(level, size);
  /**
   * `ring` and `core` are the layers that hold a solid, opaque edge.
   *
   * `outer` (ring2) is excluded on purpose: it animates from scale(0.82) to
   * scale(1.13) while fading to opacity 0, so the moment it reaches its widest
   * it is invisible. Reserving room for its full base size would demand ~37px
   * where browser measurement of the real thing shows ~15.5px of visible
   * bleed. `field` is excluded for the same reason -- masked out by 76% of its
   * radius.
   */
  const painted = Math.max(geometry.ring, geometry.core);
  return (painted - geometry.avatar) / 2;
}

/** What `.near-strip` reserves on every clipped axis: 1.75rem at a 16px root. */
const NEAR_STRIP_RESERVED_PX = 1.75 * 16;

/**
 * The Near strip draws its ring and ring2 pulled in to the midpoint of the
 * layer outside them, so the glow starts at the avatar rather than a ring's
 * distance away. Mirrors the `calc()` in `.near-strip .proximity-glow__ring`
 * and `__ring2`, and is what the reservation actually has to clear here.
 */
function nearStripOutermostPx(level: ProximityGlowLevel): number {
  const g = resolveGlowGeometry(level, NEAR_STRIP_SIZE);
  return (g.outer + g.ring) / 2;
}

/** Home renders `md` Glow avatars inside 4.75rem / 76px columns. */
const NEAR_STRIP_SIZE: ProximityGlowSize = "md";

describe("the Glow overhangs its avatar, and by how much", () => {
  it("every state reaches beyond the avatar at every size", () => {
    for (const level of LEVELS) {
      for (const size of Object.keys(PROXIMITY_GLOW_SIZES) as ProximityGlowSize[]) {
        expect(bloomOverhangPx(level, size), `${level} @ ${size}`).toBeGreaterThan(0);
      }
    }
  });

  it("the closest state reaches furthest", () => {
    const closest = bloomOverhangPx("right-here", NEAR_STRIP_SIZE);
    for (const level of LEVELS.slice(1)) {
      expect(bloomOverhangPx(level, NEAR_STRIP_SIZE)).toBeLessThanOrEqual(closest);
    }
  });

  it("overhang scales with the avatar rather than being fixed", () => {
    const sm = bloomOverhangPx("right-here", "sm");
    const hero = bloomOverhangPx("right-here", "hero");
    expect(hero).toBeGreaterThan(sm);
    // A fixed overhang would look huge on a 40px avatar and weak on a 96px
    // one; the ratio should track the avatar ratio, not sit at 1.
    expect(hero / sm).toBeGreaterThan(2);
  });
});

describe("the Near strip reserves enough room for the bloom", () => {
  it("reserves the Muddies-proven bloom room on block and inline axes", () => {
    expect(NEAR_STRIP_RESERVED_PX).toBe(28);
  });

  it("clears the widest state it can render", () => {
    const needed = bloomOverhangPx("right-here", NEAR_STRIP_SIZE);
    expect(NEAR_STRIP_RESERVED_PX).toBeGreaterThanOrEqual(needed);
  });

  it("clears ring2 at its STATIC size, which is what reduced motion shows", () => {
    /* A reduced-motion viewer sees ring2 held at full size and 0.65 opacity
     * rather than mid-animation, so their reading sets the requirement. This
     * is the case an earlier pass measured mid-animation and under-reserved. */
    for (const level of LEVELS) {
      const overhang =
        (nearStripOutermostPx(level) - PROXIMITY_GLOW_SIZES[NEAR_STRIP_SIZE].avatarPx) / 2;
      expect(NEAR_STRIP_RESERVED_PX, `${level} needs ${overhang.toFixed(2)}px`)
        .toBeGreaterThanOrEqual(overhang);
    }
  });

  it("clears EVERY state, not just the one that was measured", () => {
    for (const level of LEVELS) {
      expect(
        NEAR_STRIP_RESERVED_PX,
        `${level} needs ${bloomOverhangPx(level, NEAR_STRIP_SIZE).toFixed(2)}px`
      ).toBeGreaterThanOrEqual(bloomOverhangPx(level, NEAR_STRIP_SIZE));
    }
  });

  it("would have FAILED against the 8px the row used to carry", () => {
    // The regression this file exists for. If someone trims the padding back
    // to a spacing-sized value, the numbers above stop clearing.
    const oldPadding = 8;
    expect(oldPadding).toBeLessThan(bloomOverhangPx("right-here", NEAR_STRIP_SIZE));
  });
});

describe("the tightened gap is canonical, and keeps the states ordered", () => {
  /*
   * The tightening used to be a `.near-strip` stylesheet override, so these
   * tests re-applied the formula by hand to model what CSS would do. It now
   * lives in `resolveGlowGeometry`, which returns the tightened ring directly
   * -- so the values below are read, not recomputed. Applying the formula a
   * second time would measure a Glow the product never draws.
   *
   * The invariant is unchanged: the ring sits closer to the avatar than the
   * raw prototype offset put it, never inside the core, and the six states
   * stay strictly ordered so proximity still reads.
   */
  it("leaves a tighter avatar-edge to ring gap than the raw offset", () => {
    const g = resolveGlowGeometry("right-here", NEAR_STRIP_SIZE);
    const border = PROXIMITY_GLOW_CONFIG["right-here"].layers.ringWidth;
    const gap = (g.ring - border * 2 - g.avatar) / 2;

    // The raw, untightened offset for the same state and size.
    const scale = PROXIMITY_GLOW_SIZES[NEAR_STRIP_SIZE].avatarPx / PROXIMITY_GLOW_REFERENCE_AVATAR_PX;
    const rawRing = PROXIMITY_GLOW_CONFIG["right-here"].ring * scale;
    const rawGap = (rawRing - border * 2 - g.avatar) / 2;

    expect(gap).toBeLessThan(rawGap);
    expect(gap).toBeGreaterThan(0);
  });

  it("never pulls the ring inside the core, which would invert the layers", () => {
    for (const level of LEVELS) {
      const g = resolveGlowGeometry(level, NEAR_STRIP_SIZE);
      expect(g.ring, `${level}`).toBeGreaterThan(g.core);
    }
  });

  it("keeps the six states ordered after tightening", () => {
    const rings = LEVELS.map((level) => resolveGlowGeometry(level, NEAR_STRIP_SIZE).ring);
    for (let i = 1; i < rings.length; i += 1) {
      expect(rings[i - 1], `${LEVELS[i - 1]} vs ${LEVELS[i]}`).toBeGreaterThan(rings[i]!);
    }
  });
});

describe("geometry stays square and centred by construction", () => {
  it("the layout footprint is the avatar, never the bloom", () => {
    // The element occupies the avatar's box and the layers overflow it, which
    // is what stops a Glow widening a row or pushing its neighbours.
    for (const size of Object.keys(PROXIMITY_GLOW_SIZES) as ProximityGlowSize[]) {
      const geometry = resolveGlowGeometry("right-here", size);
      expect(geometry.avatar).toBe(PROXIMITY_GLOW_SIZES[size].avatarPx);
      expect(geometry.box).toBeGreaterThan(geometry.avatar);
    }
  });

  it("blur never drops below its floor at small sizes", () => {
    for (const size of Object.keys(PROXIMITY_GLOW_SIZES) as ProximityGlowSize[]) {
      const { blurFloor } = PROXIMITY_GLOW_SIZES[size];
      for (const level of LEVELS) {
        expect(resolveGlowGeometry(level, size).blur).toBeGreaterThanOrEqual(blurFloor);
      }
    }
  });
});
