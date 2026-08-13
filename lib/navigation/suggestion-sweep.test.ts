import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");
const css = read("app/globals.css");
const home = read("components/dashboard/dashboard-page.tsx");
const hook = read("hooks/use-sequence-highlight.ts");

/** The sweep's own CSS block, isolated from the rest of the stylesheet. */
const sweepCss = css.slice(css.indexOf("@property --sug-angle"), css.indexOf("/* Mobile Nearby-Muddies strip"));

// ---------------------------------------------------------------------------
// Sequential: exactly one card at a time
// ---------------------------------------------------------------------------

describe("sequential behaviour", () => {
  it("marks exactly one card by rendered index", () => {
    expect(home).toContain("sweeping={index === sweepingIndex}");
  });

  it("advances in order and wraps, never randomly", () => {
    expect(hook).toContain("(activeRef.current + 1) % count");
    expect(hook).not.toContain("Math.random");
  });

  it("does not reorder the suggestions themselves", () => {
    const rail = home.slice(home.indexOf("primary.map((action, index)"), home.indexOf("</div>"));
    expect(rail).not.toContain(".sort(");
    expect(rail).not.toContain(".reverse(");
  });

  it("runs one shared controller, not a timer per card", () => {
    // The card is presentational: it takes a boolean and owns no timer.
    const card = home.slice(home.indexOf("function SuggestionCard"), home.indexOf("function QuickActionTile"));
    expect(card).not.toContain("setTimeout");
    expect(card).not.toContain("useEffect");
    // One scheduling effect owning a single `timer` handle, regardless of
    // how many cards there are.
    expect((hook.match(/let timer = 0;/g) ?? []).length).toBe(1);
    expect(hook).toContain("window.clearTimeout(timer)");
  });

  it("holds each card for ~2.75s with a short gap", () => {
    expect(hook).toContain("durationMs = 2750");
    expect(hook).toContain("gapMs = 700");
    // The CSS sweep matches the hold, so the rotation completes exactly once.
    expect(sweepCss).toContain("animation: suggestion-sweep 2.75s linear");
  });
});

// ---------------------------------------------------------------------------
// Visual treatment
// ---------------------------------------------------------------------------

describe("visual treatment", () => {
  it("animates a rotating conic gradient behind the card", () => {
    expect(sweepCss).toContain("conic-gradient(");
    expect(sweepCss).toContain("from var(--sug-angle)");
    expect(sweepCss).toContain("z-index: -1");
  });

  it("draws a rim, never a wash across the card", () => {
    // Without the mask the conic gradient fills the whole layer and tints the
    // card, which is what the first attempt did.
    expect(sweepCss).toContain("mask-composite: exclude");
    expect(sweepCss).toContain("padding: 1.5px");
  });

  it("keeps the card surface above the animated layer", () => {
    expect(sweepCss).toContain("isolation: isolate");
  });

  it("leaves the card content completely static", () => {
    const card = home.slice(home.indexOf("function SuggestionCard"), home.indexOf("function QuickActionTile"));
    // Only the existing press feedback animates; nothing inside moves.
    expect(card).not.toContain("animate-pulse");
    expect(card).not.toContain("animate-spin");
    expect(card).not.toContain("animate-bounce");
  });

  it("stays subtle rather than a neon halo", () => {
    // Low opacity, a hairline blur, and no box-shadow glow on the rim.
    expect(sweepCss).toContain("filter: blur(0.5px)");
    expect(sweepCss).not.toContain("box-shadow");
    const opacities = [...sweepCss.matchAll(/opacity:\s*([\d.]+)/g)].map((m) => Number(m[1]));
    for (const value of opacities) expect(value).toBeLessThanOrEqual(0.9);
  });

  it("does not change card size or clip the rim", () => {
    const card = home.slice(home.indexOf("function SuggestionCard"), home.indexOf("function QuickActionTile"));
    expect(card).toContain("w-[7.75rem]");
    // overflow-hidden would cut off a rim drawn at inset -1px. Matched as a
    // class (the comment above it in the source explains the omission).
    expect(card).not.toMatch(/(?<!NOT )overflow-hidden(?= )/);
  });
});

// ---------------------------------------------------------------------------
// Per-card colour
// ---------------------------------------------------------------------------

