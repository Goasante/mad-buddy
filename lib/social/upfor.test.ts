import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { stripComments } from "@/lib/content/strip-comments";
import {
  UPFOR_QUICK_IDEAS,
  applyUpForFilter,
  isEndingSoon,
  isUpForFilterAvailable,
  upForGoingLabel,
  upForTimeLeft,
  upForTitle
} from "@/lib/social/upfor";

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");
const page = stripComments(read("components/hangout/hangout-mode-page.tsx"));
const actions = stripComments(read("app/(app)/hangout-actions.ts"));

describe("the countdown never overstates the time left", () => {
  const now = Date.parse("2026-08-08T12:00:00.000Z");
  const at = (ms: number) => new Date(now + ms).toISOString();

  it("rounds DOWN, so a card never promises time the session does not have", () => {
    expect(upForTimeLeft(at(40 * 60_000 + 59_000), now)).toBe("40 min left");
    expect(upForTimeLeft(at(39 * 60_000 + 59_000), now)).toBe("39 min left");
  });

  it("switches to hours past the hour mark", () => {
    expect(upForTimeLeft(at(75 * 60_000), now)).toBe("1h 15m left");
    expect(upForTimeLeft(at(120 * 60_000), now)).toBe("2h left");
  });

  it("says ending now rather than 0 min left", () => {
    expect(upForTimeLeft(at(30_000), now)).toBe("Ending now");
  });

  it("returns null once it has lapsed, so no card shows a dead timer", () => {
    expect(upForTimeLeft(at(-60_000), now)).toBeNull();
    expect(upForTimeLeft("not-a-date", now)).toBeNull();
  });

  it("flags the last fifteen minutes, which is the whole point of the feature", () => {
    expect(isEndingSoon(at(10 * 60_000), now)).toBe(true);
    expect(isEndingSoon(at(45 * 60_000), now)).toBe(false);
    expect(isEndingSoon(at(-60_000), now)).toBe(false);
  });
});

describe("counts and titles state only what is true", () => {
  it("never says 0 or 1 going", () => {
    // Every UpFor has its owner, so one is the resting state — stating it
    // makes a new session look empty rather than new.
    expect(upForGoingLabel(0)).toBeNull();
    expect(upForGoingLabel(1)).toBeNull();
    expect(upForGoingLabel(3)).toBe("3 going");
  });

  it("counts accepted joiners only, never pending requests", () => {
    // "3 going" must mean three people are coming, not three who asked.
    expect(actions).toContain('.eq("status", "accepted")');
    expect(actions).toContain("acceptedBySession");
  });

  it("builds titles from the canonical activity labels", () => {
    expect(upForTitle("food")).toContain("now");
    expect(upForTitle("anything")).toBe("Up for anything");
  });

  it("offers only real activity types as quick ideas", () => {
    // Each tile preselects an activity in the existing setup sheet rather
    // than routing anywhere new.
    expect(UPFOR_QUICK_IDEAS.length).toBeGreaterThan(0);
    expect(page).toContain("openSetup(idea.id)");
  });
});

describe("filters are honest about what they can do", () => {
  const items = [{ goingCount: 1 }, { goingCount: 5 }, { goingCount: 3 }];

  it("orders Popular by who is actually coming", () => {
    expect(applyUpForFilter(items, "popular").map((i) => i.goingCount)).toEqual([5, 3, 1]);
  });

  it("never mutates the array it was given", () => {
    const original = [...items];
    applyUpForFilter(items, "popular");
    expect(items).toEqual(original);
  });

  it("keeps the registry honest about what each filter can do", () => {
    // The helpers stay for Stage 2, which brings back chips backed by real
    // data. Nearby needs proximity the session does not carry; for_you needs a
    // recommendation model that does not exist.
    expect(isUpForFilterAvailable("nearby")).toBe(false);
    expect(isUpForFilterAvailable("for_you")).toBe(false);
    expect(isUpForFilterAvailable("all")).toBe(true);
  });

  it("renders no filter chips at all until they can filter truthfully", () => {
    // Stage 1 removed the row rather than shipping controls with no backing:
    // a single "All" chip is not a filter, and the other three had nothing
    // behind them.
    for (const dead of ["Just for you", "See map", "All UpFors"]) {
      expect(page).not.toContain(dead);
    }
  });
});

describe("the card never claims more than the server said", () => {
  it("shows a broad area, never a distance", () => {
    expect(page).toContain("item.broadAreaText");
    for (const absent of ["km away", "miles away", "latitude", "longitude"]) {
      expect(page).not.toContain(absent);
    }
  });

  it("hides the join button when the server would refuse it", () => {
    // Already asked, or an owner who did not open this one to requests.
    expect(page).toContain("item.allowPings && !requested");
  });
});

describe("the safe area is reserved exactly once", () => {
  const shell = stripComments(read("components/app-shell/app-shell.tsx"));
  const css = read("app/globals.css");

  it("declares UpFor as drawing its own inline header", () => {
    // The blank band above the title came from /hangout-mode being in
    // PAGES_WITH_OWN_HEADER but NOT here: the shell stood its header down and
    // still reserved --mobile-header-height for it, so the inset was paid for
    // twice — once by that offset and once by the page header.
    const immersive = shell.slice(shell.indexOf("IMMERSIVE_HEADER_PAGES"));
    expect(immersive.slice(0, 200)).toContain('"/hangout-mode"');
  });

  it("clears the notch in the header and reserves it in the page, once each", () => {
    const header = css.slice(css.indexOf(".upfor-header {"));
    expect(header.slice(0, 900)).toContain("env(safe-area-inset-top, 0px)");
    expect(header.slice(0, 900)).toContain("position: fixed");

    const pageRule = css.slice(css.indexOf(".upfor-page {"));
    expect(pageRule.slice(0, 900)).toContain("padding-top: calc(env(safe-area-inset-top, 0px)");
  });

  it("uses no negative margins or device-specific offsets", () => {
    const block = css.slice(css.indexOf(".upfor-page {"), css.indexOf(".upfor-banner {"));
    expect(block).not.toMatch(/margin-top:\s*-/);
    expect(block).not.toContain("-webkit-device-pixel-ratio");
  });

  it("scrolls as one feed, with no nested vertical scroller", () => {
    expect(page).not.toContain("overflow-y-auto");
  });
});

describe("the rename is UI-only", () => {
  it("keeps the route, table and action names untouched", () => {
    expect(page).toContain("requestHangoutAction");
    expect(page).toContain("startHangoutAction");
    expect(actions).toContain('from("hangout_sessions")');
    expect(actions).toContain('from("hangout_requests")');
  });

  it("says UpFor everywhere a person reads it", () => {
    const shell = stripComments(read("components/app-shell/app-shell.tsx"));
    expect(shell).toContain('label: "UpFor"');
    expect(page).toContain("UpFor");
    // The old product name must not survive in visible copy.
    expect(page).not.toContain("Hangout Mode");
  });
});
