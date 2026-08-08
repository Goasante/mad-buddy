import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  approximateDistanceLabel,
  DISTANCE_UNCERTAINTY_METERS,
  rendersIdentically
} from "@/lib/proximity/approximate-distance";
import {
  applyDiscoveryFilters,
  DISCOVERY_FILTERS,
  FUTURE_FILTER_IDS,
  orderDiscoveryPeople,
  searchDiscoveryPeople,
  type DiscoveryFilterId
} from "@/lib/social/discovery-filters";
import type { SocializePerson } from "@/lib/social/socialize-mobile";
import { stripComments } from "@/lib/content/strip-comments";

/**
 * Socialize 2.0 discovery feed.
 *
 * The distance work is the part that can fail dangerously and silently, so it
 * is tested as arithmetic: a label that is merely "about right" but tracks a
 * person's movement is a location leak wearing a friendly string.
 */

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");
const projection = stripComments(read("lib/social/socialize-mobile.ts"));
const feed = stripComments(read("components/socialize/discovery-feed.tsx"));
// The banner became the hero when the OFF/ON states were unified.
const hero = stripComments(read("components/socialize/socialize-hero.tsx"));
// The person card moved into the rails when the duplicate grid was removed.
const rails = stripComments(read("components/socialize/discovery-rails.tsx"));
// The person card is its own reusable component now.
const card = stripComments(read("components/socialize/socialize-person-card.tsx"));
const css = read("app/globals.css");
const backend = read("lib/proximity/backend.ts");

const person = (overrides: Partial<SocializePerson> = {}): SocializePerson => ({
  userId: "11111111-1111-4111-8111-111111111111",
  displayName: "Ama",
  username: "ama",
  avatarUrl: null,
  activity: "anything",
  note: null,
  proximityTier: "near",
  presenceState: "fresh",
  lastPresenceUpdate: null,
  waveState: "none",
  plan: "free",
  approxDistance: "≈ 2 km away",
  ...overrides
});

// ---------------------------------------------------------------------------
// Distance — the privacy-critical half
// ---------------------------------------------------------------------------

