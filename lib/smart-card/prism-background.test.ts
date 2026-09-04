import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

const prism = read("components/ui/prism-background.tsx");
const card = read("components/journey/smart-card.tsx");
const socializeHero = read("components/socialize/socialize-hero.tsx");
const socializePlan = read("components/socialize/socialize-plan-card.tsx");

// ---------------------------------------------------------------------------
// Decorative, never interactive
// ---------------------------------------------------------------------------

describe("the prism is decoration", () => {
  it("cannot intercept a tap, link or long press", () => {
    // The card is one big Link. A canvas that swallowed pointer events would
    // make the CTA dead on exactly the card people tap most.
    expect(prism).toContain("pointer-events-none");
    expect(prism).toContain('aria-hidden="true"');
  });

  it("is clipped to the card rather than overflowing it", () => {
    expect(prism).toContain("absolute inset-0 overflow-hidden");
  });

  it("imposes no height of its own", () => {
    // The reference demo wraps it in a fixed 600px shell; here the card
    // padding decides the size.
    expect(prism).not.toMatch(/height:\s*['"]?600/);
    expect(prism).not.toContain("min-h-");
  });

  it("carries no interactive handlers", () => {
    for (const handler of ["onClick", "onPointerDown", "onKeyDown", "tabIndex"]) {
      expect(prism, handler).not.toContain(handler);
    }
  });
});

// ---------------------------------------------------------------------------
// Failure is never fatal
// ---------------------------------------------------------------------------

describe("decorative failure never breaks Home", () => {
  it("survives a refused WebGL context", () => {
    // Blocklisted drivers, exhausted context budgets and memory pressure all
    // make this throw. Unguarded, it takes the whole page down.
    expect(prism).toContain("new Renderer(");
    const rendererBlock = prism.slice(prism.indexOf("let renderer"), prism.indexOf("const gl = renderer.gl"));
    expect(rendererBlock).toContain("catch");
  });

  it("survives a failed module load", () => {
    const at = prism.indexOf('await import("ogl")');
    expect(at).toBeGreaterThan(-1);
    expect(prism.slice(at, at + 220)).toContain("catch");
  });

  it("keeps ogl out of the initial bundle", () => {
    // Dynamic, so a card that never renders never pays for WebGL.
    expect(prism).not.toMatch(/^import\s+\{[^}]*Renderer/m);
  });
});

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

describe("lifecycle is fully cleaned up", () => {
  it("stops the frame loop, observers and canvas on unmount", () => {
    const teardown = prism.slice(prism.indexOf("teardown = () => {"));
    expect(teardown).toContain("stopRAF()");
    expect(teardown).toContain("ro.disconnect()");
    expect(teardown).toContain("io?.disconnect()");
    expect(teardown).toContain("removeChild(gl.canvas)");
  });

  it("releases the GPU context rather than waiting for GC", () => {
    // Mobile allows very few live contexts; leaking them breaks later ones.
    expect(prism).toContain("WEBGL_lose_context");
  });

  it("suspends while offscreen", () => {
    expect(prism).toContain("IntersectionObserver");
    expect(card).toContain("suspendWhenOffscreen");
  });

  it("does not leave a running loop when frozen", () => {
    // timeScale 0 draws one frame, then stops.
    expect(prism).toContain("TS < 1e-6 ? 0 : requestAnimationFrame(render)");
  });

  it("cannot append a canvas after unmount", () => {
    // The dynamic import can resolve after the effect is torn down.
    expect(prism).toContain("if (disposed || !containerRef.current) return;");
  });

  it("stores no state on the DOM node", () => {
    // The reference implementation hangs __prismIO off the container.
    expect(prism).not.toContain("__prismIO");
  });
});

// ---------------------------------------------------------------------------
// Exactly one animated background
// ---------------------------------------------------------------------------

describe("one animated background per card", () => {
  it("never stacks the prism and the sheen", () => {
    // Two live visual systems on one card is twice the cost for a muddier
    // result -- the prism REPLACES the sheen on its card.
    expect(card).toContain("{prominent || showPrism ? null : (");
  });

  it("mounts the prism on exactly one card id", () => {
    expect(card).toContain('const PRISM_CARD_IDS = new Set<SmartCard["id"]>(["suggestions"]);');
  });

  it("keeps the prism away from the safety states", () => {
    // safe_arrival and journey are excluded by construction: they are not in
    // PRISM_CARD_IDS, so no extra rule has to be maintained for them.
    const ids = card.slice(card.indexOf("const PRISM_CARD_IDS"), card.indexOf("export function SmartCardHero"));
    expect(ids).not.toContain("safe_arrival");
    expect(ids).not.toContain('"journey"');
  });

  it("renders only one prism instance", () => {
    expect(card.match(/<PrismBackground/g) ?? []).toHaveLength(1);
  });

  it("keeps the prism visible while protecting deferred light-theme copy", () => {
    expect(card).toContain("const prismAnimated = showPrism && !reducedMotion;");
    expect(card).toContain("showPrism && deferred ?");
    expect(card).toContain("rgba(254,251,243,0.96)");
    expect(card).toContain("dark:bg-transparent");
  });
});

// ---------------------------------------------------------------------------
// GlareHover keeps its own consumers
// ---------------------------------------------------------------------------

describe("GlareHover survives for its own consumers", () => {
  it("still serves the Socialize surfaces", () => {
    // GlareHover was never solely the Journey background, so the component
    // stays and only the one integration changed.
    expect(socializeHero).toContain("<GlareHover");
    expect(socializePlan).toContain("<GlareHover");
  });

  it("still serves the other Smart Card states", () => {
    expect(card).toContain("<GlareHover");
  });

  it("does not pull the prism into unrelated surfaces", () => {
    for (const [name, source] of Object.entries({ socializeHero, socializePlan })) {
      expect(source, name).not.toContain("PrismBackground");
    }
  });
});

// ---------------------------------------------------------------------------
// Reduced motion
// ---------------------------------------------------------------------------

describe("reduced motion", () => {
  it("renders no canvas at all, not a slower one", () => {
    // A slowed animation is still animation, so the canvas is gated on motion.
    expect(card).toContain("const prismAnimated = showPrism && !reducedMotion;");
    expect(card).toContain("{prismAnimated ? (");
    expect(card).toContain("useReducedMotion()");
  });

  it("keeps the card's earned identity when it drops the animation", () => {
    // The canvas goes; the card's identity does NOT. This previously read
    // `showPrism = PRISM_CARD_IDS.has(card.id) && !reducedMotion`, which
    // demoted an advanced Journey card to the ordinary gradient for anyone
    // who prefers reduced motion -- removing earned status as though it were
    // decoration. Identity is now motion-blind and a still ground stands in
    // for the canvas.
    expect(card).not.toContain("const showPrism = PRISM_CARD_IDS.has(card.id) && !reducedMotion;");
    expect(card).toContain("showPrism && !prismAnimated");
  });
});

// ---------------------------------------------------------------------------
// The card itself is not redesigned
// ---------------------------------------------------------------------------

describe("the Smart Card is not redesigned", () => {
  it("keeps its content, actions and routing", () => {
    expect(card).toContain("acknowledgeSmartCardAction(card.id)");
    expect(card).toContain("href={card.destination as Route}");
    expect(card).toContain("{card.title}");
    expect(card).toContain("{card.subtitle}");
    expect(card).toContain("{card.cta}");
  });

  it("keeps its dimensions and radius", () => {
    expect(card).toContain("rounded-[1.75rem]");
    expect(card).toContain('prominent ? "px-5 pb-5 pt-5" : "px-5 pb-4 pt-4"');
  });

  it("keeps the text column above the decoration", () => {
    // Prism sits at z-[2]; the content column at z-[1] in its own context.
    expect(card).toContain('className="relative z-[1] max-w-[58%]"');
  });

  it("keeps the progress meter behaviour", () => {
    expect(card).toContain("setAnimatedPercent(percent)");
  });
});

// ---------------------------------------------------------------------------
// The prism is the background, not an overlay
// ---------------------------------------------------------------------------

describe("the prism replaces the gradient rather than sitting on it", () => {
  it("drops the gradient on the prism card only", () => {
    // A gradient underneath would simply cover the animation.
    expect(card).toMatch(/showPrism\s*\?\s*"bg-\[#12060f\]"/);
    // Every other card keeps its identity.
    expect(card).toContain("bg-[linear-gradient(118deg,#9d1268_0%");
  });

  it("keeps a solid ground behind the canvas", () => {
    // The card must read as a finished object before WebGL paints, and if it
    // never paints at all.
    expect(card).toContain("bg-[#12060f]");
  });

  it("renders the prism behind the content, not over it", () => {
    const prismBlock = card.slice(card.indexOf("<PrismBackground"), card.indexOf("/>", card.indexOf("<PrismBackground")));
    expect(prismBlock).toContain('className="z-0"');
    // No blend mode or transparency: there is nothing underneath to blend.
    expect(prismBlock).not.toContain("mix-blend");
    expect(prismBlock).not.toContain("opacity-");
  });

  it("keeps the artwork above the canvas", () => {
    // The invariant is the STACKING: the illustration sits at z-[1], above the
    // prism canvas at z-0. It used to be asserted as the literal "top-[66%]
    // z-[1]", which broke when Journey earned its own vertical offset -- the
    // classes are now `absolute z-[1]` with top- chosen per card. Pin the
    // layer, and pin each card's offset separately, so a real regression still
    // fails but a legitimate reposition does not.
    expect(card).toMatch(/pointer-events-none absolute z-\[1\]/);
    expect(card).toContain("-right-12 top-[66%]");   // routine artwork
    expect(card).toContain("-right-1 top-[60%]");    // Journey target
  });

  it("protects the copy with a scrim over the animation", () => {
    // A moving prism has no fixed luminance, so bright passes would wash out
    // the title without this.
    const scrim = card.slice(card.indexOf("Readability scrim"));
    expect(scrim.slice(0, 800)).toContain("linear-gradient(100deg");
    expect(scrim.slice(0, 800)).toContain("pointer-events-none");
  });

  it("applies the scrim only where the prism renders", () => {
    // The other cards keep their own gradient and need no scrim.
    // The guard sits just after the scrim's own comment block.
    const afterComment = card.slice(card.indexOf("Readability scrim"));
    const guard = afterComment.slice(0, afterComment.indexOf("<span"));
    expect(guard).toContain("showPrism ?");
  });
});

// ---------------------------------------------------------------------------
// Composition on the prism card
// ---------------------------------------------------------------------------

describe("the prism card composes around the animation", () => {
  it("hides the cut-out illustration where the prism renders", () => {
    // The animation is the visual interest there; an illustration on top of
    // it makes two focal points competing in the same corner.
    expect(card).toMatch(/showPrism \? "hidden" : ""/);
  });

  it("keeps the illustration on every other card", () => {
    // Only the prism card loses it -- the rest still need the accent.
    expect(card).toContain("ILLUSTRATIONS[card.illustration]");
    expect(card).toContain("journey-hero-artwork");
  });

  it("pushes the light away from the text column", () => {
    // The copy occupies the left ~58%; a bright pass under it is what made
    // the title hard to read.
    const prismBlock = card.slice(card.indexOf("<PrismBackground"), card.indexOf("/>", card.indexOf("<PrismBackground")));
    expect(prismBlock).toMatch(/offsetX=\{\d+\}/);
  });

  it("supports the offset through a real shader uniform", () => {
    // Not a CSS transform: shifting the canvas would move its clip too.
    expect(prism).toContain("uniform vec2  uOffsetPx;");
    expect(prism).toContain("uOffsetPx: { value: offsetPxBuf }");
    expect(prism).toContain("offsetPxBuf[0] = offsetX * dpr;");
    // Declared AND applied: a uniform the shader never reads would leave the
    // light exactly where it was, with every other check still passing.
    expect(prism).toContain("gl_FragCoord.xy - 0.5 * iResolution.xy - uOffsetPx");
  });

  it("recomputes the offset on resize", () => {
    // Device pixel ratio and canvas size both feed it.
    const resize = card ? prism.slice(prism.indexOf("const resize = () => {"), prism.indexOf("const ro =")) : "";
    expect(resize).toContain("offsetPxBuf[0]");
  });
});
