import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildMomentSections,
  isLegacyTabParam,
  isMomentsTrulyEmpty,
  momentsTabItems,
  orderAirMoments,
  orderPersonalMoments,
  resolveMomentTab,
  MOMENT_TABS
} from "@/lib/content/moments-tabs";
import type { VisibleMoment } from "@/lib/content/service";
import { stripComments } from "@/lib/content/strip-comments";

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");
const NOW = Date.UTC(2026, 7, 6, 12, 0, 0);
const MIN = 60_000;

function moment(overrides: Partial<VisibleMoment> & { id: string }): VisibleMoment {
  return {
    authorId: `author-${overrides.id}`,
    authorName: "A Muddy",
    authorAvatarUrl: null,
    authorPlan: "free",
    contentType: "photo",
    textContent: null,
    caption: null,
    mediaUrl: null,
    // Active by default.
    expiresAt: new Date(NOW + 60 * MIN).toISOString(),
    createdAt: new Date(NOW - 10 * MIN).toISOString(),
    myReaction: null,
    reactionCount: 0,
    reactionBreakdown: {},
    isAuthor: false,
    audienceLabel: null,
    viewerRelationship: "muddy",
    viewCount: 0,
    tunedInFromThis: null,
    creatorTunedIn: false,
    creatorTunedInCount: 0,
    ...overrides
  };
}

// ---------------------------------------------------------------------------
// Tab routing
// ---------------------------------------------------------------------------

describe("tab routing", () => {
  it("offers exactly the three approved tabs", () => {
    expect([...MOMENT_TABS]).toEqual(["all", "moments", "air"]);
  });

  it("defaults to All", () => {
    for (const raw of [null, undefined, "", "   ", "nonsense"]) {
      expect(resolveMomentTab(raw)).toBe("all");
    }
  });

  it("resolves each tab from the URL", () => {
    expect(resolveMomentTab("all")).toBe("all");
    expect(resolveMomentTab("moments")).toBe("moments");
    expect(resolveMomentTab("air")).toBe("air");
  });

  it("maps the legacy spotlight param to Air", () => {
    // Older links must keep working rather than silently landing on All.
    expect(resolveMomentTab("spotlight")).toBe("air");
    expect(resolveMomentTab("SPOTLIGHT")).toBe("air");
    expect(isLegacyTabParam("spotlight")).toBe(true);
    expect(isLegacyTabParam("air")).toBe(false);
  });

  it("is case and whitespace tolerant", () => {
    expect(resolveMomentTab(" Air ")).toBe("air");
    expect(resolveMomentTab("MOMENTS")).toBe("moments");
  });
});

// ---------------------------------------------------------------------------
// Personal ordering
// ---------------------------------------------------------------------------

describe("personal moment ordering", () => {
  it("puts the viewer's own Moment first, then close friends, then Muddies", () => {
    const ordered = orderPersonalMoments([
      moment({ id: "stranger", viewerRelationship: null }),
      moment({ id: "muddy", viewerRelationship: "muddy" }),
      moment({ id: "mine", isAuthor: true, viewerRelationship: "self" }),
      moment({ id: "close", viewerRelationship: "close_friend" })
    ]);
    expect(ordered.map((m) => m.id)).toEqual(["mine", "close", "muddy", "stranger"]);
  });

  it("breaks ties by recency", () => {
    const ordered = orderPersonalMoments([
      moment({ id: "older", createdAt: new Date(NOW - 60 * MIN).toISOString() }),
      moment({ id: "newer", createdAt: new Date(NOW - 5 * MIN).toISOString() })
    ]);
    expect(ordered.map((m) => m.id)).toEqual(["newer", "older"]);
  });

  it("fabricates no ranking signal", () => {
    // Only relationship and createdAt — both server-derived.
    const source = read("lib/content/moments-tabs.ts");
    expect(source).not.toContain("Math.random");
    expect(source).not.toContain("score");
    expect(source).not.toContain("proximity");
  });

  it("does not mutate its input", () => {
    const input = [moment({ id: "a" }), moment({ id: "mine", isAuthor: true })];
    const before = input.map((m) => m.id);
    orderPersonalMoments(input);
    expect(input.map((m) => m.id)).toEqual(before);
  });
});

// ---------------------------------------------------------------------------
// Air ordering
// ---------------------------------------------------------------------------

