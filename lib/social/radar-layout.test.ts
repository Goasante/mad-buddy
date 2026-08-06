import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  TIER_RADIUS,
  angularOffset,
  buildRadarField,
  hashIdentity,
  identityAngle,
  type RadarPerson,
  type RadarTier
} from "@/lib/social/radar-layout";
import { stripComments } from "@/lib/content/strip-comments";

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

/** A 390px-wide field, the reference breakpoint. */
const FIELD = { rx: 150, ry: 168, nodeSize: 56, minGap: 12, maxNodes: 10 };

function person(userId: string, proximityTier: RadarTier = "near"): RadarPerson {
  return { userId, proximityTier };
}

const ids = (people: string[], tier: RadarTier = "near") => people.map((id) => person(id, tier));

// ---------------------------------------------------------------------------
// Identity-based placement
// ---------------------------------------------------------------------------

describe("identity-based placement", () => {
  it("derives the angle from the user id alone", () => {
    expect(identityAngle("kofi")).toBe(identityAngle("kofi"));
    expect(identityAngle("kofi")).not.toBe(identityAngle("ama"));
  });

  it("produces an angle inside one full turn", () => {
    for (const id of ["a", "kofi", "ama_gh", "nana.v", "9f3c-uuid-like-value"]) {
      const angle = identityAngle(id);
      expect(angle).toBeGreaterThanOrEqual(0);
      expect(angle).toBeLessThan(Math.PI * 2);
    }
  });

  it("spreads different identities around the circle", () => {
    // Not a uniformity proof — just that the hash does not clump everyone
    // into one quadrant.
    const angles = Array.from({ length: 40 }, (_, i) => identityAngle(`user-${i}`));
    const quadrants = new Set(angles.map((angle) => Math.floor(angle / (Math.PI / 2))));
    expect(quadrants.size).toBe(4);
  });

  it("uses no randomness anywhere", () => {
    const source = stripComments(read("lib/social/radar-layout.ts"));
    expect(source).not.toContain("Math.random");
    expect(source).not.toContain("Date.now");
  });

  it("never derives position from list order", () => {
    const source = stripComments(read("lib/social/radar-layout.ts"));
    // The angle comes from identityAngle(userId); no index arithmetic.
    expect(source).toContain("identityAngle(person.userId)");
    expect(source).not.toContain("index * ");
    expect(source).not.toContain("forEach((person, index)");
  });
});

// ---------------------------------------------------------------------------
// Stability
// ---------------------------------------------------------------------------

