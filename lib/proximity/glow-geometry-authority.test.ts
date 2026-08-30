import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  AVATAR_SIZE_BY_GLOW_SIZE,
  PROXIMITY_GLOW_SIZES,
  PROXIMITY_GLOW_LEVELS,
  resolveGlowGeometry,
  type ProximityGlowSize
} from "@/lib/proximity/glow-config";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
/** Line splitter that tolerates either line ending, so a CRLF checkout reads the same. */
const SPLIT_LINES = /\r?\n/;

/**
 * C1 — the Glow geometry authority.
 *
 * The product rule is that on every Glow composition the avatar centre and
 * every concentric layer's centre are the SAME point. Runtime measurement
 * across the real production wrappers proves the current tree satisfies that.
 * These tests exist so it cannot silently stop being true.
 *
 * They assert the STRUCTURAL reasons centring holds, because those are what a
 * future change would break. A screenshot diff would notice later and explain
 * less.
 */
describe("glow geometry: one square frame owns every layer", () => {
  const css = read("app/globals.css");
  const glow = css.slice(css.indexOf(".proximity-glow {"), css.indexOf(".proximity-glow-reserve-bloom"));

  it("centres the container's own contents", () => {
    // Layers are absolutely positioned WITHOUT inset/left/top, so they are
    // placed by the container's own centring. Lose this and every layer falls
    // back to its static position -- top-left -- at once.
    expect(glow).toContain("display: grid");
    expect(glow).toContain("place-items: center");
    expect(glow).toContain("position: relative");
  });

  it("keeps the container square, so 'centred' means the same on both axes", () => {
    // The component sets width and height from the SAME number
    // (geometry.avatar). A non-square container would still centre each layer,
    // but the avatar and the layers would centre on different points once any
    // layer was sized from the other axis.
    const component = read("components/glow/proximity-glow.tsx");
    expect(component).toContain("width: `${geometry.avatar}px`");
    expect(component).toContain("height: `${geometry.avatar}px`");
  });

  it("never clips the layers it deliberately overflows", () => {
    // The layers are larger than the container by design. overflow:hidden here
    // would crop every state back to a disc and read as a broken Glow.
    expect(glow).toContain("overflow: visible");
  });
});

describe("glow geometry: avatar and layers agree on one size", () => {
  // The two size systems are independent by construction: PROXIMITY_GLOW_SIZES
  // drives the layers in px, AVATAR_SIZE_BY_GLOW_SIZE drives the avatar via a
  // UserAvatar token. If they ever disagree the subject and the rings centre
  // on different boxes -- the exact failure this tranche investigated.
  const AVATAR_TOKEN_PX: Record<string, number> = {
    sm: 40, // h-10
    md: 56, // h-14
    lg: 76, // h-[4.75rem]
    xl: 96 // h-24
  };

  it.each(Object.keys(PROXIMITY_GLOW_SIZES) as ProximityGlowSize[])(
    "size %s resolves the avatar and the layer box to the same px",
    (size) => {
      const layerPx = PROXIMITY_GLOW_SIZES[size].avatarPx;
      const avatarPx = AVATAR_TOKEN_PX[AVATAR_SIZE_BY_GLOW_SIZE[size]];
      expect(avatarPx, `glow size ${size}`).toBe(layerPx);
    }
  );

  it("pins the UserAvatar tokens this mapping depends on", () => {
    // The table above is a copy of values that live in another file, so it is
    // checked against the source rather than trusted.
    const avatar = read("components/ui/user-avatar.tsx");
    expect(avatar).toContain('sm: "h-10 w-10');
    expect(avatar).toContain('md: "h-14 w-14');
    expect(avatar).toContain('lg: "h-[4.75rem] w-[4.75rem]');
    expect(avatar).toContain('xl: "h-24 w-24');
  });
});

describe("glow geometry: content cannot move the centre", () => {
  it("keeps names, badges and buttons outside the Glow element", () => {
    // ProximityGlowAvatar renders exactly one child into the Glow: the avatar.
    // Names, proximity copy, Pro badges and buttons are the CALLER's siblings,
    // so no amount of text can widen the box the layers centre on.
    const component = read("components/glow/proximity-glow-avatar.tsx");
    const glowBlock = component.slice(component.indexOf("<ProximityGlow"));
    expect(glowBlock).toContain("<UserAvatar");

    // No sibling element inside the Glow other than the avatar, and no text
    // node at all. `name={name}` is fine -- that is a prop the avatar uses for
    // its alt text, not laid-out content.
    for (const leak of ["<button", "<p", "<span", "ProximityBadge", "ConfidenceBadge"]) {
      expect(glowBlock, `content must not render inside the Glow: ${leak}`).not.toContain(leak);
    }
    expect(glowBlock.match(/<[A-Za-z]/g)?.length, "exactly one element inside the Glow").toBe(2);
  });

  it("sizes the avatar from the glow size, not from its surroundings", () => {
    const component = read("components/glow/proximity-glow-avatar.tsx");
    expect(component).toContain("size={AVATAR_SIZE_BY_GLOW_SIZE[size]}");
  });
});

describe("glow geometry: no per-surface nudges", () => {
  const css = read("app/globals.css");

  it("corrects no production wrapper with a translate or offset", () => {
    // If one surface needed a nudge the architecture would be wrong, so the
    // absence of nudges IS the invariant. Scoped to the glow wrapper rules.
    for (const selector of [".muddies-rail-glow", ".muddies-card-avatar"]) {
      const start = css.indexOf(`${selector} {`);
      expect(start, `${selector} should exist`).toBeGreaterThan(-1);
      const block = css.slice(start, css.indexOf("}", start));
      expect(block, selector).not.toMatch(/transform:\s*translate/);
      expect(block, selector).not.toMatch(/margin-(left|top):\s*-?\d/);
    }
  });
});

