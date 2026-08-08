import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { stripComments } from "@/lib/content/strip-comments";
import {
  MUDDIES_FILTERS,
  MUDDIES_RAIL_LIMIT,
  closestMuddies,
  isOnline,
  matchesMuddiesFilter,
  presenceLabel,
  proximityRailLabels,
  railToneClass,
  type MuddyProximity
} from "@/lib/friends/muddies-presentation";

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");
const rail = stripComments(read("components/friends/muddies-closest-rail.tsx"));
const grid = stripComments(read("components/friends/muddies-grid.tsx"));
const page = stripComments(read("components/friends/friends-page.tsx"));
const css = read("app/globals.css");

const person = (id: string, displayName: string) => ({ id, displayName });
const at = (level: MuddyProximity["proximityLevel"], lastActiveEstimate?: string): MuddyProximity => ({
  proximityLevel: level,
  glowStrength: 50,
  confidence: "high",
  lastActiveEstimate
});

// ---------------------------------------------------------------------------
// The closest rail
// ---------------------------------------------------------------------------

describe("the closest rail orders by distance", () => {
  it("puts the nearest first, then breaks ties by name", () => {
    const people = [person("c", "Kojo"), person("a", "Ama"), person("b", "Abena")];
    const result = closestMuddies(people, {
      a: at("near"),
      b: at("close"),
      c: at("close")
    });

    expect(result.map((entry) => entry.displayName)).toEqual(["Abena", "Kojo", "Ama"]);
  });

  it("leaves out anyone with no live signal", () => {
    // An empty ring under a heading called "Who is closest to you" would imply
    // a distance nobody actually reported.
    const result = closestMuddies([person("a", "Ama"), person("b", "Kobby")], { a: at("close") });
    expect(result.map((entry) => entry.id)).toEqual(["a"]);
  });

  it("leaves out hidden people entirely", () => {
    const result = closestMuddies([person("a", "Ama")], { a: at("hidden") });
    expect(result).toEqual([]);
  });

  it("caps the rail rather than rendering an unbounded row", () => {
    const many = Array.from({ length: 20 }, (_, index) =>
      person(`u${index}`, `Muddy ${String(index).padStart(2, "0")}`)
    );
    const proximity = Object.fromEntries(many.map((entry) => [entry.id, at("close")]));
    expect(closestMuddies(many, proximity)).toHaveLength(MUDDIES_RAIL_LIMIT);
  });
});

describe("distance wording matches the glow it sits under", () => {
  it("uses the vocabulary the halo classes already encode", () => {
    // getGlowClass returns proximity-halo-very-close / -nearby / -around, so
    // the rail says what the ring means instead of inventing a second scale.
    expect(proximityRailLabels.close).toBe("Very close");
    expect(proximityRailLabels.near).toBe("Nearby");
    expect(proximityRailLabels.far).toBe("Around you");
  });

  it("gives each band its own tone class", () => {
    expect(railToneClass("close")).toBe("muddies-rail-tone-close");
    expect(railToneClass("near")).toBe("muddies-rail-tone-near");
    expect(railToneClass("far")).toBe("muddies-rail-tone-far");
  });

  it("defines every tone it can return", () => {
    for (const level of ["close", "near", "far", "hidden"] as const) {
      expect(css).toContain(`.${railToneClass(level)} {`);
    }
  });
});

// ---------------------------------------------------------------------------
// Presence
// ---------------------------------------------------------------------------

