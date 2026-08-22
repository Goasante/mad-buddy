import { filterForMode } from "@/lib/social/upfor-feed";
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
    areaTier: null,
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
    // Nearby became real in Stage 5: the tier is server-derived and ages out
    // when stale, so it filters on a fact rather than on typed text.
    expect(UPFOR_FILTERS.map((f) => f.id)).toEqual([
      "nearby",
      "happening_now",
      "has_space",
      "joined"
    ]);
  });
});

// ---------------------------------------------------------------------------
// The primary feed no longer filters. It has four discovery modes instead.
// ---------------------------------------------------------------------------

describe("the legacy filter sheet is gone, not hidden", () => {
  /* The sheet was removed rather than kept beside the tabs. Tests that pinned
   * its markup were correctly failing once the feed stopped consulting it: a
   * control that opens a panel the feed ignores is a dead button, and hiding
   * it with CSS would have left the same dead state behind.
   *
   * lib/social/upfor-filters.ts SURVIVES -- hasSpace and isJoined still have
   * callers -- so only the page's filtering path is asserted gone. */
  it("removes the control, its state and its sheet from the page", () => {
    for (const dead of [
      "setFilterSheetOpen",
      "filterSheetOpen",
      "applyUpForFilters(feed",
      "activeFilterCount(",
      "EMPTY_UPFOR_FILTERS",
      "Nothing matches those filters",
      "Clear filters",
      "upfor-filter-body"
    ]) {
      expect(page, dead).not.toContain(dead);
    }
  });

  it("keeps the shared helpers other surfaces still use", () => {
    // Deleting a module because one caller stopped using it is how a second
    // caller breaks later.
    const lib = read("lib/social/upfor-filters.ts");
    expect(lib).toContain("export function hasSpace");
    expect(lib).toContain("export function isJoined");
  });

  it("does not bring back the legacy discovery labels", () => {
    /* All / Nearby / Popular / Just for you were the old model. Asserted on
     * the tab registry rather than on the page, because that is where a
     * revival would have to start. */
    const modes = read("lib/social/upfor-feed.ts");
    const registry = modes.slice(modes.indexOf("export const UPFOR_MODES"), modes.indexOf("export function isUpForMode"));
    for (const dead of ["All UpFors", "Popular", "Just for you"]) {
      expect(registry, dead).not.toContain(dead);
    }
  });
});

describe("the four discovery modes are the feed controls", () => {
  it("renders exactly the approved tabs", () => {
    const parts = read("components/hangout/upfor-feed-parts.tsx");
    expect(parts).toContain("UPFOR_MODES.map");
    const modes = read("lib/social/upfor-feed.ts");
    for (const label of ["For You", "Muddies", "Around", "Groups"]) {
      expect(modes, label).toContain(label);
    }
  });

  it("narrows through the tested rules, never a second copy in the component", () => {
    // The same property the old test protected, at its new address.
    const feed = read("components/hangout/upfor-feed.tsx");
    expect(feed).toContain("filterForMode(items, mode, nowMs)");
    expect(feed).not.toContain("items.filter(");
    expect(feed).not.toContain(".sort(");
  });

  it("switching a tab changes what the feed returns", () => {
    /* Real behaviour, not markup: the same eligible list must produce
     * different results per mode, or the tabs are decoration. */
    const base = {
      ownerId: "o",
      activityType: "food" as const,
      areaTier: null,
      startsAt: new Date(NOW - 60_000).toISOString(),
      endsAt: new Date(NOW + 3_600_000).toISOString(),
      goingCount: 0
    };
    const list = [
      { ...base, id: "muddy", isMuddy: true, viaGroup: false },
      { ...base, id: "group", isMuddy: false, viaGroup: true }
    ];
    expect(filterForMode(list, "muddies", NOW).map((i) => i.id)).toEqual(["muddy"]);
    expect(filterForMode(list, "groups", NOW).map((i) => i.id)).toEqual(["group"]);
    expect(filterForMode(list, "for_you", NOW)).toHaveLength(2);
  });
});
