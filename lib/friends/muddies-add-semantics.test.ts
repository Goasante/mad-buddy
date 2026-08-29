import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * ONE ADD CONTROL, AND NO ICON THAT LIES.
 *
 * The defect these guard: Muddies carried three "add a person" affordances in
 * one viewport, and the most prominent of them did not add anybody.
 *
 *   page header      UserPlus glyph, labelled "Add Muddy",
 *                    navigating to /friends?tab=requests
 *   subtitle header  a second "Add Muddy" button
 *   search row       a SlidersHorizontal (filter/settings) glyph whose
 *                    onClick was setAddOpen
 *
 * So person-plus meant "requests", a filter icon meant "add", and the same
 * action had three entry points. These assert the corrected hierarchy:
 * requests wear a request affordance, and adding a Muddy happens in exactly
 * one place -- beside the search field, wearing person-plus.
 *
 * Structural rather than source-literal where possible: they count controls
 * and check what each one points at, so a layout change that keeps the
 * contract keeps passing.
 */

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");
const page = read("components/friends/friends-page.tsx");
const header = read("components/app-shell/mobile-page-header.tsx");

describe("the header request control tells the truth", () => {
  it("is named for requests, not for adding", () => {
    // Its destination has always been the Requests tab; only the wording and
    // the glyph were wrong.
    expect(header).toContain("/friends?tab=requests");
    expect(header).toMatch(/aria-label=\{[\s\S]*?Muddy requests/);
    expect(header, "the header still calls its requests control Add Muddy").not.toMatch(
      /title="Add Muddy"/
    );
  });

  it("keeps the pending badge, which is what a badge should mean", () => {
    expect(header).toContain("hasRequests ? <HeaderBadge count={incomingRequestCount} /> : null");
  });
});

describe("Muddies has exactly one Add control", () => {
  it("offers exactly one Add control alongside the list", () => {
    /* COUNTING CALL SITES WAS TOO BLUNT, and the test found out why: two of
       the three `setAddOpen(true)` call sites belong to FriendsEmptyState,
       which renders only when there is nothing to list. An empty Muddies page
       SHOULD offer a way to add somebody -- that is the whole point of an
       empty state -- and it never appears beside the search-row control.
       
       What must stay singular is the control that sits alongside a populated
       list. So the count excludes the empty-state handlers by name. */
    const openers = page.match(/setAddOpen\(true\)/g) ?? [];
    const emptyStateOpeners = page.match(/onAddFriends=\{\(\) => setAddOpen\(true\)\}/g) ?? [];
    expect(
      openers.length - emptyStateOpeners.length,
      "Muddies grew a second Add control beside the list"
    ).toBe(1);
    expect(emptyStateOpeners.length, "the empty states lost their Add action").toBeGreaterThan(0);
  });

  it("wears person-plus, beside the search field", () => {
    /* SLICED TO THE ROW'S OWN END, not to a byte count.
     *
     * This took a fixed 1600 characters after the search row opened, which
     * held on a LF checkout and broke on a CRLF one: the extra carriage
     * returns pushed the icon past the window, so the test reported a missing
     * control on a file it had not touched. Ending the slice at the row's
     * closing tag makes it independent of line endings and of any comment
     * length inside it. */
    const start = page.indexOf('className="muddies-search-row"');
    const end = page.indexOf("</div>", page.indexOf("</button>", start));
    const searchRow = page.slice(start, end);
    expect(searchRow).toContain('aria-label="Add a Muddy"');
    expect(searchRow).toContain("<UserPlus");
    // The control that opens Add must not depict a filter.
    expect(searchRow, "the Add control is wearing a filter icon again").not.toContain(
      "<SlidersHorizontal"
    );
  });

  it("no longer carries a duplicate Add Muddy button in the subtitle header", () => {
    expect(page, "the duplicate Add Muddy button is back").not.toMatch(/>\s*Add Muddy\s*</);
  });
});

describe("requests stay reachable while the page is simplified", () => {
  it("keeps Requests as a tab with its own count", () => {
    expect(page).toContain('{ id: "requests", label: "Requests" }');
    expect(page).toContain('tab.id === "requests" && receivedRequestCount > 0');
  });

  it("keeps a Requests destination the header can link to", () => {
    expect(page).toContain('selectTab("requests")');
  });
});

describe("card actions are reachable without a pointer", () => {
  const grid = read("components/friends/muddies-grid.tsx");

  it("gives the actions menu a real focusable trigger", () => {
    /* The trigger used to be aria-hidden, pointer-events-none and zero
       height, so Remove Muddy and Block -- a safety control -- could only be
       reached by press-and-hold. useLongPress binds no key handlers. */
    expect(grid).toContain("muddies-card-more");
    expect(grid).toMatch(/aria-label=\{`More actions for \$\{person\.displayName\}`\}/);
    expect(grid, "the actions trigger is hidden from assistive tech again").not.toMatch(
      /trigger=\{\s*<span aria-hidden="true"/
    );
  });

  it("keeps press-and-hold as well, rather than replacing it", () => {
    expect(grid).toContain("useLongPress");
  });
});

describe("Plan creation keeps the person it started from", () => {
  const profile = read("components/friends/muddy-profile-page.tsx");

  it("passes the Muddy to the canonical create sheet", () => {
    /* The Plans page has read `?with=` and seeded the invitee from it all
       along; this link simply never sent it, so "Create a plan" on somebody's
       profile opened an empty form with no trace of them. */
    expect(profile).toContain("create=1&with=");
    expect(profile).toContain("muddy.friendId");
  });

  it("routes to the canonical Plans surface rather than a second composer", () => {
    expect(profile).toContain("/plans?create=1");
  });
});