describe("glow atomicity: one state looks the same on every surface", () => {
  const css = read("app/globals.css");

  it("lets no surface restyle the Glow's internal layers", () => {
    /*
     * THE DEFECT THIS EXISTS FOR. `.near-strip` (Home's nearby row) used to
     * redefine the ring, ring2 and core for the same proximity state every
     * other surface drew canonically -- measured at lg/right-here, Home drew a
     * 99.38px ring against 112.53px elsewhere. Same person, same state, same
     * size, two different Glows depending on the route.
     *
     * A surface may position the finished unit and reserve room around it. It
     * may not reach inside. Any `.some-surface .proximity-glow__layer` rule is
     * that reach, so the count must stay zero.
     */
    const surfaceScoped = css.match(/^\.[a-z-]+ +\.proximity-glow[^,{]*/gm) ?? [];
    expect(surfaceScoped, `surface-scoped Glow internals: ${surfaceScoped.join(", ")}`).toHaveLength(0);
  });

  it("keeps the ring tightening in the geometry, not in a stylesheet", () => {
    // If this moves back into CSS it can be scoped to one surface again, which
    // is exactly how the divergence happened.
    const config = read("lib/proximity/glow-config.ts");
    expect(config).toContain("const ring = round((config.ring * scale + core) / 2);");
    expect(css).not.toContain(".near-strip .proximity-glow__ring");
  });

  it("keeps every state ordered and inside its reserved box after tightening", () => {
    // Compression must not flatten proximity: closer must still draw wider.
    const rings = PROXIMITY_GLOW_LEVELS.map((l) => resolveGlowGeometry(l, "hero"));
    for (let i = 1; i < rings.length; i += 1) {
      expect(rings[i - 1]!.ring).toBeGreaterThan(rings[i]!.ring);
    }
    for (const g of rings) {
      expect(g.ring).toBeGreaterThan(g.core);
      expect(g.box).toBeGreaterThanOrEqual(g.outer);
    }
  });
});

describe("one proximity identity system", () => {
  const PRODUCTION_GLOB = ["components", "app"];

  /** Every production .tsx, excluding admin-gated VNext labs and dev harnesses. */
  function productionFiles(): string[] {
    return execSync(`git ls-files ${PRODUCTION_GLOB.join(" ")}`, { encoding: "utf8" })
      .split("\n")
      .filter((f) => f.endsWith(".tsx"))
      .filter((f) => !/vnext|profile-lab|chats-lab|\/dev\//.test(f));
  }

  it("renders Muddy proximity through exactly one component", () => {
    // ProximityGlowAvatar is the sole Muddy proximity primitive. The legacy
    // GlowAvatar path (GlowRing / .proximity-halo) survives only for Socialize,
    // which carries its own three-level discovery tier -- a different signal
    // with its own filtering and ranking, not the six-state nearby band.
    const legacy = productionFiles().filter((f) =>
      readFileSync(join(process.cwd(), f), "utf8").includes("<GlowAvatar")
    );
    const allowed = [
      "components/socialize/socialize-person-card.tsx",
      "components/socialize/swipe-deck.tsx",
      "components/onboarding/visibility-preview-card.tsx",
      // Unrouted legacy Messages pages: no route imports them. Listed so the
      // guard stays honest rather than silently passing over dead files.
      "components/messages/messages-page.tsx",
      "components/messages/messages-page-v2.tsx",
      "components/messages/messages-page-v3.tsx"
    ];
    const unexpected = legacy.filter((f) => !allowed.includes(f));
    expect(unexpected, `new legacy Glow callers: ${unexpected.join(", ")}`).toHaveLength(0);
  });

  it("never fabricates a proximity level for a card that has no proximity data", () => {
    // Home's first-muddy card used to hardcode proximityLevel="near" for a
    // person whose props are {id, displayName, avatarUrl}. A Glow is a claim
    // about where somebody is; it may only come from real authorized data.
    const card = read("components/activation/first-muddy-card.tsx");
    // Matched as a JSX prop, so the explanatory comment above the change does
    // not itself trip the guard.
    expect(card).not.toMatch(/proximityLevel=/);
    expect(card).toContain("<UserAvatar");
  });

  it("keeps the inbox free of a Glow it has no proximity for", () => {
    // Conversation membership is not a proximity fact.
    const row = read("components/messaging/conversation-row-v4.tsx");
    expect(row).not.toContain("GlowAvatar");
    expect(row).toContain("<UserAvatar");
  });

  it("has no purple in the proximity Glow path", () => {
    // Brand rule: proximity is the warm orange/maroon system.
    const css = read("app/globals.css");
    const railBlock = css.slice(css.indexOf(".muddies-rail-tone-close"), css.indexOf("/* --- Filter chips"));
    // Declarations only: the comment recording which purples were removed is
    // documentation, not a colour anything can render.
    const declarations = railBlock
      .split(SPLIT_LINES)
      .filter((line) => !line.trim().startsWith("*") && !line.trim().startsWith("/*"))
      .join(" ");
    for (const purple of ["#a78bfa", "#8b7bd8", "#8b5cf6", "167 139 250"]) {
      expect(declarations, `purple declared in the rail tone block: ${purple}`).not.toContain(purple);
    }
  });
});
