import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ProximityGlow, type ProximityGlowProps } from "@/components/glow/proximity-glow";
import {
  PROXIMITY_GLOW_CONFIG,
  PROXIMITY_GLOW_LEVELS,
  resolveGlowGeometry,
  type ProximityGlowLevel
} from "@/lib/proximity/glow-config";

/**
 * What the Glow actually renders.
 *
 * glow-config.test.ts asserts the NUMBERS; this asserts the DOM those numbers
 * produce. Both are needed: a correct table wired to a component that silently
 * dropped half its layers would pass the first file completely.
 *
 * Rendered with react-dom/server and createElement rather than a DOM testing
 * library, because the suite runs in a node environment on .ts files and the
 * Glow is pure markup -- no state, no effects, no events -- so the static
 * markup IS the component.
 */

/**
 * Children are passed positionally, so `props` never carries a `children` key
 * (react/no-children-prop). The cast covers only the omitted `children`, which
 * createElement supplies from its third argument.
 */
const render = (level: ProximityGlowLevel | null, props: Record<string, unknown> = {}) =>
  renderToStaticMarkup(
    createElement(
      ProximityGlow,
      { level, ...props } as ProximityGlowProps,
      createElement("span", null, "avatar")
    )
  );

describe("every state renders the layers its config declares", () => {
  it.each(PROXIMITY_GLOW_LEVELS)("%s draws exactly its declared layers", (level) => {
    const html = render(level);
    const { layers } = PROXIMITY_GLOW_CONFIG[level];

    expect(html.includes("proximity-glow__radial")).toBe(layers.radial);
    expect(html.includes("proximity-glow__sparks")).toBe(layers.sparkOpacity > 0);
    expect(html.includes("proximity-glow__orbit")).toBe(layers.orbit);
    expect(html.includes("proximity-glow__ring2")).toBe(layers.ring2 !== "none");

    // The two layers every state keeps -- a state with neither would read as
    // no Glow at all.
    expect(html).toContain("proximity-glow__ring");
    expect(html).toContain("proximity-glow__core");
  });

  it("renders the full nine-spark set only where sparks are declared", () => {
    expect(render("right-here").match(/--spark-angle/g)).toHaveLength(9);
    // Not merely hidden: absent from the DOM, so a long list never pays for
    // nine animated nodes per row that nobody can see.
    expect(render("in-your-area")).not.toContain("--spark-angle");
    expect(render("across-town")).not.toContain("--spark-angle");
  });

  it("keeps the avatar above every decoration and outside the animation", () => {
    const html = render("right-here");
    expect(html).toContain("proximity-glow__subject");
    // The subject is last in the DOM, so it paints above the layers.
    expect(html.indexOf("proximity-glow__subject")).toBeGreaterThan(
      html.indexOf("proximity-glow__core")
    );
    expect(html).toContain("<span>avatar</span>");
  });
});

