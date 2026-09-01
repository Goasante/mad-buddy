import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { stripComments } from "@/lib/content/strip-comments";
import {
  MUDDIES_FILTERS,
  closestMuddies,
  matchesMuddiesFilter,
  railDistanceLabel,
  railToneClass,
  type MuddyProximity
} from "@/lib/friends/muddies-presentation";

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");
const rail = stripComments(read("components/friends/muddies-closest-rail.tsx"));
const grid = stripComments(read("components/friends/muddies-grid.tsx"));
const page = stripComments(read("components/friends/friends-page.tsx"));
const css = read("app/globals.css");

const person = (id: string, displayName: string) => ({ id, displayName });
/** N nearby Muddies with stable, name-sortable labels. */
const many = (count: number) =>
  Array.from({ length: count }, (_, index) =>
    person(`u${index}`, `Muddy ${String(index).padStart(2, "0")}`)
  );
const at = (level: MuddyProximity["proximityLevel"], lastActiveEstimate?: string): MuddyProximity => ({
  proximityLevel: level,
  glowStrength: 50,
  confidence: "high",
  lastActiveEstimate
});
/** Every one of them at the same band, so only the COUNT varies. */
const allClose = (people: ReturnType<typeof many>) =>
  Object.fromEntries(people.map((entry) => [entry.id, at("close")]));

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

  /* THE RAIL IS NOT TRUNCATED.
   *
   * The old `.slice(0, MUDDIES_RAIL_LIMIT)` capped this at eight "before View
   * map takes over" -- a surface that was never built. Once the rail became a
   * horizontal scroller presenting itself as complete, that cap made the UI
   * only LOOK uncapped: a user with twelve nearby Muddies could scroll to the
   * end and never reach the last four. */
  it("returns all eight when eight are nearby", () => {
    const people = many(8);
    expect(closestMuddies(people, allClose(people))).toHaveLength(8);
  });

  it("returns the ninth and beyond rather than dropping them at the old cap", () => {
    const people = many(12);
    const result = closestMuddies(people, allClose(people));
    expect(result).toHaveLength(12);
    // The records that the cap used to discard, by identity not just count.
    expect(result.map((entry) => entry.id)).toContain("u8");
    expect(result.map((entry) => entry.id)).toContain("u11");
  });

  it("stays uncapped at a large count", () => {
    const people = many(100);
    expect(closestMuddies(people, allClose(people))).toHaveLength(100);
  });

  it("still filters and orders exactly as before, past the old cap", () => {
    /* Removing the truncation must not have loosened eligibility or reordered
       anybody: the 9th+ entries obey the same nearest-first, then-by-name rule
       as the first eight, and people with no live signal are still excluded. */
    const people = [
      person("far1", "Zoe"),
      person("close1", "Bea"),
      person("none", "Ghost"),
      person("near1", "Yaw"),
      person("close2", "Ama")
    ];
    const result = closestMuddies(people, {
      far1: at("far"),
      close1: at("close"),
      near1: at("near"),
      close2: at("close")
    });
    expect(result.map((entry) => entry.displayName)).toEqual(["Ama", "Bea", "Yaw", "Zoe"]);
    expect(result.map((entry) => entry.id)).not.toContain("none");
  });

  it("exposes no cap constant for a caller to reintroduce", () => {
    /* Comments may still explain the removal; what must be gone is the export
       and the truncation themselves. */
    const source = stripComments(read("lib/friends/muddies-presentation.ts"));
    expect(source).not.toContain("MUDDIES_RAIL_LIMIT");
    expect(source).not.toContain(".slice(");
    expect(source).not.toContain("limit");
  });

  it("is called with no limit argument by the page", () => {
    expect(page).toContain("closestMuddies(friendUsers, proximityByFriendId)");
  });
});