describe("per-card colour", () => {
  it("gives every tone its own edge pair", () => {
    const tones = home.slice(home.indexOf("const SUGGESTION_TONE"), home.indexOf("const quickActions"));
    for (const tone of ["orange", "lavender", "green", "blue", "blush"]) {
      expect(tones, `${tone} needs an edge`).toContain(`${tone}: {`);
    }
    expect((tones.match(/edge: \{ a: "/g) ?? []).length).toBe(5);
  });

  it("uses no shared rainbow", () => {
    const tones = home.slice(home.indexOf("const SUGGESTION_TONE"), home.indexOf("const quickActions"));
    const edges = [...tones.matchAll(/edge: \{ a: "([^"]+)", b: "([^"]+)" \}/g)].map((m) => `${m[1]}|${m[2]}`);
    expect(new Set(edges).size).toBe(edges.length);
  });

  it("passes the colours as custom properties, not inline animation", () => {
    expect(home).toContain('"--sug-a": tone.edge.a');
    expect(home).toContain('"--sug-b": tone.edge.b');
  });
});

// ---------------------------------------------------------------------------
// Pausing
// ---------------------------------------------------------------------------

describe("pausing", () => {
  it("pauses while the rail is touched or scrolled", () => {
    expect(hook).toContain("pointerdown");
    expect(hook).toContain("touchstart");
    expect(hook).toContain('addEventListener("scroll"');
    expect(home).toContain("useInteractionPause(railRef)");
  });

  it("waits for momentum to settle before resuming", () => {
    expect(hook).toContain("setBusy(false), 400");
  });

  it("does not depend on a removed More sheet", () => {
    expect(home).toContain("paused: railBusy");
    expect(home).not.toContain("paused: railBusy || moreOpen");
  });

  it("pauses in a hidden tab", () => {
    expect(hook).toContain('document.addEventListener("visibilitychange"');
    expect(hook).toContain('document.visibilityState === "hidden"');
  });

  it("keeps the existing press feedback", () => {
    const card = home.slice(home.indexOf("function SuggestionCard"), home.indexOf("function QuickActionTile"));
    expect(card).toContain("active:scale-[0.98]");
  });
});

// ---------------------------------------------------------------------------
// Accessibility + fallback
// ---------------------------------------------------------------------------

describe("accessibility and fallback", () => {
  it("renders a static border only under reduced motion", () => {
    const reduced = sweepCss.slice(sweepCss.indexOf("@media (prefers-reduced-motion: reduce)"));
    expect(reduced).toContain("animation: none");
    expect(reduced).toContain("linear-gradient(");
    expect(reduced).not.toContain("conic-gradient(");
  });

  it("stops the sequence entirely under reduced motion", () => {
    expect(hook).toContain("useReducedMotion()");
    expect(hook).toContain("reducedMotion || paused || hidden || count <= 1");
  });

  it("communicates nothing by animation alone", () => {
    // The rim is decorative; the accessible label carries the meaning.
    const card = home.slice(home.indexOf("function SuggestionCard"), home.indexOf("function QuickActionTile"));
    expect(card).toContain("aria-label={`${action.label}. ${action.suggestion}`}");
    expect(card).not.toContain("aria-live");
  });

  it("degrades to the static rim without @property", () => {
    // The static background is the BASE rule, so a browser that cannot
    // animate the angle simply keeps it — no broken layout, no missing card.
    const base = sweepCss.slice(sweepCss.indexOf(".suggestion-card::before"), sweepCss.indexOf(".suggestion-card.is-sweeping"));
    expect(base).toContain("linear-gradient(");
    expect(base).toContain("border-radius: inherit");
  });

  it("uses no canvas, video, GIF or image asset", () => {
    for (const banned of ["<canvas", "<video", ".gif", "url("]) {
      expect(sweepCss, `must not use ${banned}`).not.toContain(banned);
    }
  });
});

// ---------------------------------------------------------------------------
// Themes
// ---------------------------------------------------------------------------

describe("themes", () => {
  it("lowers the rim opacity at night", () => {
    expect(sweepCss).toContain('data-theme="dark"');
    const dark = sweepCss.slice(sweepCss.indexOf(':root[data-theme="dark"]'));
    const opacities = [...dark.matchAll(/opacity:\s*([\d.]+)/g)].map((m) => Number(m[1]));
    expect(opacities.length).toBeGreaterThan(0);
    for (const value of opacities) expect(value).toBeLessThan(0.7);
  });
});