describe("geometry reaches the DOM as custom properties", () => {
  it.each(PROXIMITY_GLOW_LEVELS)("%s emits its resolved geometry", (level) => {
    const html = render(level, { size: "lg" });
    const geometry = resolveGlowGeometry(level, "lg");
    const config = PROXIMITY_GLOW_CONFIG[level];

    expect(html).toContain(`--glow-ring:${geometry.ring}px`);
    expect(html).toContain(`--glow-outer:${geometry.outer}px`);
    expect(html).toContain(`--glow-blur:${geometry.blur}px`);
    expect(html).toContain(`--glow-pulse:${config.pulseSeconds}s`);
    // The element occupies the AVATAR's footprint; the bloom overflows it.
    expect(html).toContain(`width:${geometry.avatar}px`);
    expect(html).toContain(`height:${geometry.avatar}px`);
  });

  it("occupies the avatar's footprint, not the bloom's", () => {
    // THE PRODUCT-SURFACE BUG this guards. Sizing the element to the bloom
    // (~2.2x the avatar) broke Home's Near strip: a 118px box in a 76px column
    // pushed neighbours apart, collided with the name beneath it, and was
    // sliced flat by the scroll container's 8px of vertical room. The bloom
    // must overflow instead -- overflow costs no layout space.
    for (const size of ["sm", "md", "lg", "hero"] as const) {
      const html = render("right-here", { size });
      const geometry = resolveGlowGeometry("right-here", size);
      expect(html, size).toContain(`width:${geometry.avatar}px`);
      expect(html, size).toContain(`height:${geometry.avatar}px`);
      // The full extent is still published, for surfaces that opt in.
      expect(html, size).toContain(`--glow-box:${geometry.box}px`);
      expect(geometry.box, size).toBeGreaterThan(geometry.avatar);
    }
  });

  it("keeps the layout footprint identical across every state", () => {
    // Two Muddies in a row must occupy the same space regardless of distance,
    // or the row visibly reflows as somebody walks closer.
    // Anchored to the layout `width:` declaration, not `--glow-box`, which is
    // published per state and legitimately differs.
    const widths = PROXIMITY_GLOW_LEVELS.map(
      (level) => /[;"]width:([\d.]+)px/.exec(render(level, { size: "md" }))?.[1]
    );
    expect(widths.every(Boolean)).toBe(true);
    expect(new Set(widths).size).toBe(1);
  });

  it("produces visibly different markup for the two extremes", () => {
    // The acceptance criterion in DOM form: if Right Here and Across Town ever
    // render the same thing, the port has been flattened.
    expect(render("right-here", { size: "hero" })).not.toBe(
      render("across-town", { size: "hero" })
    );
  });
});

describe("animation state is expressed as data attributes CSS can read", () => {
  it("animates by default and stops when reduced motion is requested", () => {
    expect(render("right-here")).toContain('data-animate="true"');
    expect(render("right-here", { reducedMotion: true })).toContain('data-animate="false"');
  });

  it("keeps the six states visually distinct under reduced motion", () => {
    // Motion stops; the hierarchy must not. Radius, strength and layer count
    // still separate the states, so no two still frames are identical.
    const still = PROXIMITY_GLOW_LEVELS.map((level) => render(level, { reducedMotion: true }));
    expect(new Set(still).size).toBe(PROXIMITY_GLOW_LEVELS.length);
  });

  it("declares the ring and wave treatments the stylesheet keys off", () => {
    expect(render("right-here")).toContain('data-ring2="expanding"');
    expect(render("just-around")).toContain('data-ring2="soft-pulse"');
    expect(render("across-town")).toContain('data-ring2="none"');
    expect(render("around-town")).toContain('data-ring-spin="true"');
    expect(render("across-town")).toContain('data-core-bloom="faint"');
  });

  it("orbits sparks in reverse only for the closest state", () => {
    expect(render("right-here")).toContain('data-spark-motion="reverse"');
    expect(render("just-around")).toContain('data-spark-motion="forward"');
  });
});

describe("no signal renders no Glow", () => {
  it("draws the subject bare", () => {
    const html = render(null);
    expect(html).toContain("<span>avatar</span>");
    expect(html).not.toContain("proximity-glow__");
    expect(html).not.toContain("--glow-ring");
  });
});

describe("intensity is presentation only", () => {
  it("cannot reorder the states", () => {
    // Whatever a surface does with intensity, closer must stay stronger.
    for (const intensity of [0.25, 0.72, 1, 1.6, 4]) {
      const strengths = PROXIMITY_GLOW_LEVELS.map((level) =>
        Number(/--glow-strength:([\d.]+)/.exec(render(level, { intensity }))?.[1])
      );
      for (let i = 1; i < strengths.length; i += 1) {
        expect(strengths[i], `intensity ${intensity}`).toBeLessThanOrEqual(strengths[i - 1]);
      }
    }
  });

  it("clamps rather than letting a surface exceed full strength", () => {
    expect(render("right-here", { intensity: 10 })).toContain("--glow-strength:1");
  });

  it("never changes geometry, only luminosity", () => {
    const plain = /--glow-ring:([\d.]+)px/.exec(render("close-by"))?.[1];
    const damped = /--glow-ring:([\d.]+)px/.exec(render("close-by", { intensity: 0.5 }))?.[1];
    expect(damped).toBe(plain);
  });
});

describe("the Glow is never baked into the avatar", () => {
  it("wraps the subject it was given, whatever that is", () => {
    // The same subject renders identically at any level; only the decoration
    // around it changes. Nothing here can touch the avatar image itself.
    for (const level of PROXIMITY_GLOW_LEVELS) {
      expect(render(level)).toContain("<span>avatar</span>");
    }
    expect(render(null)).toContain("<span>avatar</span>");
  });
});