describe("presence repeats the server's estimate and never invents one", () => {
  it("shows the API's coarse string as-is", () => {
    expect(presenceLabel(at("close", "Active recently"))).toBe("Active recently");
    expect(presenceLabel(at("far", "Last seen a while ago"))).toBe("Last seen a while ago");
  });

  it("says nothing when there is no signal at all", () => {
    expect(presenceLabel(undefined)).toBeNull();
    expect(presenceLabel(at("near"))).toBeNull();
  });

  it("treats only a live estimate as online", () => {
    expect(isOnline(at("close", "Active recently"))).toBe(true);
    // Close by distance is not the same as online: someone can be nearby and
    // not have opened the app for an hour.
    expect(isOnline(at("close", "Last seen a while ago"))).toBe(false);
    expect(isOnline(undefined)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Filters
// ---------------------------------------------------------------------------

describe("every filter answers from data the page already holds", () => {
  it("keeps everyone under All", () => {
    expect(matchesMuddiesFilter("all", undefined)).toBe(true);
  });

  it("separates the two distance bands", () => {
    expect(matchesMuddiesFilter("very_close", at("close"))).toBe(true);
    expect(matchesMuddiesFilter("very_close", at("near"))).toBe(false);
    expect(matchesMuddiesFilter("nearby", at("near"))).toBe(true);
    expect(matchesMuddiesFilter("nearby", at("close"))).toBe(false);
  });

  it("excludes anyone with no signal from a distance filter", () => {
    expect(matchesMuddiesFilter("very_close", undefined)).toBe(false);
    expect(matchesMuddiesFilter("nearby", undefined)).toBe(false);
  });

  it("offers distance filters only", () => {
    // Nothing on the page knows when a Muddy joined, so a "New Here" chip
    // could only ever have matched nobody or everybody.
    expect(MUDDIES_FILTERS.map((filter) => filter.id)).toEqual(["all", "very_close", "nearby"]);
  });
});

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

describe("the rail reuses the product's glow rather than a new treatment", () => {
  it("renders the canonical GlowAvatar", () => {
    expect(rail).toContain("<GlowAvatar");
    expect(rail).toContain("proximityLevel={level}");
  });

  it("raises intensity instead of redefining the halo", () => {
    // intensity is a presentation-only multiplier on the existing aura, so the
    // distance ordering close > near > far still holds at any strength.
    expect(rail).toContain("intensity={1.35}");
  });

  it("passes reduced motion through, so the aura can stop breathing", () => {
    expect(rail).toContain("reducedMotion={reducedMotion}");
  });

  it("keeps custom glow colours working", () => {
    expect(rail).toContain("glowColorId={glowColorByFriendId?.[person.id] ?? null}");
  });

  it("does not let a sideways drag change tab", () => {
    expect(rail).toContain("SWIPE_OPT_OUT_ATTRIBUTE");
  });
});

describe("the aura is never clipped into a rectangle", () => {
  const track = css.slice(css.indexOf(".muddies-rail-track {"));
  const block = track.slice(0, track.indexOf("}"));

  it("reserves vertical room inside the element that scrolls", () => {
    // `overflow-x: auto` clips on BOTH axes, so the bloom has to fit inside
    // this element's padding box or it is cropped to a hard edge. This was the
    // actual bug: 0.35rem of padding against a glow reaching far further.
    expect(block).toContain("overflow-x: auto");
    const padding = /padding:\s*([\d.]+)rem/.exec(block);
    expect(padding).not.toBeNull();
    expect(Number(padding?.[1])).toBeGreaterThanOrEqual(1.5);
  });

  it("tightens blur and spread rather than paying for the default bloom", () => {
    // The default very-close halo reaches roughly 48px past the avatar, which
    // would need so much padding that neighbouring auras would overlap.
    expect(css).toContain(".muddies-rail-glow .proximity-halo-very-close");
    const scoped = css.slice(css.indexOf(".muddies-rail-glow .proximity-halo-very-close"));
    const blur = /--halo-blur:\s*(\d+)px/.exec(scoped);
    expect(Number(blur?.[1])).toBeLessThan(26);
  });

  it("tightens geometry only, so the raised intensity survives", () => {
    // Opacity comes from GlowRing's inline `intensity`; inline custom
    // properties beat stylesheet rules, so a CSS opacity override here would
    // be silently ignored anyway.
    const scoped = css.slice(
      css.indexOf(".muddies-rail-glow .proximity-halo-very-close"),
      css.indexOf(".muddies-rail-name")
    );
    expect(scoped).not.toContain("--halo-active-opacity");
    expect(rail).toContain("intensity={1.35}");
  });

  it("reserves that room on the inline edges too, not just top and bottom", () => {
    // A scroll container clips on every side. Padding only the block axis left
    // the FIRST card's glow sliced flat against the left edge.
    // Reads the WHOLE declaration, so a two-value `1.75rem 1rem` is seen as
    // the asymmetric shorthand it is rather than matching on its first value.
    const declaration = /padding:\s*([^;]+);/.exec(block);
    expect(declaration).not.toBeNull();
    const values = (declaration?.[1] ?? "").trim().split(/\s+/).map((value) => Number.parseFloat(value));
    const inline = values.length === 1 ? values[0] : values[1];
    expect(inline, "inline padding must also clear the bloom").toBeGreaterThanOrEqual(1.5);
  });

  it("never pulls wider than the page gutter", () => {
    // <main> is px-4 (1rem). A negative margin deeper than its gutter makes the
    // rail overhang the viewport, and the whole PAGE scrolls sideways.
    const inline = /margin-inline:\s*-([\d.]+)rem/.exec(block);
    expect(inline).not.toBeNull();
    expect(Number(inline?.[1])).toBeLessThanOrEqual(1);
  });

  it("keeps the inline padding at every breakpoint", () => {
    // The >=640px rule used to zero padding-inline outright, which put the
    // first card's aura straight back against the clipping edge.
    const wide = css.slice(css.indexOf("@media (min-width: 640px)"));
    const rule = wide.slice(wide.indexOf(".muddies-rail-track"));
    expect(rule.slice(0, rule.indexOf("}"))).not.toContain("padding-inline: 0");
  });

  it("gives each person enough width that auras do not merge", () => {
    const button = css.slice(css.indexOf(".muddies-rail-button {"));
    const width = /width:\s*([\d.]+)rem/.exec(button.slice(0, button.indexOf("}")));
    // The avatar alone is 4.75rem; the rest is room for the glow.
    expect(Number(width?.[1])).toBeGreaterThanOrEqual(7);
  });
});

describe("the pill row keeps its labels readable", () => {
  const row = css.slice(css.indexOf(".muddies-pills-row {"));
  const block = row.slice(0, row.indexOf("}"));

  it("never truncates a label to fit the row", () => {
    // Squeezing every pill onto one visible line turned the labels into
    // "Circle", "Reques", "Blocke" — a control you cannot read is worse than
    // one you have to swipe to.
    const pill = css.slice(css.indexOf(".muddies-pills-row .muddies-filter {"));
    const pillBlock = pill.slice(0, pill.indexOf("}"));
    expect(pillBlock).toContain("flex: 0 0 auto");
    expect(pillBlock).toContain("white-space: nowrap");
    expect(pillBlock).not.toContain("text-overflow: ellipsis");
  });

  it("scrolls instead, so no pill is unreachable", () => {
    const strip = css.slice(css.indexOf(".muddies-pills {"));
    expect(strip.slice(0, strip.indexOf("}"))).toContain("overflow-x: auto");
    expect(block).toContain("width: max-content");
  });

  it("keeps tabs and filters semantically distinct", () => {
    // They share a look, so the difference has to live in the markup: a tab
    // swaps the panel below, a filter narrows the grid already shown.
    expect(page).toContain('role="tab"');
    expect(page).toContain("aria-pressed={muddiesFilter === filter.id}");
  });

  it("shows the filters only on the tab they act on", () => {
    const filters = page.slice(page.indexOf("MUDDIES_FILTERS.filter"));
    expect(page.slice(0, page.indexOf("MUDDIES_FILTERS.filter"))).toContain('activeTab === "all"');
    expect(filters).toContain("filter.id !== \"all\"");
  });

  it("clears the filter when leaving the tab", () => {
    // Carrying one back would silently narrow the grid with the reason gone.
    const select = page.slice(page.indexOf("const selectTab"));
    expect(select.slice(0, 800)).toContain('setMuddiesFilter("all")');
  });
});

describe("the card carries identity and one action", () => {
  it("keeps premium and Trusted as separate marks", () => {
    expect(grid).toContain("<PremiumPlanBadge");
    expect(grid).toContain("<TrustedMemberMark");
  });

  it("offers Message on the card rather than two taps away", () => {
    expect(grid).toContain("onMessage(person.id)");
  });
});

describe("the landing layout is scoped to the All tab", () => {
  it("renders the rail only there", () => {
    // Close Friends and a single Circle are deliberate subsets; a rail called
    // "Who is closest to you" above a filtered subset answers a question
    // nobody asked.
    const layout = page.slice(page.indexOf('{activeTab === "all" ? ('));
    expect(layout).toContain("<MuddiesClosestRail");
    const subsets = page.slice(page.indexOf('{activeTab === "close" ||'));
    expect(subsets).not.toContain("<MuddiesClosestRail");
  });

  it("narrows by chip and query together rather than one discarding the other", () => {
    expect(page).toContain("visibleFriendUsers.filter((user) =>");
    expect(page).toContain("matchesMuddiesFilter(muddiesFilter, proximityByFriendId[user.id])");
  });

  it("reuses the existing request actions rather than new ones", () => {
    const layout = page.slice(page.indexOf('{activeTab === "all" ? ('));
    expect(layout).toContain("acceptFriendRequestAction");
    expect(layout).toContain('updateFriendRequestStatusAction(person.requestId ?? person.id, "declined")');
  });
});

// ---------------------------------------------------------------------------
// The landing destination
// ---------------------------------------------------------------------------

describe("Muddies is where a signed-in Muddy lands", () => {
  it("declares the destination once", () => {
    const routes = stripComments(read("lib/routes.ts"));
    expect(routes).toContain("export const POST_LOGIN_ROUTE = routes.friends;");
  });

  it("routes every post-login entry point through that constant", () => {
    for (const path of [
      "lib/auth/oauth-redirect.ts",
      "lib/security/route-protection.ts",
      "components/auth/session-boundary.tsx",
      "components/auth/login-form.tsx",
      "app/(onboarding)/onboarding/page.tsx"
    ]) {
      const source = stripComments(read(path));
      expect(source, `${path} should use POST_LOGIN_ROUTE`).toContain("POST_LOGIN_ROUTE");
      expect(source, `${path} should not hardcode the landing page`).not.toContain('"/dashboard"');
    }
  });
});