describe("air ordering", () => {
  it("puts active sessions before ended ones", () => {
    const ordered = orderAirMoments(
      [
        moment({ id: "ended", expiresAt: new Date(NOW - MIN).toISOString() }),
        moment({ id: "active", expiresAt: new Date(NOW + 30 * MIN).toISOString() })
      ],
      NOW
    );
    expect(ordered.map((m) => m.id)).toEqual(["active", "ended"]);
  });

  it("orders within a state by recency", () => {
    const ordered = orderAirMoments(
      [
        moment({ id: "old", createdAt: new Date(NOW - 50 * MIN).toISOString() }),
        moment({ id: "new", createdAt: new Date(NOW - 2 * MIN).toISOString() })
      ],
      NOW
    );
    expect(ordered.map((m) => m.id)).toEqual(["new", "old"]);
  });
});

// ---------------------------------------------------------------------------
// All tab sections
// ---------------------------------------------------------------------------

describe("All tab sections", () => {
  const moments = [
    moment({ id: "mine", isAuthor: true, viewerRelationship: "self" }),
    moment({ id: "close", viewerRelationship: "close_friend" }),
    moment({ id: "m1" }),
    moment({ id: "m2" }),
    moment({ id: "m3" })
  ];
  const air = [moment({ id: "air1" }), moment({ id: "air2" })];

  it("returns the three sections in the approved order", () => {
    const sections = buildMomentSections(moments, air, { nowMs: NOW });
    expect(Object.keys(sections)).toEqual(["personal", "air", "more"]);
  });

  it("never renders the same Moment in two sections", () => {
    const sections = buildMomentSections(moments, air, { personalLimit: 2, nowMs: NOW });
    const ids = [...sections.personal, ...sections.air, ...sections.more].map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("keeps an Air Moment out of Personal when it appears in both feeds", () => {
    const shared = moment({ id: "shared" });
    const sections = buildMomentSections([shared, ...moments], [shared], { nowMs: NOW });
    expect(sections.air.map((m) => m.id)).toContain("shared");
    expect(sections.personal.map((m) => m.id)).not.toContain("shared");
    expect(sections.more.map((m) => m.id)).not.toContain("shared");
  });

  it("leads Personal with the viewer's own Moment", () => {
    const sections = buildMomentSections(moments, air, { nowMs: NOW });
    expect(sections.personal[0]?.id).toBe("mine");
    expect(sections.personal[1]?.id).toBe("close");
  });

  it("spills the overflow into More rather than dropping it", () => {
    const sections = buildMomentSections(moments, [], { personalLimit: 2, nowMs: NOW });
    expect(sections.personal).toHaveLength(2);
    expect(sections.more.length).toBeGreaterThan(0);
  });

  it("respects explicit limits so a rail cannot grow unbounded", () => {
    const many = Array.from({ length: 40 }, (_, i) => moment({ id: `m${i}` }));
    const sections = buildMomentSections(many, many.slice(0, 20), {
      personalLimit: 8,
      airLimit: 8,
      moreLimit: 12,
      nowMs: NOW
    });
    expect(sections.personal.length).toBeLessThanOrEqual(8);
    expect(sections.air.length).toBeLessThanOrEqual(8);
    expect(sections.more.length).toBeLessThanOrEqual(12);
  });
});

// ---------------------------------------------------------------------------
// Moments tab
// ---------------------------------------------------------------------------

describe("Moments tab", () => {
  it("excludes Air content", () => {
    const shared = moment({ id: "air-only" });
    const items = momentsTabItems([moment({ id: "m1" }), shared], [shared]);
    expect(items.map((m) => m.id)).toEqual(["m1"]);
  });

  it("uses the same priority order", () => {
    const items = momentsTabItems(
      [moment({ id: "m" }), moment({ id: "mine", isAuthor: true, viewerRelationship: "self" })],
      []
    );
    expect(items[0]?.id).toBe("mine");
  });

  it("caps what it renders rather than loading all history", () => {
    const many = Array.from({ length: 100 }, (_, i) => moment({ id: `m${i}` }));
    expect(momentsTabItems(many, [], 24)).toHaveLength(24);
  });
});

// ---------------------------------------------------------------------------
// Empty
// ---------------------------------------------------------------------------

describe("true empty", () => {
  it("is empty only when there is no content of any kind", () => {
    expect(isMomentsTrulyEmpty([], [])).toBe(true);
    expect(isMomentsTrulyEmpty([moment({ id: "a" })], [])).toBe(false);
    expect(isMomentsTrulyEmpty([], [moment({ id: "air" })])).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Authorisation and privacy
// ---------------------------------------------------------------------------

describe("authorisation and privacy", () => {
  it("only ever arranges the feeds it is given", () => {
    // No querying, no filtering-in: everything here is a sort or a partition
    // of already-authorised content.
    const source = read("lib/content/moments-tabs.ts");
    expect(source).not.toContain("createSupabase");
    expect(source).not.toContain("fetch(");
    expect(source).not.toContain("from(");
  });

  it("never invents a relationship the server did not state", () => {
    const source = read("lib/content/moments-tabs.ts");
    // Reads the field; never derives one from plan, name or anything else.
    expect(source).toContain("moment.viewerRelationship");
    expect(source).not.toContain("authorPlan");
  });

  it("keeps every Moment accounted for across the three sections", () => {
    const moments = Array.from({ length: 6 }, (_, i) => moment({ id: `m${i}` }));
    const sections = buildMomentSections(moments, [], {
      personalLimit: 2,
      moreLimit: 99,
      nowMs: NOW
    });
    const seen = [...sections.personal, ...sections.more].map((m) => m.id).sort();
    expect(seen).toEqual(moments.map((m) => m.id).sort());
  });
});

// ---------------------------------------------------------------------------
// Page wiring
// ---------------------------------------------------------------------------

describe("Moments page wiring", () => {
  const page = read("components/content/moments-page.tsx");
  const tile = read("components/content/moment-tile.tsx");
  const preview = read("components/content/moments-preview.tsx");

  it("derives the tab from the URL rather than mirroring it into state", () => {
    // Derived, not synced: no effect can leave the tab and the URL disagreeing.
    expect(page).toContain('const tab = resolveMomentTab(searchParams.get("tab"));');
    expect(page).not.toContain("setTab(");
  });

  it("writes the tab back to the URL without stacking history", () => {
    expect(page).toContain("router.replace(`/moments?tab=${next}`");
    expect(page).toContain("{ scroll: false }");
  });

  it("opens Air from a Home tile via the canonical param", () => {
    // The tile now links to the EXACT Moment, so the tab literal moved into
    // momentHref. Exact-target behaviour is covered in moment-target.test.ts.
    expect(tile).toContain('momentHref(moment.id, air ? "air" : "moments")');
    // The legacy spelling is gone from the links themselves; resolveMomentTab
    // still accepts it for URLs already in the wild.
    expect(tile).not.toContain("tab=spotlight");
    expect(preview).not.toContain("tab=spotlight");
  });

  it("renders the All tab's three sections in the approved order", () => {
    const allTab = page.slice(page.indexOf("function AllTab"), page.indexOf("function MomentRail"));
    expect(allTab.indexOf('title="Personal Moments"')).toBeGreaterThan(-1);
    expect(allTab.indexOf('title="Air"')).toBeGreaterThan(allTab.indexOf('title="Personal Moments"'));
    expect(allTab.indexOf('title="More Moments"')).toBeGreaterThan(allTab.indexOf('title="Air"'));
  });

  it("uses the one shared card everywhere instead of a second implementation", () => {
    expect(page).toContain("<MomentTile");
    expect(page).toContain('from "@/components/content/moment-tile"');
  });

  it("hides a section rather than showing a header over nothing", () => {
    const rail = page.slice(page.indexOf("function MomentRail"), page.indexOf("function PrivateMomentCard"));
    expect(rail).toContain("if (live.length === 0) return null;");
  });

  it("drops expired Moments from every section", () => {
    const rail = page.slice(page.indexOf("function MomentRail"), page.indexOf("function PrivateMomentCard"));
    expect(rail).toContain("Date.parse(moment.expiresAt) > nowMs");
  });

  it("keeps the onboarding pitch for a truly empty account only", () => {
    expect(page).toContain("isMomentsTrulyEmpty(moments, spotlight)");
    expect(page).toContain("No Moments yet.");
    expect(page).toContain("No one is on Air right now.");
  });

  it("says Air, never LIVE or ON AIR", () => {
    // Rendered text only: the comments that STATE this rule name the banned
    // words on purpose, so they are stripped before asserting.
    for (const source of [page, tile, preview]) {
      expect(stripComments(source)).not.toMatch(/LIVE/);
      expect(stripComments(source)).not.toMatch(/ON AIR/);
    }
  });});

// ---------------------------------------------------------------------------
// View count is an author-and-viewer figure, deliberately
// ---------------------------------------------------------------------------

describe("view count visibility policy", () => {
  it("shows the view count to every authorised viewer, not only the author", () => {
    // Approved change: the count is an aggregate with no identities attached,
    // so it is safe to show to anyone already allowed to see the Moment.
    const service = read("lib/content/service.ts");
    expect(service).not.toContain("isAuthor ? viewCount : null");
    const tile = read("components/content/moment-tile.tsx");
    expect(tile).toContain("moment.viewCount");
  });

  it("never exposes WHO viewed a Moment", () => {
    const tile = read("components/content/moment-tile.tsx");
    expect(tile).not.toContain("viewerIds");
    expect(tile).not.toContain("viewers");
  });
});
