import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { stripComments } from "@/lib/content/strip-comments";

/**
 * Known people stay visible while proximity is revalidated.
 *
 * Home received only a COUNT of nearby Muddies and then asked the browser to
 * fetch the same people again. Starting from zero meant a screen the server
 * could render complete began empty -- and a guard added to paper over that
 * ("wait while the server says there are people") had no exit, so once the
 * client list settled empty the skeleton was permanent.
 */

const home = stripComments(readFileSync("components/dashboard/dashboard-page.tsx", "utf8"));
/* Raw source for slices that must match real formatting: stripComments
 * reflows the file, so an offset taken from it can land mid-expression. */
const homeRaw = readFileSync("components/dashboard/dashboard-page.tsx", "utf8").replace(
  /\r\n/g,
  "\n"
);
const fetchBlock = homeRaw.slice(
  homeRaw.indexOf("const loadNearbyFriends"),
  homeRaw.indexOf("usePullRefreshListener(loadNearbyFriends)")
);
const projection = stripComments(readFileSync("lib/activation/projection.ts", "utf8"));
const nearSection = home.slice(
  home.indexOf("function NearbyHero"),
  home.indexOf("// First-time quick actions")
);

describe("the server hands over the people, not a number", () => {
  it("exposes the safe nearby projection", () => {
    expect(projection).toContain("nearby: SafeNearbyFriend[];");
    expect(projection).toContain("loadNearbyForUser(admin, userId)");
  });

  it("reuses the one proximity service", () => {
    /* No second algorithm, no parallel freshness rule: the same call whose
     * result already produced nearbyMuddyCount. */
    expect(projection).not.toContain("loadNearbyForHome");
    expect(projection.split("loadNearbyForUser(").length - 1).toBe(1);
  });

  it("reaches Home through the route", () => {
    const route = stripComments(readFileSync("app/(app)/dashboard/page.tsx", "utf8"));
    expect(route).toContain("serverNearby={activation?.nearby ?? []}");
  });

  it("adds no location precision to the browser", () => {
    /* The same safe shape the nearby route returns: bands, never coordinates.
     * The client type is the contract. */
    const shape = home.slice(home.indexOf("type NearbyFriendApiItem"), home.indexOf("type DashboardPageContentProps"));
    for (const leak of ["latitude", "longitude", "distance", "metres", "coordinates", "geohash"]) {
      expect(shape).not.toContain(leak);
    }
  });
});

describe("Home starts from what the server knew", () => {
  it("seeds the client list rather than starting empty", () => {
    expect(home).toContain("useState<DashboardFriend[]>(() =>");
    expect(home).toContain("serverNearby.map(toDashboardFriend)");
  });

  it("treats hydrated people as already known", () => {
    // Nothing is unknown when the server supplied people, so no skeleton phase.
    expect(home).toContain("useState(serverNearby.length > 0)");
  });

  it("maps through the existing converter", () => {
    // One shape, one mapper -- the API and the projection agree.
    expect(home).toContain("function toDashboardFriend");
  });
});

describe("the skeleton always terminates", () => {
  it("depends only on whether anything is known yet", () => {
    const guard = nearSection.slice(nearSection.indexOf("{total === 0 &&"));
    expect(guard.slice(0, 60)).toContain("total === 0 && !loaded ?");
  });

  it("has no clause that can stay true forever", () => {
    /* THE DEADLOCK. `!loaded || serverNearbyCount > 0` never cleared once the
     * client list settled empty while the server had people. */
    expect(nearSection).not.toMatch(/!loaded \|\|/);
  });

  it("is settled by the fetch either way", () => {
    expect(fetchBlock).toContain(".finally(");
    expect(fetchBlock).toContain("setNearbyLoaded(true)");
  });
});

describe("revalidation never blanks known people", () => {
  it("keeps whatever is rendered when a refresh fails", () => {
    const failure = fetchBlock.slice(fetchBlock.indexOf(".catch("));
    // Only a status message: the list itself is untouched.
    expect(failure).toContain("setStatusMessage(");
    expect(failure).not.toContain("setFriends([])");
  });

  it("never clears the list before a refresh begins", () => {
    expect(fetchBlock).not.toContain("setFriends([])");
    expect(fetchBlock).not.toContain("setNearbyLoaded(false)");
  });

  it("replaces the list only with a completed result", () => {
    expect(fetchBlock).toContain("setFriends(friends.map(toDashboardFriend))");
  });

  it("leaks no location in its diagnostics", () => {
    for (const leak of ["latitude", "longitude", "coordinates"]) {
      expect(fetchBlock).not.toContain(leak);
    }
  });
});

describe("no refetch loop", () => {
  it("keeps the fetch callback stable", () => {
    /* An unstable dependency list would re-create the callback, re-run the
     * effect, and restart the cycle. Asserted on the callback's own closing
     * dependency array rather than the slice's last characters, which include
     * the trailing comment block. */
    expect(fetchBlock).toContain("}, []);");
    // ...and it is the ONLY dependency array in that callback.
    expect(fetchBlock.match(/\}, \[[^\]]*\]\);/g)).toEqual(["}, []);"]);
  });

  it("runs the initial load from a stable effect", () => {
    /* Raw source, and shape-tolerant: the effect depends only on the stable
       callback above, so it runs once rather than on every render. */
    expect(homeRaw).toMatch(
      /useEffect\(\(\) => \{\s*loadNearbyFriends\(\);\s*\}, \[loadNearbyFriends\]\);/
    );
  });

  it("does not remount the section on unrelated state", () => {
    // No key derived from changing data.
    expect(nearSection).not.toContain("key={friends");
    expect(home).not.toContain("<NearbyHero key=");
  });
});

describe("both approved layouts still hydrate", () => {
  it("keeps the single-nearby hero, now scoped to a count of exactly one", () => {
    expect(nearSection).toContain("friends.length === 1 ? friends[0] : null");
    expect(nearSection).toContain('size="lg"');
  });

  it("replaces the vertical supporting list with one horizontal rail", () => {
    /* "Also close" grew Home taller with every extra nearby Muddy, which is a
     * contact list rather than a proximity moment. Two or more people now share
     * the rail as equals and it scrolls sideways instead. */
    expect(nearSection).not.toContain("Also close");
    expect(nearSection).not.toContain("NEARBY_SUPPORTING_LIMIT");
    expect(nearSection).toContain("overflow-x-auto");
  });

  it("needs no See all, because the rail hides nobody", () => {
    expect(nearSection).not.toContain("hiddenCount");
  });
});

describe("Prompt 3H's Wave work is untouched", () => {
  it("still reads Wave availability from the server", () => {
    expect(home).toContain("relationshipFocus.waveAvailable && !wavedMuddyIds.has(");
    expect(home).not.toContain("waveAvailable: true");
  });

  it("still treats a cooldown as a refusal", () => {
    const action = readFileSync("app/(app)/social-actions.ts", "utf8");
    const cooldown = action.slice(action.indexOf("if (cooldownRemaining > 0)"));
    expect(cooldown.slice(0, 700)).toContain("ok: false");
  });

  it("needs no Wave row for Nearby to render", () => {
    // Nearby hydration reads nothing from the waves table.
    /* Scoped to the nearby CALL, not the whole file: loadRelationshipFocus
     * legitimately reads waves for the cooldown further down. */
    const call = projection.slice(projection.indexOf("loadNearbyForUser(admin, userId)"));
    expect(call.slice(0, 200)).not.toContain('from("waves")');
  });
});
