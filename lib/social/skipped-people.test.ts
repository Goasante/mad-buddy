import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { skipExpiryLabel } from "@/lib/social/skipped-people-shared";
import { stripComments } from "@/lib/content/strip-comments";

/**
 * Guards for skip recovery.
 *
 * A left swipe is easy to trigger by accident. Before this, the only undo held
 * the LAST skip in React state — a reload lost it and the person was gone for
 * 30 days. These assert that recovery survives a reload, and that offering it
 * does not leak anything a skip was never allowed to expose.
 */

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");
const loader = stripComments(read("lib/social/skipped-people.ts"));
const sheet = stripComments(read("components/socialize/skipped-people-sheet.tsx"));
const deck = stripComments(read("components/socialize/swipe-deck.tsx"));
const actions = stripComments(read("app/(app)/social-actions.ts"));

describe("a mistaken skip is recoverable after a reload", () => {
  it("reads the persisted rows rather than in-memory state", () => {
    expect(loader).toContain('from("discovery_passes")');
  });

  it("keeps the recovery control usable when nothing is in session", () => {
    // A disabled recovery control is worst exactly when it is needed: after a
    // reload, when the in-memory undo is already gone.
    expect(deck).toContain("onUndo ? onUndo() : onOpenSkipped?.()");
    expect(deck).toContain('aria-label={onUndo ? "Undo last skip" : "See people you skipped"}');
  });

  it("restores through the same action the in-deck undo uses", () => {
    expect(sheet).toContain("undoPassAction(person.userId)");
  });

  it("puts the most recent skip first, where a mistake almost always is", () => {
    expect(loader).toContain('.order("created_at", { ascending: false })');
  });

  it("reloads discovery after a restore, so the person returns to the deck", () => {
    const page = stripComments(read("components/socialize/socialize-page.tsx"));
    expect(page).toContain("onRestored={");
    expect(page).toContain("discoverSocializePeopleAction()");
  });
});

describe("the list is findable", () => {
  const page = stripComments(read("components/socialize/socialize-page.tsx"));
  const sheetChrome = stripComments(read("components/dashboard/quick-controls-sheet.tsx"));

  it("has a labelled entry, not only an icon", () => {
    // The deck's circular arrow opens this too, but an icon that sometimes
    // undoes and sometimes opens a list does not tell anyone the list exists.
    expect(page).toContain("People you skipped");
    expect(page).toContain("Bring back anyone you passed by mistake");
  });

  it("adds the entry through a slot, so Home does not inherit it", () => {
    // Quick Controls is shared. A hardcoded Linkr row would be a control that
    // does nothing on Home.
    expect(sheetChrome).toContain("extraShortcuts");
    const home = stripComments(read("components/dashboard/dashboard-page.tsx"));
    expect(home).not.toContain("People you skipped");
  });
});

describe("the list stays the viewer's own", () => {
  it("is scoped to the caller, never to who skipped them", () => {
    expect(loader).toContain('.eq("user_id", viewerId)');
    expect(loader).not.toMatch(/\.eq\("passed_user_id", viewerId\)/);
  });

  it("takes the viewer id from the session, not the caller", () => {
    const action = actions.slice(actions.indexOf("export async function loadSkippedPeopleAction"));
    expect(action).toContain("const userId = await getAuthedUserId()");
    expect(action).toContain("loadSkippedPeople(userId)");
  });

  it("shows identity but never where somebody is", () => {
    // Recovering a card must not become a way to watch a person the viewer is
    // not currently being shown.
    expect(loader).toContain('.select("user_id, full_name, username, avatar_url")');
    for (const absent of ["presence", "proximity", "latitude", "longitude", "distance", "activity"]) {
      expect(loader.toLowerCase()).not.toContain(absent);
    }
  });

  it("hides skips that have already lapsed", () => {
    // Offering to undo something that no longer applies is noise.
    expect(loader).toContain('.gt("expires_at"');
  });
});

describe("the client bundle stays free of the admin client", () => {
  it("keeps the label helper out of the server-only module", () => {
    // Importing it from there dragged the service-role client into the browser
    // bundle. tsc does not catch this; only `next build` does.
    const shared = stripComments(read("lib/social/skipped-people-shared.ts"));
    expect(shared).not.toContain('import "server-only"');
    expect(shared).not.toContain("createSupabaseAdminClient");
    expect(shared).toContain("export function skipExpiryLabel");
  });

  it("keeps the loader server-only", () => {
    expect(loader).toContain('import "server-only"');
  });

  it("has the client sheet import only from the shared module", () => {
    expect(sheet).toContain('from "@/lib/social/skipped-people-shared"');
    expect(sheet).not.toContain('from "@/lib/social/skipped-people"');
  });
});

describe("the expiry is stated, not hidden", () => {
  const day = 24 * 60 * 60 * 1000;
  const now = Date.parse("2026-08-08T12:00:00.000Z");

  it("counts whole days remaining", () => {
    expect(skipExpiryLabel(new Date(now + 12 * day).toISOString(), now)).toBe("Back in 12 days");
  });

  it("rounds up rather than reporting zero for something happening tomorrow", () => {
    expect(skipExpiryLabel(new Date(now + 0.4 * day).toISOString(), now)).toBe("Back tomorrow");
  });

  it("reports a lapsed skip as already back", () => {
    expect(skipExpiryLabel(new Date(now - day).toISOString(), now)).toBe("Back now");
  });

  it("never crashes on an unparseable date", () => {
    expect(skipExpiryLabel("not-a-date", now)).toBe("Back now");
  });

  it("tells the user skipping was private", () => {
    // The one fact that makes the feature safe to use: they were never told.
    expect(sheet).toContain("they were never told");
  });
});
