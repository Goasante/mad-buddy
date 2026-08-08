import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { stripComments } from "@/lib/content/strip-comments";
import {
  EMPTY_UPFOR_FILTERS,
  UPFOR_ACTIVITIES,
  UPFOR_FILTERS,
  activeFilterCount,
  applyUpForFilters,
  hasSpace,
  isHappeningNow,
  isJoined,
  setUpForActivity,
  toggleUpForFilter,
  type UpForFilterState,
  type UpForFilterable
} from "@/lib/social/upfor-filters";

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");
const page = stripComments(read("components/hangout/hangout-mode-page.tsx"));
const actions = read("app/(app)/hangout-actions.ts");

const NOW = Date.parse("2026-08-08T12:00:00.000Z");
const at = (ms: number) => new Date(NOW + ms).toISOString();

function upFor(overrides: Partial<UpForFilterable> = {}): UpForFilterable {
  return {
    activityType: "food",
    endsAt: at(60 * 60_000),
    goingCount: 1,
    maxParticipants: 5,
    myRequestStatus: null,
    ...overrides
  };
}

const state = (overrides: Partial<UpForFilterState> = {}): UpForFilterState => ({
  ...EMPTY_UPFOR_FILTERS,
  ...overrides
});

// ---------------------------------------------------------------------------
// Each filter, independently
// ---------------------------------------------------------------------------

describe("Happening now", () => {
  it("keeps a session still inside its window", () => {
    expect(isHappeningNow({ endsAt: at(60_000) }, NOW)).toBe(true);
  });

  it("excludes one that has already ended", () => {
    expect(isHappeningNow({ endsAt: at(-1) }, NOW)).toBe(false);
  });

  it("treats the exact end instant as over", () => {
    // The boundary: at ends_at the session is finished, not finishing.
    expect(isHappeningNow({ endsAt: at(0) }, NOW)).toBe(false);
  });

  it("excludes an unparseable date rather than passing it through", () => {
    expect(isHappeningNow({ endsAt: "not-a-date" }, NOW)).toBe(false);
  });
});

describe("Has space", () => {
  it("keeps a session with room", () => {
    expect(hasSpace({ goingCount: 2, maxParticipants: 5 })).toBe(true);
  });

  it("excludes a full session", () => {
    expect(hasSpace({ goingCount: 5, maxParticipants: 5 })).toBe(false);
  });

  it("excludes one somehow over its cap", () => {
    expect(hasSpace({ goingCount: 6, maxParticipants: 5 })).toBe(false);
  });

  it("compares against the owner's cap, not the request count", () => {
    // Capacity must never be inferred from how many people asked: pending
    // requests are not attendance, and counting them would hide a session
    // that still has room.
    expect(actions).toContain("max_participants");
    expect(page).not.toContain("requests.length >=");
  });
});

describe("Joined", () => {
  it("keeps a session the viewer was accepted into", () => {
    expect(isJoined({ myRequestStatus: "accepted" })).toBe(true);
  });

  it("excludes a pending request, which is a question not an answer", () => {
    // Showing pending as joined would tell someone they are going somewhere
    // they may yet be declined from.
    expect(isJoined({ myRequestStatus: "pending" })).toBe(false);
  });

  it("excludes declined, maybe, cancelled and no request at all", () => {
    for (const status of ["declined", "maybe", "cancelled", null]) {
      expect(isJoined({ myRequestStatus: status })).toBe(false);
    }
  });
});

describe("Activity", () => {
  it("keeps only the chosen activity", () => {
    const items = [upFor({ activityType: "food" }), upFor({ activityType: "study" })];
    const result = applyUpForFilters(items, state({ activity: "study" }), NOW);
    expect(result).toHaveLength(1);
    expect(result[0]!.activityType).toBe("study");
  });

  it("offers only values that already exist in the enum", () => {
    // No new taxonomy in this stage.
    const allowed = ["anything", "food", "study", "sports", "gym", "walk", "gaming", "chill"];
    for (const option of UPFOR_ACTIVITIES) {
      expect(allowed).toContain(option.id);
    }
  });
});

// ---------------------------------------------------------------------------
// Combining, counting, clearing
// ---------------------------------------------------------------------------

