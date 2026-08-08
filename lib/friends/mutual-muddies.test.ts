import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { stripComments } from "@/lib/content/strip-comments";
import {
  MUTUAL_AVATAR_LIMIT,
  friendIdsFrom,
  mutualMuddyIds,
  summariseMutuals,
  summariseMutualsForMany
} from "@/lib/friends/mutual-muddies";

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");
const page = stripComments(read("app/(app)/friends/page.tsx"));

const edge = (one: string, two: string) => ({ user_one_id: one, user_two_id: two });

describe("a friendship is an unordered pair", () => {
  it("finds the friend whichever column they sit in", () => {
    const ids = friendIdsFrom("me", [edge("me", "ama"), edge("kobby", "me")]);
    expect([...ids].sort()).toEqual(["ama", "kobby"]);
  });

  it("ignores edges that do not involve the viewer", () => {
    expect(friendIdsFrom("me", [edge("ama", "kobby")]).size).toBe(0);
  });

  it("never counts the viewer as their own friend", () => {
    expect(friendIdsFrom("me", [edge("me", "me")]).has("me")).toBe(false);
  });
});

describe("mutual Muddies are the people both sides know", () => {
  it("returns only the overlap", () => {
    const viewer = new Set(["ama", "kobby", "efua"]);
    const theirs = new Set(["kobby", "efua", "yaw"]);
    expect(mutualMuddyIds(viewer, "david", theirs)).toEqual(["kobby", "efua"]);
  });

  it("excludes the other person from their own mutual list", () => {
    // Otherwise anyone already your friend counts themselves, and every
    // existing Muddy reads as one mutual higher than they are.
    const viewer = new Set(["ama", "david"]);
    const theirs = new Set(["ama", "david"]);
    expect(mutualMuddyIds(viewer, "david", theirs)).toEqual(["ama"]);
  });

  it("is empty when nobody overlaps", () => {
    expect(mutualMuddyIds(new Set(["ama"]), "david", new Set(["yaw"]))).toEqual([]);
  });
});

describe("the count is the truth, the faces are a preview", () => {
  it("reports the real total even when more than fit", () => {
    const viewer = new Set(["a", "b", "c", "d", "e"]);
    const theirs = new Set(["a", "b", "c", "d", "e"]);
    const summary = summariseMutuals(viewer, "david", theirs);

    // Showing "3 mutual Muddies" because three faces fit would under-report
    // someone with twenty.
    expect(summary.count).toBe(5);
    expect(summary.previewIds).toHaveLength(MUTUAL_AVATAR_LIMIT);
  });

  it("previews fewer than the cap without padding", () => {
    const summary = summariseMutuals(new Set(["a"]), "david", new Set(["a"]));
    expect(summary.count).toBe(1);
    expect(summary.previewIds).toEqual(["a"]);
  });
});

describe("many people are summarised from one batch of edges", () => {
  const viewerFriends = new Set(["ama", "kobby", "efua"]);
  const edges = [
    // David knows Ama and Kobby (both mutual), plus Yaw (not mutual).
    edge("david", "ama"),
    edge("kobby", "david"),
    edge("david", "yaw"),
    // Serwaa knows Efua only.
    edge("serwaa", "efua"),
    // An edge between two people neither side is being summarised for.
    edge("yaw", "nana")
  ];

  it("computes each person against the viewer's own friends", () => {
    const result = summariseMutualsForMany("me", viewerFriends, ["david", "serwaa"], edges);
    expect(result.get("david")?.count).toBe(2);
    expect(result.get("serwaa")?.count).toBe(1);
  });

  it("returns an entry for everyone asked about, even at zero", () => {
    // A missing entry would render as "undefined mutual" rather than nothing.
    const result = summariseMutualsForMany("me", viewerFriends, ["david", "stranger"], edges);
    expect(result.has("stranger")).toBe(true);
    expect(result.get("stranger")?.count).toBe(0);
  });

  it("never counts the viewer as a mutual of anyone", () => {
    // The requester is usually connected to the viewer through the very
    // request being answered; counting that would inflate every row by one.
    const withViewer = [...edges, edge("david", "me")];
    const result = summariseMutualsForMany("me", new Set([...viewerFriends, "me"]), ["david"], withViewer);
    expect(result.get("david")?.previewIds).not.toContain("me");
    expect(result.get("david")?.count).toBe(2);
  });

  it("orders the preview stably, so faces do not shuffle between renders", () => {
    const first = summariseMutualsForMany("me", viewerFriends, ["david"], edges);
    const second = summariseMutualsForMany("me", viewerFriends, ["david"], edges);
    expect(first.get("david")?.previewIds).toEqual(second.get("david")?.previewIds);
  });
});

// ---------------------------------------------------------------------------
// Wiring
// ---------------------------------------------------------------------------

describe("the page reads mutuals once, not per row", () => {
  it("batches every edge into a single query", () => {
    // One `.or(...)` covering the whole list. A per-row read here would be an
    // N+1 on a page that renders a request list plus every friend.
    expect(page).toContain('.from("friendships")');
    expect(page).toContain("summariseMutualsForMany");
    expect(page).toContain("const orFilter =");
  });

  it("only counts active friendships", () => {
    // ended_at IS NULL is the canonical definition of "currently Muddies";
    // without it a removed friend would still count as mutual.
    const query = page.slice(page.indexOf("const orFilter ="));
    expect(query.slice(0, 400)).toContain('.is("ended_at", null)');
  });

  it("never computes mutuals for a blocked user", () => {
    // Who you both know is social-graph information, and blocking is a request
    // to stop being shown that person's world.
    expect(page).toContain("mutualSubjectIds = [...profileIds].filter((id) => !blockedIds.has(id))");
    const blockedRow = page.slice(page.indexOf('status: "blocked"') - 400);
    expect(blockedRow.slice(0, 400)).toContain("mutualFriends: 0");
  });

  it("skips the query entirely when there is nobody to summarise", () => {
    expect(page).toContain("if (mutualSubjectIds.length > 0)");
  });
});