describe("distance wording matches the glow it sits under", () => {
  it("uses the six approved Glow state names when a band is present", () => {
    // The rail says exactly what the Glow means -- both read the same band
    // table -- rather than inventing a second scale beside it.
    expect(railDistanceLabel({ ...at("close"), proximityBand: "right_here" })).toBe("Right Here");
    expect(railDistanceLabel({ ...at("close"), proximityBand: "around_you" })).toBe("Just Around");
    expect(railDistanceLabel({ ...at("near"), proximityBand: "close_by" })).toBe("Close By");
    expect(railDistanceLabel({ ...at("near"), proximityBand: "nearby" })).toBe("In Your Area");
    expect(railDistanceLabel({ ...at("far"), proximityBand: "around_town" })).toBe("Around Town");
    expect(railDistanceLabel({ ...at("far"), proximityBand: "further_away" })).toBe("Across Town");
  });

  it("falls back to the widest state a bare level can honestly claim", () => {
    // Without a band there is no evidence for a tight state, so the fallback
    // widens rather than guessing -- it can never overstate closeness.
    expect(railDistanceLabel(at("close"))).toBe("Just Around");
    expect(railDistanceLabel(at("near"))).toBe("In Your Area");
    expect(railDistanceLabel(at("far"))).toBe("Across Town");
  });

  it("never renders a distance", () => {
    for (const band of ["right_here", "around_you", "close_by", "nearby", "around_town", "further_away"] as const) {
      const label = railDistanceLabel({ ...at("close"), proximityBand: band });
      expect(label).not.toMatch(/\d/);
      expect(label).not.toMatch(/\b(m|km|metres|meters|miles|min)\b/i);
    }
  });

  it("gives each band its own tone class", () => {
    expect(railToneClass("close")).toBe("muddies-rail-tone-close");
    expect(railToneClass("near")).toBe("muddies-rail-tone-near");
    expect(railToneClass("far")).toBe("muddies-rail-tone-far");
  });

  it("defines every tone it can return", () => {
    // Matched as a selector rather than as `.class {`: the three toned-down
    // bands now share one rule. They deliberately carry no colour of their
    // own -- they used to be violet, which is off-brand for proximity -- so
    // they resolve to muted-foreground together.
    for (const level of ["close", "near", "far", "hidden"] as const) {
      expect(css, level).toMatch(new RegExp(`\\.${railToneClass(level)}[\\s,{]`));
    }
  });

  it("gives the proximity rail no purple tone", () => {
    // Brand rule: proximity is the warm orange/maroon system.
    const block = css.slice(css.indexOf(".muddies-rail-tone-close"), css.indexOf("/* --- Filter chips"));
    const declarations = block
      .split(/\r?\n/)
      .filter((line) => !line.trim().startsWith("*") && !line.trim().startsWith("/*"))
      .join(" ");
    for (const purple of ["#a78bfa", "#8b7bd8", "#8b5cf6"]) {
      expect(declarations, purple).not.toContain(purple);
    }
  });
});

// ---------------------------------------------------------------------------
// Presence
// ---------------------------------------------------------------------------

