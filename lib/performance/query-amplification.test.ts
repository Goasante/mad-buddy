import { describe, expect, it } from "vitest";

import { batchBlockedIds, batchEligibleMuddyIds } from "@/lib/social/permissions";

/**
 * THE N+1 REGRESSION SUITE.
 *
 * These do not test what a screen looks like. They test the one property that
 * decides whether a feature survives scale: that the number of database round
 * trips STOPS GROWING with the number of rows on the page.
 *
 * The shape being defended against is:
 *
 *     load N parents
 *     for each parent: ask the database one more question
 *
 * which is invisible at 10 rows and fatal at 1,000. Every case below runs the
 * real helper against a counting fake and asserts a CONSTANT query count
 * across a small input and a large one -- so a future edit that reintroduces a
 * per-row query fails here rather than in production.
 *
 * The fakes mimic only the PostgREST builder surface these helpers use. That
 * is deliberate: a heavier mock would start testing the mock.
 */

type Row = Record<string, unknown>;

/** Counts every table read, and answers with canned rows. */
function countingClient(rowsByTable: Record<string, Row[]>) {
  const calls: string[] = [];

  const builder = (table: string) => {
    const result = { data: rowsByTable[table] ?? [], error: null };
    // Every filter returns the same thenable, so any chain length resolves to
    // the canned rows and each `.from()` counts exactly one round trip.
    const chain: Record<string, unknown> = {
      select: () => chain,
      eq: () => chain,
      in: () => chain,
      is: () => chain,
      or: () => chain,
      not: () => chain,
      order: () => chain,
      limit: () => chain,
      maybeSingle: () => Promise.resolve({ data: (rowsByTable[table] ?? [])[0] ?? null, error: null }),
      single: () => Promise.resolve({ data: (rowsByTable[table] ?? [])[0] ?? null, error: null }),
      then: (resolve: (value: typeof result) => unknown) => Promise.resolve(result).then(resolve)
    };
    return chain;
  };

  return {
    client: {
      from: (table: string) => {
        calls.push(table);
        return builder(table);
      }
    },
    calls
  };
}

const userIds = (count: number, prefix = "u") =>
  Array.from({ length: count }, (_, index) => `${prefix}${index}`);

describe("batchBlockedIds answers a whole page in one query", () => {
  it("costs the same for 500 candidates as for 5", async () => {
    const run = async (size: number) => {
      const { client, calls } = countingClient({ blocked_users: [] });
      await batchBlockedIds(client as never, "viewer", userIds(size));
      return calls.length;
    };

    const small = await run(5);
    const large = await run(500);

    expect(small).toBe(1);
    expect(large).toBe(small);
  });

  it("still reports a block in either direction", async () => {
    const { client } = countingClient({
      blocked_users: [
        { blocker_id: "viewer", blocked_id: "they-blocked-by-me" },
        { blocker_id: "they-blocked-me", blocked_id: "viewer" }
      ]
    });

    const blocked = await batchBlockedIds(client as never, "viewer", [
      "they-blocked-by-me",
      "they-blocked-me",
      "unrelated"
    ]);

    expect(blocked.has("they-blocked-by-me")).toBe(true);
    expect(blocked.has("they-blocked-me")).toBe(true);
    expect(blocked.has("unrelated")).toBe(false);
  });
});

describe("batchEligibleMuddyIds answers a whole page in a fixed number of queries", () => {
  /* The Safe Arrival invited-journeys list used to ask "are you Muddies?" and
     "are you blocked?" once PER JOURNEY. This is the helper that replaced it. */
  it("costs the same for 300 travellers as for 3", async () => {
    const run = async (size: number) => {
      const { client, calls } = countingClient({ friendships: [], blocked_users: [] });
      await batchEligibleMuddyIds(client as never, "viewer", userIds(size));
      return calls.length;
    };

    const small = await run(3);
    const large = await run(300);

    expect(small).toBe(2);
    expect(large).toBe(small);
  });

  it("keeps a block winning over an active friendship", async () => {
    const { client } = countingClient({
      friendships: [
        { user_one_id: "viewer", user_two_id: "friend" },
        { user_one_id: "blocked-friend", user_two_id: "viewer" }
      ],
      blocked_users: [{ blocker_id: "blocked-friend", blocked_id: "viewer" }]
    });

    const eligible = await batchEligibleMuddyIds(client as never, "viewer", [
      "friend",
      "blocked-friend",
      "stranger"
    ]);

    expect(eligible.has("friend")).toBe(true);
    // Muddies AND blocked -> not eligible. Block is the stronger signal.
    expect(eligible.has("blocked-friend")).toBe(false);
    expect(eligible.has("stranger")).toBe(false);
  });

  it("never treats the viewer as their own candidate", async () => {
    const { client } = countingClient({ friendships: [], blocked_users: [] });
    const eligible = await batchEligibleMuddyIds(client as never, "viewer", ["viewer"]);
    expect(eligible.size).toBe(0);
  });
});