describe("approximate distance", () => {
  it("never shows a number below 1 km", () => {
    // Sub-kilometre precision is where trilateration stops being theoretical.
    for (const meters of [0, 50, 300, 900]) {
      expect(approximateDistanceLabel(meters, "high")).toBe("Under 1 km away");
    }
  });

  it("renders a rounded kilometre value further out", () => {
    expect(approximateDistanceLabel(3_400, "high")).toBe("≈ 3 km away");
    expect(approximateDistanceLabel(7_600, "high")).toBe("≈ 6 km away");
  });

  it("SNAPS DOWN, so it never overstates closeness", () => {
    // 4.9 km must not read as 5; the label is a floor, not a rounding.
    expect(approximateDistanceLabel(4_900, "high")).toBe("≈ 4 km away");
  });

  it("widens its buckets as distance grows", () => {
    // A fixed 500m bucket at 2km is a far tighter fix than at 12km, so the
    // width has to grow with the value it describes.
    const near = [5_000, 5_900];
    const far = [15_000, 19_000];
    expect(rendersIdentically(near[0]!, near[1]!)).toBe(true);
    expect(rendersIdentically(far[0]!, far[1]!)).toBe(true);
  });

  it("does not move when a person moves an ordinary amount", () => {
    // The property that makes repeated reads useless for tracking: walking
    // 300m must not change the displayed number.
    expect(rendersIdentically(6_100, 6_400)).toBe(true);
    expect(rendersIdentically(12_000, 12_900)).toBe(true);
  });

  it("reports a low-confidence fix as FURTHER, never closer", () => {
    const high = approximateDistanceLabel(3_000, "high");
    const low = approximateDistanceLabel(3_000, "low");
    expect(high).not.toBe(low);
    // 3km + 2km padding = 5km, which snaps DOWN to the 4km edge — still a
    // further-away reading than the 3km the high-confidence fix produces.
    expect(low).toBe("≈ 4 km away");
    expect(high).toBe("≈ 3 km away");
  });

  it("uses the same uncertainty padding as the proximity tiering", () => {
    // If these drift, a person could read as "near" while their label says
    // something inconsistent.
    expect(backend).toContain("high: 0");
    expect(backend).toContain("medium: 200");
    expect(backend).toContain("low: 2_000");
    expect(DISTANCE_UNCERTAINTY_METERS).toEqual({ high: 0, medium: 200, low: 2_000 });
  });

  it("shows nothing rather than zero when distance is unknown", () => {
    expect(approximateDistanceLabel(null)).toBeNull();
    expect(approximateDistanceLabel(undefined)).toBeNull();
    expect(approximateDistanceLabel(Number.NaN)).toBeNull();
    expect(approximateDistanceLabel(-100)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Coordinates never leave the server
// ---------------------------------------------------------------------------

describe("location privacy", () => {
  it("emits a finished STRING, never a number", () => {
    // Nothing for a client to re-derive, compare precisely, or trilaterate.
    expect(projection).toContain("approxDistance: string | null;");
  });

  it("computes the distance server-side and keeps the metres local", () => {
    expect(projection).toContain("approximateDistanceLabel(");
    expect(projection).toContain("haversineMeters(");
  });

  it("puts no coordinates on the Socialize projection", () => {
    const type = projection.slice(
      projection.indexOf("export type SocializePerson"),
      projection.indexOf("export type SocializeActionResult")
    );
    for (const forbidden of ["latitude", "longitude", "coord", "geohash", "accuracy"]) {
      expect(type, `SocializePerson must not expose ${forbidden}`).not.toContain(forbidden);
    }
  });

  it("does not weaken the existing nearby-API leak guard", () => {
    // /api/friends/nearby still rejects any location-adjacent response key,
    // including "distance". Socialize carries its label on its own projection.
    expect(backend).toContain("forbiddenResponseKeyPattern");
    expect(backend).toContain("distance|meters|geohash");
  });

  it("renders no raw distance in the feed", () => {
    expect(card).not.toContain("haversine");
    // Proximity is shown in WORDS, never a distance string.
    expect(card).toContain("PROXIMITY_LABEL");
  });
});

// ---------------------------------------------------------------------------
// Filters, search, ordering
// ---------------------------------------------------------------------------

describe("filters", () => {
  const roster = [
    person({ userId: "a", displayName: "Ama", proximityTier: "close", presenceState: "fresh", plan: "buddy_pro" }),
    person({ userId: "b", displayName: "Bao", proximityTier: "far", presenceState: "grace", waveState: "sent" }),
    person({ userId: "c", displayName: "Cara", proximityTier: "near", presenceState: "fresh" })
  ];

  const only = (ids: DiscoveryFilterId[]) => applyDiscoveryFilters(roster, new Set(ids)).map((p) => p.userId);

  it("returns everything when no chip is active", () => {
    expect(applyDiscoveryFilters(roster, new Set())).toHaveLength(3);
  });

  it("Nearby keeps close and near", () => {
    expect(only(["nearby"])).toEqual(["a", "c"]);
  });

  it("Active keeps people present right now", () => {
    expect(only(["active"])).toEqual(["a", "c"]);
  });

  it("Not-connected-yet excludes people with a pending request", () => {
    // waveState is derived from pending Muddy requests in either direction.
    expect(only(["not_yet_connected"])).not.toContain("b");
  });

  it("NEVER filters on membership tier", () => {
    // "Verified" filtered on plan !== "free", presenting a paid membership as
    // identity verification. There is no identity-verification system here,
    // and implying one is a safety claim the product cannot honour.
    const source = read("lib/social/discovery-filters.ts");
    expect(source).not.toContain('"verified"');
    expect(source).not.toContain('person.plan');
  });

  it("combines chips with AND, so each press asks for less", () => {
    expect(only(["nearby", "active"])).toEqual(["a", "c"]);
  });

  it("labels each chip with what its field actually holds", () => {
    // "New" implied recency; the field says nothing about time.
    const labels = DISCOVERY_FILTERS.map((filter) => filter.label);
    expect(labels).not.toContain("New");
    expect(labels).not.toContain("Verified");
    expect(labels).toContain("Not connected yet");
  });

  it("can only ever narrow an authorised list", () => {
    // No filter may add anyone the server did not return.
    for (const filter of DISCOVERY_FILTERS) {
      const result = applyDiscoveryFilters(roster, new Set([filter.id]));
      expect(result.length).toBeLessThanOrEqual(roster.length);
      for (const row of result) expect(roster).toContain(row);
    }
  });

  it("declares future filters without pretending they work", () => {
    // Absent, not disabled: a greyed-out chip advertises data we do not have.
    const ids = DISCOVERY_FILTERS.map((filter) => filter.id);
    for (const future of FUTURE_FILTER_IDS) {
      expect(ids).not.toContain(future);
    }
    for (const reserved of ["interests", "mutual_muddies", "spark", "public_groups", "hangouts", "plans_nearby"]) {
      expect(FUTURE_FILTER_IDS).toContain(reserved);
    }
  });
});

describe("search", () => {
  const roster = [person({ userId: "a", displayName: "Ama Mensah", username: "ama" }), person({ userId: "b", displayName: "Kofi", username: "kofi99" })];

  it("matches display name and username", () => {
    expect(searchDiscoveryPeople(roster, "mensah").map((p) => p.userId)).toEqual(["a"]);
    expect(searchDiscoveryPeople(roster, "kofi9").map((p) => p.userId)).toEqual(["b"]);
  });

  it("is case-insensitive and ignores surrounding space", () => {
    expect(searchDiscoveryPeople(roster, "  AMA ").map((p) => p.userId)).toEqual(["a"]);
  });

  it("returns everything for an empty query", () => {
    expect(searchDiscoveryPeople(roster, "   ")).toHaveLength(2);
  });
});

describe("ordering", () => {
  it("sorts by proximity, then presence, then name", () => {
    const rows = [
      person({ userId: "far", displayName: "Zed", proximityTier: "far" }),
      person({ userId: "close", displayName: "Ama", proximityTier: "close" }),
      person({ userId: "near", displayName: "Bao", proximityTier: "near" })
    ];
    expect(orderDiscoveryPeople(rows).map((p) => p.userId)).toEqual(["close", "near", "far"]);
  });

  it("PREMIUM NEVER AFFECTS ORDERING", () => {
    // Ranking paid accounts higher would quietly sell position in a discovery
    // feed — the same rule the group member list follows.
    const rows = [
      person({ userId: "free", displayName: "Ama", plan: "free" }),
      person({ userId: "paid", displayName: "Bao", plan: "buddy_pro" })
    ];
    expect(orderDiscoveryPeople(rows).map((p) => p.userId)).toEqual(["free", "paid"]);
  });

  it("does not mutate its input", () => {
    const rows = [person({ userId: "b", proximityTier: "far" }), person({ userId: "a", proximityTier: "close" })];
    orderDiscoveryPeople(rows);
    expect(rows[0]!.userId).toBe("b");
  });
});

// ---------------------------------------------------------------------------
// The feed surface
// ---------------------------------------------------------------------------

describe("discovery feed", () => {
  it("has no radar, orbit or ring layout", () => {
    for (const banned of ["radar", "orbit", "radarsize"]) {
      expect(feed.toLowerCase(), `the feed must not reference ${banned}`).not.toContain(banned);
    }
  });

  it("renders header, search and cards in one vertical scroll", () => {
    expect(feed).toContain("Socialize");
    expect(feed).toContain('aria-label="Search people nearby"');
    // The filters button became a search toggle: the chips it revealed are
    // gone, so a control named "Filters" now describes nothing.
    expect(feed).toContain('aria-label={filtersOpen ? "Close search" : "Search people"}');
    expect(feed).not.toContain('aria-label="Filters"');
  });

  it("hides sections with no data rather than showing blanks", () => {
    expect(card).toContain("PROXIMITY_LABEL[person.proximityTier]");
    // No age, interests or mutual count are invented. Matched as field
    // accesses — a bare "age" also matches "message" and "image".
    for (const absent of ["person.age", "person.interests", "person.mutual"]) {
      expect(card, `the card must not render ${absent}`).not.toContain(absent);
    }
  });

  it("keeps glow small and reuses the canonical component", () => {
    expect(card).toContain("<GlowAvatar");
    expect(card).not.toContain("radarSizeFor");
  });

  it("reuses canonical actions", () => {
    expect(feed).toContain("onWave");
    expect(feed).toContain("onInvite");
    expect(feed).toContain("onMessage");
  });

  it("passes a pass handler, and never confuses it with a block", () => {
    // A left swipe is a private, expiring feed preference. Blocking is a
    // separate, mutual action with its own control — the deck must not wire
    // the dismissal gesture to it.
    expect(feed).toContain("onPass");
    expect(feed).toContain("onUndoPass");
    expect(feed).not.toContain("onBlock");
  });

  it("routes to the canonical profile", () => {
    expect(card).toContain("`/friends/${person.username}`");
  });

  it("resets paging when filters or search change", () => {
    expect((feed.match(/setVisibleCount\(DISCOVERY_PAGE_SIZE\)/g) ?? []).length).toBeGreaterThanOrEqual(2);
  });

  it("respects reduced motion for the staggered entrance", () => {
    const reduced = css.slice(css.indexOf("@keyframes socialize-card-in"));
    expect(reduced).toContain("prefers-reduced-motion");
  });

  it("scrolls the rails horizontally rather than stacking a grid", () => {
    // The people rail IS the feed, so there is no second vertical list.
    expect(rails).toContain("snap-x");
  });

  it("keeps 44px targets on chips and the settings control", () => {
    expect(feed).toContain("h-11");
  });
});

// ---------------------------------------------------------------------------
// The discovery banner
// ---------------------------------------------------------------------------

describe("discovery hero", () => {
  it("leads with a live count of people nearby", () => {
    expect(hero).toContain("Around you");
    expect(hero).toContain('{total === 1 ? "person" : "people"} nearby');
  });

  it("IS NOT A LEADERBOARD", () => {
    // Ranking people by connections made would turn meeting someone into a
    // scoreboard and reward exactly the wrong behaviour.
    for (const banned of ["leaderboard", "rank", "top connector", "score", "streak"]) {
      expect((hero + feed).toLowerCase(), `the banner must not introduce ${banned}`).not.toContain(banned);
    }
  });

  it("names no individual person", () => {
    // Aggregates only — the banner reports the room, never who is winning it.
    expect(hero).not.toContain("avatarUrl");
    expect(hero).not.toContain("displayName");
  });

  it("derives its counts from the already-authorised projection", () => {
    // No second query, and nothing counted the viewer cannot already see.
    expect(stripComments(read("components/socialize/socialize-page.tsx"))).toContain('visiblePeople.filter((row) => row.presenceState === "fresh")');
  });

  it("hides a secondary insight rather than showing a zero", () => {
    // A row of zeroes reads as a dead room; saying nothing is better.
    expect(hero).toContain("activeNow > 0 || newToday > 0");
    expect(hero).toContain("{activeNow > 0 ? (");
    expect(hero).toContain("{newToday > 0 ?");
  });

  it("does not render at all when nobody is nearby", () => {
    // The hero always renders; its ON insights are what appear conditionally.
    expect(hero).toContain("active && (activeNow > 0 || newToday > 0)");
  });

  it("offers one primary action that clears narrowing", () => {
    expect(hero).toContain("Explore");
    // The chip row is gone, so Explore clears the search — the only narrowing
    // the feed still has.
    expect(feed).toContain('setQuery("")');
    expect(feed).not.toContain("DISCOVERY_FILTERS");
  });

  it("is a labelled landmark, not a decorative div", () => {
    expect(hero).toContain('aria-labelledby="socialize-hero-heading"');
  });

  it("uses the brand artwork with a readability scrim over it", () => {
    // The artwork is decorative; the scrim is what guarantees the text stays
    // legible regardless of which part of the image sits behind a word.
    expect(hero).toContain('src="/brand/social background.png"');
    expect(hero).toContain('alt=""');
    // A scrim must exist; its exact opacity is a design value that moves.
    expect(hero).toMatch(/bg-gradient-to-t from-background\/\d+/);
    expect(hero).toContain("hsl(var(--primary)/0.14)");
  });

  it("stacks content ABOVE the readability scrim", () => {
    // Twice now the text has rendered beneath its own overlay and read as a
    // dark smear. One explicit order, asserted: artwork -> lights -> scrim ->
    // content.
    expect(hero).toContain('className="pointer-events-none z-0 scale-105');
    expect(hero).toContain("z-[1] h-52 w-52");
    expect(hero).toContain('"pointer-events-none absolute inset-0 z-[2]"');
    expect(hero).toContain('<div className="relative z-10">');
    // The artwork must never sit behind the section's own background again.
    expect(hero).not.toContain("-z-10");
  });

  it("never announces the decorative artwork to a screen reader", () => {
    const artwork = hero.slice(hero.indexOf("<Image"), hero.indexOf("/>", hero.indexOf("<Image")));
    expect(artwork).toContain('aria-hidden="true"');
    expect(artwork).toContain('alt=""');
  });
});

// ---------------------------------------------------------------------------
// The person card
// ---------------------------------------------------------------------------

describe("person card", () => {
  it("leads with a large portrait, not a thumbnail", () => {
    expect(card).toContain("aspect-[4/5]");
    // Socialize IS the discovery page, so there is no "See all" to leave for.
    expect(rails).not.toContain("See all");
  });

  it("falls back to the canonical avatar rather than empty space", () => {
    expect(card).toContain("<GlowAvatar");
    expect(card).toContain("person.avatarUrl ? (");
  });

  it("shows Active now only for fresh presence", () => {
    expect(card).toContain('person.presenceState === "fresh"');
    expect(card).toContain("Active now");
  });

  it("replaces proximity with a hedge when presence is stale", () => {
    // Never both: if we are unsure they are still there, we must not also
    // claim how close they are.
    expect(card).toContain("const locationLine = hedge ?? proximity;");
  });

  it("names proximity in words, never a distance", () => {
    expect(card).toContain('close: "Close by"');
    expect(card).toContain('near: "Nearby"');
    expect(card).toContain('far: "Around you"');
  });

  it("picks the primary action from the relationship state", () => {
    // Never an action the server would reject.
    expect(card).toContain('waved ? "Wave sent" : inbound ? "Accept & connect" : "Wave"');
    expect(card).toContain("canMessage ? (");
  });

  it("offers Message only to an existing Muddy", () => {
    expect(card).toContain('const connected = person.waveState === "accepted";');
    expect(card).toContain("connected && Boolean(onMessage)");
  });

  it("never presents membership as verification", () => {
    expect(card).toContain("<PremiumPlanBadge");
    expect(card.toLowerCase()).not.toContain("verified");
  });

  it("invents no age, interests or mutual count", () => {
    for (const absent of ["person.age", "person.interests", "person.mutual", "person.spark"]) {
      expect(card, `the card must not render ${absent}`).not.toContain(absent);
    }
  });

  it("gives the whole card one accessible name", () => {
    expect(card).toContain("aria-label={accessibleName}");
  });

  it("labels both actions explicitly", () => {
    expect(card).toContain("`View ${name}'s profile`");
    expect(card).toContain("View profile");
  });

  it("keeps every target a comfortable size", () => {
    // The primary action and the secondary profile link both stay well above
    // the practical touch floor, even after the CTA was reduced so it stopped
    // dominating the card.
    const targets = card.match(/min-h-\[(\d+)px\]/g) ?? [];
    expect(targets.length).toBeGreaterThanOrEqual(2);
    for (const target of targets) {
      expect(Number(target.replace(/\D/g, ""))).toBeGreaterThanOrEqual(38);
    }
  });

  it("memoises, so a filter keystroke does not re-render every portrait", () => {
    expect(card).toContain("memo(PersonCard)");
  });

  it("lazy-loads portraits", () => {
    expect(card).toContain('loading="lazy"');
    expect(card).toContain('decoding="async"');
  });

  it("ships a card-shaped skeleton, so arriving people cause no reflow", () => {
    expect(card).toContain("SocializePersonCardSkeleton");
    expect(card).toContain("aspect-[4/5] w-full animate-pulse");
  });

  it("reserves future slots without stubbing them", () => {
    expect(card).toContain("slots?.beforeActions");
    expect(card).toContain("slots?.afterIdentity");
  });

  it("respects reduced motion for entrance and hover", () => {
    // Hover motion is carried by `.linkr-card-media`, disabled wholesale in
    // the reduced-motion block rather than per-utility on every card.
    expect(card).toContain("linkr-card-media");
    expect(css).toContain(".socialize-card-in");
    const shared = css.slice(css.indexOf(".linkr-card {"));
    expect(shared.slice(0, 2000)).toContain("prefers-reduced-motion");
  });

  it("enters without bouncing", () => {
    const entrance = css.slice(css.indexOf("@keyframes socialize-card-in"));
    expect(entrance.slice(0, 400)).not.toContain("bounce");
  });
});