describe("Muddies never derives presence from proximity", () => {
  const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

  it("exports no presence helper at all", async () => {
    // `presenceLabel` returned the literal string "Online" whenever
    // proximityLevel was "close", and `isOnline` drove a green live dot. Both
    // turned a LOCATION reading into an availability claim the product has no
    // authority to make. They are gone, not renamed.
    const presentation = await import("@/lib/friends/muddies-presentation");
    expect(presentation).not.toHaveProperty("presenceLabel");
    expect(presentation).not.toHaveProperty("isOnline");
  });

  it("renders no online dot or presence copy on any Muddies surface", () => {
    for (const path of [
      "components/friends/muddies-grid.tsx",
      "components/friends/muddies-closest-rail.tsx",
      "components/friends/friends-page.tsx"
    ]) {
      const source = read(path);
      expect(source, path).not.toContain("presenceLabel");
      expect(source, path).not.toContain("isOnline");
      expect(source, path).not.toContain("bg-emerald-500");
      expect(source, path).not.toMatch(/["'>]Online["'<]/);
    }
  });

  it("keeps proximity freshness out of the Muddies presentation layer", () => {
    // freshness_state describes how recent a location FIX is -- a statement
    // about the measurement, not about whether someone is at their phone.
    const source = read("lib/friends/muddies-presentation.ts");
    expect(source).not.toContain("freshness");
    expect(source).not.toContain("lastActiveEstimate ? ");
  });
});

// ---------------------------------------------------------------------------
// Filters
// ---------------------------------------------------------------------------

describe("every filter answers from data the page already holds", () => {
  it("keeps everyone under All", () => {
    expect(matchesMuddiesFilter("all", undefined)).toBe(true);
  });

  it("keeps every band with a live signal under Nearby", () => {
    // Nearby means "showing a proximity signal", not "close". Someone across
    // town is still telling you roughly where they are, and a second hidden
    // threshold would make the chip lie about what it filters.
    for (const band of ["right_here", "around_you", "close_by", "nearby", "around_town", "further_away"] as const) {
      expect(matchesMuddiesFilter("nearby", { ...at("close"), proximityBand: band }), band).toBe(true);
    }
  });

  it("excludes anyone outside range from Nearby", () => {
    expect(
      matchesMuddiesFilter("nearby", { ...at("close"), proximityBand: "outside_range" })
    ).toBe(false);
  });

  it("excludes anyone with no signal from a distance filter", () => {
    expect(matchesMuddiesFilter("nearby", undefined)).toBe(false);
  });

  it("offers distance filters only, in the canonical vocabulary", () => {
    // Nothing on the page knows when a Muddy joined, so a "New Here" chip
    // could only ever have matched nobody or everybody.
    expect(MUDDIES_FILTERS.map((filter) => filter.id)).toEqual(["all", "nearby"]);
  });

  it("never labels a chip with a canonical band name", () => {
    // "Very Close" and "Nearby" both now mean specific, different things in the
    // approved six-state language. A chip wearing a state's name would read as
    // a state filter that it is not.
    const RESERVED = ["Right Here", "Just Around", "Close By", "In Your Area", "Around Town", "Across Town"];
    for (const filter of MUDDIES_FILTERS) {
      expect(RESERVED, filter.label).not.toContain(filter.label);
    }
  });
});

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

describe("the rail reuses the product's glow rather than a new treatment", () => {
  it("renders the canonical ProximityGlowAvatar", () => {
    expect(rail).toContain("<ProximityGlowAvatar");
    expect(rail).toContain("band={proximity?.proximityBand ?? null}");
  });

  it("needs no intensity boost, because the Glow already reads at a glance", () => {
    // The old halo needed intensity={1.35} on this rail to stop reading as a
    // hairline. The ported Glow carries its own luminosity, so the boost is
    // gone -- and must not come back, since a surface that amplifies one scale
    // makes this rail disagree with Home about what a state looks like.
    expect(rail).not.toContain("intensity=");
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

  it("lets the Glow contain its own bloom instead of scoping overrides here", () => {
    // The old rail retuned --halo-blur/--halo-spread per state because the halo
    // painted outside its own box. ProximityGlow sizes its element to its
    // widest layer, so those overrides are gone -- and a new one would be a
    // second state authority, which is the thing this redesign removed.
    expect(css).not.toContain(".muddies-rail-glow .proximity-halo");
    expect(css).not.toContain(".muddies-rail-glow .proximity-glow-");
  });

  it("reserves the bloom's room in the component, not per surface", () => {
    const glow = read("components/glow/proximity-glow.tsx");
    // The element occupies the AVATAR's footprint and lets the bloom overflow.
    // Sizing it to the bloom (~2.2x the avatar) is what broke the real Near
    // strip: it pushed neighbours apart, collided with the name beneath, and
    // was sliced flat by the scroll container. Overflow costs no layout space.
    expect(glow).toContain("width: `${geometry.avatar}px`");
    expect(glow).toContain("height: `${geometry.avatar}px`");
    expect(glow).toContain("overflow");
    // The full extent stays available for surfaces that opt in.
    expect(glow).toContain('"--glow-box": `${geometry.box}px`');
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

  it("does not adopt Home's four-up width, which would merge the lg auras", () => {
    /* Home shows four positions per mobile viewport at `md` (a 118.46px glow
     * field). This rail renders `lg` (160.78px), and a quarter of a 390px
     * viewport is 5.4rem -- under the 7rem the rule above exists to protect,
     * so adjacent auras would run together into one smeared glow. Preserving
     * the canonical Glow outranks matching a column count. */
    const mobile = css.slice(css.indexOf("@media (max-width: 767px)", css.indexOf(".muddies-rail-item {")));
    // Up to the next top-level rule, which is the end of this media block.
    const scope = mobile.slice(0, mobile.indexOf("\n.", 1));
    expect(scope).not.toContain(".muddies-rail-button");
  });
});

describe("the closest rail speaks Home's rail language", () => {
  it("is horizontal and never grows downward", () => {
    const track = css.slice(css.indexOf(".muddies-rail-track {"));
    const block = track.slice(0, track.indexOf("}"));
    expect(block).toContain("display: flex");
    expect(block).toContain("overflow-x: auto");
    expect(block).not.toContain("flex-wrap");
    expect(block).not.toContain("flex-direction: column");
  });

  it("renders everyone it is given, with no visible cap and no +N tile", () => {
    /* End to end now: the selector no longer truncates (see the uncapped tests
       above) and the component does not trim what it receives either, so the
       list the user can scroll IS the eligible nearby set. No position is spent
       on a tile that stands in for the people it replaced. */
    const railSource = readFileSync("components/friends/muddies-closest-rail.tsx", "utf8");
    expect(railSource).toContain("people.map((person)");
    expect(railSource).not.toContain(".slice(");
    expect(railSource).not.toContain("+{");
  });

  it("keeps the row one avatar tall however many people arrive", () => {
    /* The point of lifting the cap is more SCROLL, never more rows. */
    const track = css.slice(css.indexOf(".muddies-rail-track {"));
    const block = track.slice(0, track.indexOf("}"));
    expect(block).not.toContain("flex-wrap");
    expect(block).toContain("overflow-x: auto");
    const item = css.slice(css.indexOf(".muddies-rail-item {"));
    expect(item.slice(0, item.indexOf("}"))).toContain("flex: 0 0 auto");
  });

  it("centres a single person instead of pinning them to the left edge", () => {
    /* One Muddy in a mostly empty row reads as a list that failed to load.
       `:only-child` is the count test -- nothing for the component to pass. */
    const mobile = css.slice(css.indexOf("@media (max-width: 767px)", css.indexOf(".muddies-rail-item {")));
    expect(mobile.slice(0, mobile.indexOf("\n.", 1))).toContain(".muddies-rail-item:only-child");
    const only = mobile.slice(mobile.indexOf(".muddies-rail-item:only-child"));
    expect(only.slice(0, only.indexOf("}"))).toContain("margin-inline: auto");
  });

  it("starts two or more from the left rather than centring the group", () => {
    /* Equal-width items in a flex-start row do this on their own: two land in
       the first two positions, three spread across the width. There must be no
       justify-content that would centre the whole group instead. */
    const track = css.slice(css.indexOf(".muddies-rail-track {"));
    expect(track.slice(0, track.indexOf("}"))).not.toContain("justify-content: center");
  });

  it("keeps the horizontal-swipe exemption so a drag scrolls rather than changing tab", () => {
    const railSource = readFileSync("components/friends/muddies-closest-rail.tsx", "utf8");
    expect(railSource).toContain("SWIPE_OPT_OUT_ATTRIBUTE");
  });

  it("hands the rail exactly the count it should render, 1 through 9+", () => {
    /* The CSS above decides how each count is laid out (1 centred via
       :only-child, 2/3 left-aligned by flex-start, 4+ scrolling). This proves
       the selector actually delivers those counts -- including past the old
       cap, where the layout rules were previously unreachable. */
    for (const count of [1, 2, 3, 4, 8, 9, 20]) {
      const people = many(count);
      expect(closestMuddies(people, allClose(people))).toHaveLength(count);
    }
  });

  it("changes nothing about the Glow the rail renders", () => {
    /* Lifting a data cap must not touch the identity signal: same canonical
       component, same lg size, same band/colour/reduced-motion inputs. */
    const railSource = readFileSync("components/friends/muddies-closest-rail.tsx", "utf8");
    expect(railSource).toContain("<ProximityGlowAvatar");
    expect(railSource).toContain('size="lg"');
    expect(railSource).toContain("band={proximity?.proximityBand ?? null}");
    expect(railSource).toContain("glowColorId={glowColorByFriendId?.[person.id] ?? null}");
    expect(railSource).toContain("reducedMotion={reducedMotion}");
    // No per-count or per-index intensity fiddling introduced by this change.
    expect(railSource).not.toContain("intensity={");
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

describe("a rail card announces itself once", () => {
  const card = rail.slice(rail.indexOf("muddies-rail-button"));
  const subtree = card.slice(0, card.indexOf("</button>"));

  it("carries one composed label for the whole card", () => {
    // Previously the avatar labelled itself AND the visible text was read, so
    // a screen reader heard "Ama, close. Ama. Very close." -- the name twice,
    // the distance twice, in two different vocabularies.
    expect(subtree).toContain("aria-label={[");
    expect(subtree).toContain("person.displayName");
  });

  it("hides the glow wrapper rather than the avatar component", () => {
    // GlowAvatar has a closed prop type and no spread, so aria-hidden passed
    // to it is silently dropped -- and its GlowRing sets role="img" with its
    // own label. The attribute has to land on a real DOM node.
    expect(subtree).toMatch(/muddies-rail-glow[^>]*aria-hidden="true"/);
  });

  it("marks the visible text decorative, since the label repeats it", () => {
    expect(subtree).toMatch(/muddies-rail-name"\s+aria-hidden="true"/);
    expect(subtree).toMatch(/muddies-rail-distance[^>]*aria-hidden="true"/);
  });

  it("uses one vocabulary, the canonical band names", () => {
    // The announcement and the visible label must come from the same resolver,
    // or a screen reader hears a different state than the eye sees.
    expect(subtree).toContain("railDistanceLabel(proximity).toLowerCase()");
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
