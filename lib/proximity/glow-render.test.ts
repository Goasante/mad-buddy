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

const render = (level: ProximityGlowLevel | null, props: Record<string, unknown> = {}) =>
  renderToStaticMarkup(
    createElement(
      ProximityGlow,
      { level, ...props } as ProximityGlowProps,
      createElement("span", null, "avatar")
    )
  );

describe("Magnetic Pulse DOM", () => {
  it.each(PROXIMITY_GLOW_LEVELS)("%s renders exactly its configured pulse count", (level) => {
    const html = render(level);
    const count = (html.match(/data-pulse-ring=/g) ?? []).length;
    expect(count).toBe(PROXIMITY_GLOW_CONFIG[level].layers.pulseCount);
    expect(html).toContain(`data-pulse-count="${count}"`);
  });

  it("does not render the retired spark/orbit/dotted treatment", () => {
    for (const level of PROXIMITY_GLOW_LEVELS) {
      const html = render(level);
      expect(html).not.toContain("spark-angle");
      expect(html).not.toContain("proximity-glow__sparks");
      expect(html).not.toContain("proximity-glow__orbit");
      expect(html).not.toContain("dotted");
      expect(html).not.toContain("dashed");
    }
  });

  it("renders a rotating highlight only for the close states that declare one", () => {
    for (const level of PROXIMITY_GLOW_LEVELS) {
      const html = render(level);
      const expected = PROXIMITY_GLOW_CONFIG[level].layers.sweepSeconds !== null;
      expect(html.includes('data-has-sweep="true"')).toBe(expected);
    }
  });

  it("keeps the subject above decoration and outside animation state", () => {
    const html = render("right-here");
    expect(html).toContain("<span>avatar</span>");
    expect(html.lastIndexOf("<span>avatar</span>")).toBeGreaterThan(html.indexOf("data-pulse-ring"));
  });
});

describe("requested timing reaches the DOM", () => {
  it("sets Just Around to a 1.7s pulse and 2.15s revolution", () => {
    const html = render("just-around", { size: "lg" });
    expect(html).toContain("--glow-pulse:1.7s");
    expect(html).toContain("--glow-sweep:2.15s");
    expect(html).toContain('data-pulse-count="3"');
    expect(html).toContain('data-has-sweep="true"');
  });

  it("leaves broad-area states without a rotating highlight", () => {
    expect(render("in-your-area")).toContain('data-has-sweep="false"');
    expect(render("around-town")).toContain('data-has-sweep="false"');
    expect(render("across-town")).toContain('data-has-sweep="false"');
  });
});

describe("geometry reaches the DOM without changing layout", () => {
  it.each(PROXIMITY_GLOW_LEVELS)("%s emits resolved geometry", (level) => {
    const html = render(level, { size: "lg" });
    const geometry = resolveGlowGeometry(level, "lg");
    const config = PROXIMITY_GLOW_CONFIG[level];

    expect(html).toContain(`--glow-ring:${geometry.ring}px`);
    expect(html).toContain(`--glow-outer:${geometry.outer}px`);
    expect(html).toContain(`--glow-blur:${geometry.blur}px`);
    expect(html).toContain(`--glow-pulse:${config.pulseSeconds}s`);
    expect(html).toContain(`width:${geometry.avatar}px`);
    expect(html).toContain(`height:${geometry.avatar}px`);
    expect(html).toContain(`--glow-box:${geometry.box}px`);
  });

  it("keeps the same avatar footprint across all six states", () => {
    const widths = PROXIMITY_GLOW_LEVELS.map(
      (level) => /[;\"]width:([\d.]+)px/.exec(render(level, { size: "md" }))?.[1]
    );
    expect(widths.every(Boolean)).toBe(true);
    expect(new Set(widths).size).toBe(1);
  });
});

describe("reduced motion and intensity", () => {
  it("stops animation when the caller requests reduced motion", () => {
    expect(render("just-around")).toContain('data-animate="true"');
    expect(render("just-around", { reducedMotion: true })).toContain('data-animate="false"');
  });

  it("keeps all six states distinct as still frames", () => {
    const still = PROXIMITY_GLOW_LEVELS.map((level) => render(level, { reducedMotion: true }));
    expect(new Set(still).size).toBe(PROXIMITY_GLOW_LEVELS.length);
  });

  it("clamps intensity and never changes geometry", () => {
    expect(render("right-here", { intensity: 10 })).toContain("--glow-strength:1");
    const plain = /--glow-ring:([\d.]+)px/.exec(render("close-by"))?.[1];
    const damped = /--glow-ring:([\d.]+)px/.exec(render("close-by", { intensity: 0.5 }))?.[1];
    expect(damped).toBe(plain);
  });
});

describe("no signal", () => {
  it("renders a bare subject without inventing a Far state", () => {
    const html = render(null);
    expect(html).toContain("<span>avatar</span>");
    expect(html).not.toContain("data-pulse-ring");
    expect(html).not.toContain("--glow-ring");
  });
});