describe("filters combine by narrowing", () => {
  const items = [
    upFor({ activityType: "food", goingCount: 5, maxParticipants: 5, myRequestStatus: "accepted" }),
    upFor({ activityType: "food", goingCount: 1, maxParticipants: 5, myRequestStatus: "accepted" }),
    upFor({ activityType: "walk", goingCount: 1, maxParticipants: 5, myRequestStatus: null })
  ];

  it("ANDs every selection rather than widening", () => {
    const result = applyUpForFilters(
      items,
      state({ toggles: new Set(["has_space", "joined"]), activity: "food" }),
      NOW
    );
    // Only the second item has space AND is joined AND is food.
    expect(result).toHaveLength(1);
    expect(result[0]!.goingCount).toBe(1);
  });

  it("returns everything when nothing is selected", () => {
    expect(applyUpForFilters(items, EMPTY_UPFOR_FILTERS, NOW)).toHaveLength(3);
  });

  it("never mutates or reorders the array it was given", () => {
    const original = [...items];
    applyUpForFilters(items, state({ toggles: new Set(["has_space"]) }), NOW);
    expect(items).toEqual(original);
  });

  it("drops an unknown id rather than silently passing everything", () => {
    // Cannot happen through the UI, which renders from the registry, but a
    // stale persisted value could — and a filter that quietly stops filtering
    // is the failure this registry exists to prevent.
    const rogue = state({ toggles: new Set(["not_a_filter"] as never) });
    expect(applyUpForFilters(items, rogue, NOW)).toHaveLength(0);
  });
});

describe("the active count and Clear all", () => {
  it("counts toggles and the activity together", () => {
    expect(activeFilterCount(EMPTY_UPFOR_FILTERS)).toBe(0);
    expect(activeFilterCount(state({ toggles: new Set(["joined"]) }))).toBe(1);
    expect(activeFilterCount(state({ toggles: new Set(["joined", "has_space"]), activity: "food" }))).toBe(3);
  });

  it("clears everything at once", () => {
    expect(activeFilterCount(EMPTY_UPFOR_FILTERS)).toBe(0);
    expect(EMPTY_UPFOR_FILTERS.toggles.size).toBe(0);
    expect(EMPTY_UPFOR_FILTERS.activity).toBeNull();
  });

  it("toggles on and back off without mutating the previous state", () => {
    const before = EMPTY_UPFOR_FILTERS;
    const on = toggleUpForFilter(before, "joined");
    const off = toggleUpForFilter(on, "joined");
    expect(on.toggles.has("joined")).toBe(true);
    expect(off.toggles.has("joined")).toBe(false);
    expect(before.toggles.size).toBe(0);
  });

  it("clears an activity by choosing the same one again", () => {
    const chosen = setUpForActivity(EMPTY_UPFOR_FILTERS, "food");
    expect(setUpForActivity(chosen, "food").activity).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// The registry stays honest
// ---------------------------------------------------------------------------

describe("no unsupported filter is offered", () => {
  it("registers only filters backed by real fields", () => {
    expect(UPFOR_FILTERS.map((f) => f.id)).toEqual(["happening_now", "has_space", "joined"]);
  });

  it("renders no filter the product cannot back", () => {
    // Nearby needs proximity the session does not carry; Popular is not
    // popularity semantics; Just for you needs a model that does not exist;
    // Starting soon cannot work while starts_at always defaults to now().
    // Matched as filter CHIP labels. "Nearby" alone would hit the section
    // heading "Happening Now Nearby", which is prose, not a control.
    const sheet = page.slice(page.indexOf("upfor-filter-body"), page.indexOf("upfor-filter-actions"));
    for (const dead of ["Nearby", "Popular", "Just for you", "Starting soon", "See map"]) {
      expect(sheet).not.toContain(dead);
    }
  });

  it("renders the sheet FROM the registry, so a new filter is one entry", () => {
    expect(page).toContain("UPFOR_FILTERS.map");
    expect(page).toContain("UPFOR_ACTIVITIES.map");
  });

  it("filters in one place, never a second copy in the component", () => {
    expect(page).toContain("applyUpForFilters(feed, filters, nowMs)");
    expect(page).not.toContain("feed.filter(");
  });
});

describe("this stage changed no queries", () => {
  it("still reads the same tables through the same action", () => {
    expect(actions).toContain('from("hangout_sessions")');
    expect(actions).toContain('from("hangout_requests")');
    // The feed is loaded by the route and handed down as props; the page
    // never queries.
    const route = read("app/(app)/hangout-mode/page.tsx");
    expect(route).toContain("getVisibleHangoutsAction");
  });

  it("filters on the client, leaving server data untouched", () => {
    // The projection is the source of truth; narrowing is a view over it.
    expect(page).toContain("const visibleFeed = applyUpForFilters");
  });
});

describe("an over-narrowed list offers a way out", () => {
  it("distinguishes filtered-empty from genuinely empty", () => {
    // Offering "start one" to somebody who just over-narrowed is the wrong
    // answer to the problem they actually have.
    expect(page).toContain("Nothing matches those filters");
    expect(page).toContain("Clear filters");
  });
});