describe("angular stability", () => {
  const roster = ids(["kofi", "ama", "nana", "john"]);
  const angleOf = (field: ReturnType<typeof buildRadarField>, id: string) =>
    field.nodes.find((node) => node.person.userId === id)?.angle;

  it("is identical across a refresh", () => {
    const first = buildRadarField(roster, FIELD);
    const second = buildRadarField(roster, FIELD);
    expect(second.nodes.map((n) => [n.person.userId, n.x, n.y])).toEqual(
      first.nodes.map((n) => [n.person.userId, n.x, n.y])
    );
  });

  it("is unaffected by the order the list arrives in", () => {
    const forward = buildRadarField(roster, FIELD);
    const reversed = buildRadarField([...roster].reverse(), FIELD);
    for (const { person: p } of forward.nodes) {
      expect(angleOf(reversed, p.userId)).toBe(angleOf(forward, p.userId));
    }
  });

  it("holds everyone's angle when someone joins", () => {
    const before = buildRadarField(roster, FIELD);
    const after = buildRadarField([...roster, person("newcomer")], FIELD);
    for (const { person: p } of before.nodes) {
      expect(angleOf(after, p.userId), `${p.userId} moved`).toBe(angleOf(before, p.userId));
    }
  });

  it("holds everyone's angle when someone leaves", () => {
    const before = buildRadarField(roster, FIELD);
    const after = buildRadarField(roster.filter((p) => p.userId !== "ama"), FIELD);
    for (const { person: p } of after.nodes) {
      expect(angleOf(after, p.userId), `${p.userId} moved`).toBe(angleOf(before, p.userId));
    }
  });

  it("does not reshuffle the field because one person arrives", () => {
    const before = buildRadarField(roster, FIELD);
    const after = buildRadarField([...roster, person("newcomer")], FIELD);
    const moved = before.nodes.filter(
      (node) => angleOf(after, node.person.userId) !== node.angle
    );
    expect(moved).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Orbit bands
// ---------------------------------------------------------------------------

describe("orbit bands", () => {
  it("maps each band to its own radius, inner to outer", () => {
    expect(TIER_RADIUS.close).toBeLessThan(TIER_RADIUS.near);
    expect(TIER_RADIUS.near).toBeLessThan(TIER_RADIUS.far);
  });

  it("changes ONLY the radius when proximity changes", () => {
    const near = buildRadarField([person("kofi", "near")], FIELD).nodes[0]!;
    const close = buildRadarField([person("kofi", "close")], FIELD).nodes[0]!;

    // Same spoke: the angle is identical, so the node slides in and out
    // rather than rotating around the radar.
    expect(close.angle).toBe(near.angle);
    expect(Math.hypot(close.x, close.y)).toBeLessThan(Math.hypot(near.x, near.y));
  });

  it("keeps a person on their own spoke across every band", () => {
    const angles = (["close", "near", "far"] as const).map(
      (tier) => buildRadarField([person("ama", tier)], FIELD).nodes[0]!.angle
    );
    expect(new Set(angles).size).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Collisions
// ---------------------------------------------------------------------------

describe("collision handling", () => {
  it("never overlaps two nodes", () => {
    const crowd = ids(Array.from({ length: 10 }, (_, i) => `user-${i}`));
    const field = buildRadarField(crowd, FIELD);
    for (let i = 0; i < field.nodes.length; i += 1) {
      for (let j = i + 1; j < field.nodes.length; j += 1) {
        const a = field.nodes[i]!;
        const b = field.nodes[j]!;
        expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThanOrEqual(FIELD.nodeSize + FIELD.minGap);
      }
    }
  });

  it("leaves an uncontested node exactly on its identity angle", () => {
    const field = buildRadarField([person("solo")], FIELD);
    expect(angularOffset(field.nodes[0]!)).toBe(0);
  });

  it("applies only a small nudge when two collide", () => {
    // Everyone in one band on a small field, so contention is guaranteed.
    const tight = { ...FIELD, rx: 90, ry: 90 };
    const field = buildRadarField(ids(["a", "b", "c", "d"], "close"), tight);
    for (const node of field.nodes) {
      // Well under a quarter turn: a nudge, not a relocation.
      expect(angularOffset(node)).toBeLessThan(Math.PI / 2);
    }
  });

  it("keeps a nudged node in its own band", () => {
    const tight = { ...FIELD, rx: 90, ry: 90 };
    const field = buildRadarField(ids(["a", "b", "c", "d"], "close"), tight);
    for (const node of field.nodes) {
      expect(node.tier).toBe("close");
    }
  });

  it("resolves collisions identically every time", () => {
    const crowd = ids(Array.from({ length: 8 }, (_, i) => `u${i}`), "close");
    const first = buildRadarField(crowd, FIELD);
    const second = buildRadarField([...crowd].reverse(), FIELD);
    expect(second.nodes.map((n) => [n.person.userId, n.angle])).toEqual(
      first.nodes.map((n) => [n.person.userId, n.angle])
    );
  });
});

// ---------------------------------------------------------------------------
// Bounds
// ---------------------------------------------------------------------------

describe("edge overflow", () => {
  it("keeps every node inside the field", () => {
    const field = buildRadarField(ids(Array.from({ length: 10 }, (_, i) => `u${i}`)), FIELD);
    for (const node of field.nodes) {
      expect(Math.abs(node.x)).toBeLessThanOrEqual(FIELD.rx);
      expect(Math.abs(node.y)).toBeLessThanOrEqual(FIELD.ry);
    }
  });

  it("never exceeds the outermost band's radius", () => {
    const field = buildRadarField(ids(["a", "b", "c"], "far"), FIELD);
    for (const node of field.nodes) {
      const normalised = Math.hypot(node.x / FIELD.rx, node.y / FIELD.ry);
      expect(normalised).toBeLessThanOrEqual(TIER_RADIUS.far + 0.0001);
    }
  });
});

// ---------------------------------------------------------------------------
// Responsive geometry
// ---------------------------------------------------------------------------

describe("responsive geometry", () => {
  const widths = [
    { name: "320", rx: 118, ry: 132 },
    { name: "360", rx: 136, ry: 152 },
    { name: "390", rx: 150, ry: 168 },
    { name: "430", rx: 168, ry: 188 }
  ];

  it("places everyone without overlap at every breakpoint", () => {
    for (const { name, rx, ry } of widths) {
      const field = buildRadarField(ids(["kofi", "ama", "nana", "john"]), { ...FIELD, rx, ry });
      expect(field.nodes, `${name}px dropped nodes`).toHaveLength(4);
      for (let i = 0; i < field.nodes.length; i += 1) {
        for (let j = i + 1; j < field.nodes.length; j += 1) {
          const a = field.nodes[i]!;
          const b = field.nodes[j]!;
          expect(
            Math.hypot(a.x - b.x, a.y - b.y),
            `${name}px overlap`
          ).toBeGreaterThanOrEqual(FIELD.nodeSize + FIELD.minGap);
        }
      }
    }
  });

  it("keeps the same angle at every breakpoint", () => {
    // Only the scale changes; composition stays recognisably the same.
    const angles = widths.map(
      ({ rx, ry }) => buildRadarField([person("kofi")], { ...FIELD, rx, ry }).nodes[0]!.angle
    );
    expect(new Set(angles).size).toBe(1);
  });

  it("returns nothing for a field that has not been measured yet", () => {
    expect(buildRadarField(ids(["a"]), { ...FIELD, rx: 0, ry: 0 }).nodes).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Density and emptiness
// ---------------------------------------------------------------------------

describe("dense state", () => {
  it("caps deterministically rather than shrinking avatars", () => {
    const crowd = ids(Array.from({ length: 12 }, (_, i) => `user-${i}`));
    const field = buildRadarField(crowd, FIELD);
    expect(field.nodes.length).toBeLessThanOrEqual(FIELD.maxNodes);
    expect(field.nodes.length + field.overflow).toBe(12);
  });

  it("caps the same people every time", () => {
    const crowd = ids(Array.from({ length: 12 }, (_, i) => `user-${i}`));
    const first = buildRadarField(crowd, FIELD).nodes.map((n) => n.person.userId).sort();
    const second = buildRadarField([...crowd].reverse(), FIELD).nodes.map((n) => n.person.userId).sort();
    expect(second).toEqual(first);
  });

  it("accounts for everyone, shown or not", () => {
    const crowd = ids(Array.from({ length: 30 }, (_, i) => `user-${i}`), "close");
    const field = buildRadarField(crowd, FIELD);
    expect(field.nodes.length + field.overflow).toBe(30);
  });
});

describe("empty state", () => {
  it("returns an empty field with nothing to overflow", () => {
    expect(buildRadarField([], FIELD)).toEqual({ nodes: [], overflow: 0 });
  });
});

// ---------------------------------------------------------------------------
// Boundaries
// ---------------------------------------------------------------------------

describe("module boundaries", () => {
  it("only arranges the people it is given", () => {
    const source = stripComments(read("lib/social/radar-layout.ts"));
    for (const banned of ["createSupabase", "fetch(", "from(", "Action("]) {
      expect(source, `layout must not ${banned}`).not.toContain(banned);
    }
  });

  it("holds no React and no timers", () => {
    const source = stripComments(read("lib/social/radar-layout.ts"));
    for (const banned of ["useState", "useEffect", "setInterval", "setTimeout", "requestAnimationFrame"]) {
      expect(source, `layout must not use ${banned}`).not.toContain(banned);
    }
  });

  it("hashes identity consistently", () => {
    expect(hashIdentity("kofi")).toBe(hashIdentity("kofi"));
    expect(hashIdentity("")).toBeGreaterThanOrEqual(0);
  });
});

// ---------------------------------------------------------------------------
// Presentation
// ---------------------------------------------------------------------------

describe("radar presentation", () => {
  const page = read("components/socialize/socialize-page.tsx");
  it("replaced the old index-based placement", () => {
    // The previous engine derived angles from list order.
    expect(page).not.toContain("computeRadarLayout");
    expect(page).not.toContain("GOLDEN");
    expect(page).toContain("buildRadarField");
  });

  it("draws four orbit rings", () => {
    expect(page).toContain("const RING_FRACTIONS = [0.34, 0.55, 0.76, 0.97] as const;");
    expect(page).toContain("RING_FRACTIONS.map(");
  });

  it("designs each breakpoint rather than scaling one layout", () => {
    // Distinct centre size, node size, gap and cap per width.
    expect(page).toContain("const RADAR_SIZES");
    const sizes = page.slice(page.indexOf("const RADAR_SIZES"), page.indexOf("function radarSizeFor"));
    expect((sizes.match(/maxWidth:/g) ?? []).length).toBe(4);
    expect((sizes.match(/centre:/g) ?? []).length).toBe(4);
  });

  it("makes the central user the largest node", () => {
    const sizes = page.slice(page.indexOf("const RADAR_SIZES"), page.indexOf("function radarSizeFor"));
    const centres = [...sizes.matchAll(/centre: (\d+)/g)].map((m) => Number(m[1]));
    const nodes = [...sizes.matchAll(/node: (\d+)/g)].map((m) => Number(m[1]));
    centres.forEach((centre, index) => expect(centre).toBeGreaterThan(nodes[index]!));
  });

  it("labels the centre as the brief specifies", () => {
    expect(page).toContain(">You<");
    expect(page).toContain("Visible to nearby people");
  });

  it("places no control over the avatar", () => {
    // The avatar popover trigger is gone; the status control is the entry point.
    expect(page).not.toContain('aria-label={isActive ? "Socialize controls" : "Turn on Socialize"}');
  });

  it("attaches each label directly under its node", () => {
    expect(page).toContain("mt-1.5 whitespace-nowrap rounded-full");
  });

  it("gives every node a presence indicator", () => {
    expect(page).toContain("rounded-full border-[3px] border-[#0d0d12] bg-emerald-500");
  });

  it("keeps the premium ring independent of proximity", () => {
    // The ring class comes from the plan-driven TIER_RING map, applied
    // regardless of which band the node sits in.
    expect(page).toContain("TIER_RING[tier]");
    const node = page.slice(page.indexOf("field.nodes.map("), page.indexOf("The single aggregate entry point"));
    expect(node).not.toContain("plan ===");
  });

  it("selects without re-laying out the field", () => {
    // Selection only adds a class; positions come from the layout module and
    // are untouched by previewPerson.
    expect(page).toContain('selected && "is-selected"');
    // The memo's dependency array is what decides whether selecting someone
    // can move anybody: it lists people, size and geometry — and deliberately
    // not previewPerson.
    // The dependency array lists people, size and geometry — never the
    // selection, so selecting cannot move anybody.
    // Presence filtering (Step 6.1) means the memo reads visiblePeople. It
    // still never depends on the selection.
    expect(page).toContain("[isActive, visiblePeople, rx, ry, geometry.node, geometry.minGap, geometry.maxNodes, centreClearance]");
  });

  it("keeps the field, rings and centre in the empty state", () => {
    // Step 6 replaced the ad-hoc message with the canonical state resolver.
    // The field, rings and centre still render beneath it — only a quiet
    // line is added, never a placeholder card.
    const empty = page.slice(page.indexOf("{stateCopy.message ?"));
    expect(empty.slice(0, 600)).toContain("socialize-state absolute");
    expect(empty.slice(0, 600)).not.toContain("rounded-2xl border");
  });
});

describe("radar motion", () => {
  const css = read("app/globals.css");
  const fieldCss = stripComments(css.slice(css.indexOf("/* Socialize radar field")));

  it("breathes the orbit rings gently", () => {
    expect(fieldCss).toContain("@keyframes socialize-orbit-breathe");
    expect(fieldCss).toContain("scale(1.018)");
  });

  it("never spins or orbits continuously", () => {
    expect(fieldCss).not.toContain("rotate(");
    expect(fieldCss).not.toContain("360deg");
  });

  it("fades nodes in and interpolates position changes", () => {
    expect(fieldCss).toContain("@keyframes socialize-node-in");
    // Matched as tokens: the stylesheet uses CRLF, so a multi-line needle
    // never matches.
    expect(fieldCss).toContain("transition:");
    expect(fieldCss).toContain("left 520ms");
  });

  it("keeps the surface calm — no particles, no heavy blur", () => {
    expect(fieldCss).not.toContain("blur(");
    expect(fieldCss).not.toContain("particle");
  });

  it("stops animating under reduced motion but still updates position", () => {
    const reduced = fieldCss.slice(fieldCss.indexOf("prefers-reduced-motion"));
    expect(reduced).toContain("animation: none");
    expect(reduced).toContain("transition: none");
  });

  it("uses CSS only — no timer per node", () => {
    const page = read("components/socialize/socialize-page.tsx");
    const nodes = page.slice(page.indexOf("field.nodes.map("), page.indexOf("The single aggregate entry point"));
    for (const banned of ["setInterval", "setTimeout", "requestAnimationFrame"]) {
      expect(nodes, `nodes must not run ${banned}`).not.toContain(banned);
    }
  });
});

// ---------------------------------------------------------------------------
// Step 3.1 — visual polish
// ---------------------------------------------------------------------------

describe("centre clearance", () => {
  it("keeps even the innermost band outside a given clearance", () => {
    // A short field where the Close fraction alone would land under the centre.
    const tight = { rx: 120, ry: 120, nodeSize: 60, minGap: 10, maxNodes: 6, minRadius: 96 };
    const built = buildRadarField(ids(["a", "b", "c"], "close"), tight);
    expect(built.nodes.length).toBeGreaterThan(0);
    for (const node of built.nodes) {
      expect(Math.hypot(node.x, node.y)).toBeGreaterThanOrEqual(96 - 0.001);
    }
  });

  it("leaves placement unchanged when the clearance is already met", () => {
    const withClearance = buildRadarField(ids(["a", "b"], "far"), { ...FIELD, minRadius: 40 });
    const without = buildRadarField(ids(["a", "b"], "far"), FIELD);
    expect(withClearance.nodes.map((n) => [n.x, n.y])).toEqual(without.nodes.map((n) => [n.x, n.y]));
  });

  it("still holds the identity angle after being pushed outward", () => {
    // Clearance changes the RADIUS only — never the spoke.
    const tight = { rx: 120, ry: 120, nodeSize: 60, minGap: 10, maxNodes: 6, minRadius: 96 };
    const built = buildRadarField([person("solo", "close")], tight);
    expect(angularOffset(built.nodes[0]!)).toBe(0);
  });

  it("never pushes a node past the field edge", () => {
    const tight = { rx: 120, ry: 120, nodeSize: 60, minGap: 10, maxNodes: 6, minRadius: 400 };
    const built = buildRadarField(ids(["a"], "close"), tight);
    for (const node of built.nodes) {
      expect(Math.abs(node.x)).toBeLessThanOrEqual(120);
      expect(Math.abs(node.y)).toBeLessThanOrEqual(120);
    }
  });
});

describe("visual polish", () => {
  const page = read("components/socialize/socialize-page.tsx");
  const css = read("app/globals.css");
  const fieldCss = stripComments(css.slice(css.indexOf("/* Socialize radar field")));

  it("reduced the centre by roughly 15-20%", () => {
    const sizes = page.slice(page.indexOf("const RADAR_SIZES"), page.indexOf("const TIER_SCALE"));
    const centres = [...sizes.matchAll(/centre: (\d+)/g)].map((m) => Number(m[1]));
    // Previously 128 / 144 / 160 / 176.
    const before = [128, 144, 160, 176];
    centres.forEach((centre, index) => {
      const ratio = centre / before[index]!;
      expect(ratio).toBeGreaterThan(0.79);
      expect(ratio).toBeLessThan(0.87);
    });
  });

  it("keeps the centre larger than any node", () => {
    const sizes = page.slice(page.indexOf("const RADAR_SIZES"), page.indexOf("const TIER_SCALE"));
    const centres = [...sizes.matchAll(/centre: (\d+)/g)].map((m) => Number(m[1]));
    const nodes = [...sizes.matchAll(/node: (\d+)/g)].map((m) => Number(m[1]));
    centres.forEach((centre, index) => expect(centre).toBeGreaterThan(nodes[index]! * 1.1));
  });

  it("gives the You label more breathing room", () => {
    expect(page).toContain('className="mt-4 text-[0.8125rem] font-semibold text-emerald-400">You<');
  });

  it("wires a centre clearance into the layout", () => {
    expect(page).toContain("const centreClearance =");
    expect(page).toContain("minRadius: centreClearance");
  });

  it("raised the orbit rings without making them bright", () => {
    expect(page).toContain('isActive ? "border-white/[0.11]" : "border-white/[0.08]"');
  });

  it("layers the centre glow instead of one flat blob", () => {
    const centre = fieldCss.slice(fieldCss.indexOf(".socialize-centre {"), fieldCss.indexOf(".socialize-centre:not"));
    // Multiple shadow stops plus a radial falloff layer.
    expect((centre.match(/0 0 /g) ?? []).length).toBeGreaterThanOrEqual(3);
    expect(fieldCss).toContain(".socialize-centre::before");
    expect(fieldCss).toContain("radial-gradient(");
  });

  it("never animates the glow", () => {
    const centre = fieldCss.slice(fieldCss.indexOf(".socialize-centre {"), fieldCss.indexOf(".socialize-node"));
    expect(centre).not.toContain("animation");
  });

  it("ranks proximity by size and glow", () => {
    expect(page).toContain("const TIER_SCALE: Record<Tier, number> = { close: 1.1, near: 1, far: 0.9 };");
    expect(page).toContain("TIER_GLOW[tier]");
    const glow = page.slice(page.indexOf("const TIER_GLOW"), page.indexOf("type PlacedPerson") + 1 || page.indexOf("function radarSizeFor"));
    // Close brightest, far faintest.
    expect(glow).toContain("close: \"shadow-[0_0_18px");
    expect(glow).toContain("far: \"shadow-[0_0_8px");
  });

  it("keeps proximity labels below the avatar, never over the photo", () => {
    const node = page.slice(page.indexOf("field.nodes.map("), page.indexOf("The single aggregate entry point"));
    // The label follows the avatar span in flow, with a top margin.
    // The VISIBLE pill (not the aria-label, which mentions the tier earlier)
    // follows the avatar in flow with a top margin — so it sits beneath the
    // photo rather than over it.
    expect(node.indexOf("<UserAvatar")).toBeLessThan(node.indexOf("mt-1.5 whitespace-nowrap"));
    expect(node).toContain("mt-1.5 whitespace-nowrap rounded-full");
    // The label is in normal flow; nothing positions it over the avatar.
    const labelBlock = node.slice(node.indexOf("mt-1.5 whitespace-nowrap"));
    expect(labelBlock).not.toContain("absolute");
  });
});

describe("ambient depth", () => {
  const css = read("app/globals.css");
  const depthCss = stripComments(css.slice(css.indexOf("/* Socialize ambient depth")));

  it("adds faint specks rather than floating objects", () => {
    expect(depthCss).toContain("radial-gradient(1.5px 1.5px");
    // Nothing above ~0.16 alpha anywhere.
    const alphas = [...depthCss.matchAll(/rgba\([^)]+,\s*([\d.]+)\)/g)].map((m) => Number(m[1]));
    expect(alphas.length).toBeGreaterThan(0);
    for (const alpha of alphas) expect(alpha).toBeLessThanOrEqual(0.16);
  });

  it("drifts slowly enough to be barely noticeable", () => {
    expect(depthCss).toContain("socialize-depth-drift 42s");
    const shift = [...depthCss.matchAll(/translate3d\((-?\d+)px, (-?\d+)px/g)];
    for (const [, x, y] of shift) {
      expect(Math.abs(Number(x))).toBeLessThanOrEqual(10);
      expect(Math.abs(Number(y))).toBeLessThanOrEqual(10);
    }
  });

  it("is decorative and never interactive", () => {
    expect(depthCss).toContain("pointer-events: none");
  });

  it("stops entirely under reduced motion", () => {
    const reduced = depthCss.slice(depthCss.indexOf("prefers-reduced-motion"));
    expect(reduced).toContain("animation: none");
  });
});
