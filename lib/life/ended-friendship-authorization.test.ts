import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { areApprovedMuddies, batchEligibleMuddyIds } from "@/lib/social/permissions";
import { collectFriendshipQuerySites } from "@/lib/life/friendship-query-guard";

/**
 * Ended friendships must not grant access.
 *
 * The bug class this exists to prevent: a friendship row survives unfriending
 * (it is soft-ended with `ended_at`, so the Life timeline can still be
 * rebuilt), and any read that forgets `ended_at IS NULL` keeps treating the
 * other person as a current Muddy. That is not a display bug — it is an
 * authorisation failure, and it is invisible in a happy-path test because
 * nothing has ended yet.
 *
 * Two layers here, and both are needed:
 *
 *  1. BEHAVIOUR — the canonical permission helpers are run against a fake
 *     Supabase client that actually applies the filters, so an ended row
 *     genuinely flows through the same query chain production uses.
 *  2. SURFACE COVERAGE — every feature that gates on friendship is checked to
 *     be reading through a filtered query, since a single helper being correct
 *     proves nothing about a page that queries the table directly.
 */

const ALICE = "11111111-1111-4111-8111-111111111111";
const BOB = "22222222-2222-4222-8222-222222222222";
const CARA = "33333333-3333-4333-8333-333333333333";

type FriendshipRow = {
  user_one_id: string;
  user_two_id: string;
  ended_at: string | null;
};

/**
 * A minimal Supabase query-builder stand-in.
 *
 * Deliberately implements `.is("ended_at", null)` for real rather than
 * recording that it was called: a mock that only asserts "the filter was
 * requested" would pass even if the filter were applied to the wrong column,
 * which is exactly the mistake this phase already made once.
 */
function fakeAdmin(friendships: FriendshipRow[], blocks: { blocker_id: string; blocked_id: string }[] = []) {
  const build = (rows: Record<string, unknown>[]) => {
    let current = rows;
    const builder = {
      select: () => builder,
      limit: (count: number) => {
        current = current.slice(0, count);
        return builder;
      },
      is: (column: string, value: null) => {
        current = current.filter((row) => (value === null ? row[column] === null : row[column] === value));
        return builder;
      },
      /** Handles the `or(and(...),and(...))` and `a.eq.x,b.eq.y` shapes used by the helpers. */
      or: (expression: string) => {
        const groups = expression.match(/and\([^)]*\)/g);
        if (groups) {
          current = current.filter((row) =>
            groups.some((group) =>
              group
                .slice(4, -1)
                .split(",")
                .every((clause) => {
                  const [column, , value] = clause.split(".");
                  return row[column!] === value;
                })
            )
          );
          return builder;
        }
        const clauses = expression.split(",").map((clause) => clause.split("."));
        current = current.filter((row) => clauses.some(([column, , value]) => row[column!] === value));
        return builder;
      },
      then: (resolve: (result: { data: Record<string, unknown>[] }) => unknown) => resolve({ data: current })
    };
    return builder;
  };

  return {
    from: (table: string) =>
      build(
        table === "friendships"
          ? (friendships as unknown as Record<string, unknown>[])
          : (blocks as unknown as Record<string, unknown>[])
      )
  } as never;
}

const ACTIVE: FriendshipRow = { user_one_id: ALICE, user_two_id: BOB, ended_at: null };
const ENDED: FriendshipRow = { user_one_id: ALICE, user_two_id: BOB, ended_at: "2026-01-01T00:00:00.000Z" };

// ---------------------------------------------------------------------------
// The canonical helper
// ---------------------------------------------------------------------------

describe("areApprovedMuddies", () => {
  it("treats an active friendship as current Muddies", async () => {
    expect(await areApprovedMuddies(fakeAdmin([ACTIVE]), ALICE, BOB)).toBe(true);
  });

  it("does NOT treat an ended friendship as current Muddies", async () => {
    // The whole point of the phase: the row still exists, so a query without
    // the filter would return it and answer "yes".
    expect(await areApprovedMuddies(fakeAdmin([ENDED]), ALICE, BOB)).toBe(false);
  });

  it("answers the same regardless of which side asks", async () => {
    expect(await areApprovedMuddies(fakeAdmin([ENDED]), BOB, ALICE)).toBe(false);
    expect(await areApprovedMuddies(fakeAdmin([ACTIVE]), BOB, ALICE)).toBe(true);
  });

  it("does not treat strangers as Muddies", async () => {
    expect(await areApprovedMuddies(fakeAdmin([ACTIVE]), ALICE, CARA)).toBe(false);
  });
});

describe("batchEligibleMuddyIds", () => {
  it("keeps active Muddies and drops ended ones", async () => {
    const admin = fakeAdmin([
      { user_one_id: ALICE, user_two_id: BOB, ended_at: "2026-01-01T00:00:00.000Z" },
      { user_one_id: ALICE, user_two_id: CARA, ended_at: null }
    ]);
    const eligible = await batchEligibleMuddyIds(admin, ALICE, [BOB, CARA]);
    expect([...eligible]).toEqual([CARA]);
  });

  it("matches the single-pair helper, so batching is not a loophole", async () => {
    // These two paths gate the same features (plan invites, Hangout audience).
    // If they ever disagree, one surface silently becomes the soft spot.
    const admin = () => fakeAdmin([ENDED]);
    const batched = await batchEligibleMuddyIds(admin(), ALICE, [BOB]);
    expect(batched.has(BOB)).toBe(await areApprovedMuddies(admin(), ALICE, BOB));
    expect(batched.has(BOB)).toBe(false);
  });

  it("still drops a blocked user who is an active Muddy", async () => {
    // Blocking overrides friendship; the ended_at work must not have weakened it.
    const admin = fakeAdmin(
      [{ user_one_id: ALICE, user_two_id: BOB, ended_at: null }],
      [{ blocker_id: BOB, blocked_id: ALICE }]
    );
    expect([...(await batchEligibleMuddyIds(admin, ALICE, [BOB]))]).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Surface coverage
// ---------------------------------------------------------------------------

/**
 * Every feature that gates on friendship, and the file that decides it.
 *
 * A surface is correct one of two ways, and both are accepted:
 *
 *  - `query`  it reads `friendships` directly, and that read must filter.
 *  - `helper` it delegates to the permission service, whose own behaviour is
 *             proven by the tests above.
 *
 * Which one a surface uses is recorded rather than assumed, so a surface that
 * silently stops gating at all — no query AND no helper — fails here instead
 * of quietly passing a filter check that has nothing to check.
 *
 * Asserting per-surface rather than globally means a regression names the
 * feature it broke: "Moments visibility reads ended friendships" is actionable
 * in a way that "1 unguarded query" is not.
 */
const GATED_SURFACES: { feature: string; file: string; via: "query" | "helper" }[] = [
  { feature: "Moments visibility", file: "lib/content/service.ts", via: "query" },
  { feature: "Moments audience picker", file: "app/(app)/moments/page.tsx", via: "query" },
  { feature: "messaging eligibility", file: "lib/messaging/service.ts", via: "helper" },
  { feature: "Socialize eligibility", file: "app/(app)/social-actions.ts", via: "query" },
  { feature: "friend lists", file: "app/(app)/friends/page.tsx", via: "query" },
  { feature: "Plans invitee list", file: "app/(app)/plans/page.tsx", via: "query" },
  { feature: "Hangout mode", file: "app/(app)/hangout-mode/page.tsx", via: "query" },
  { feature: "the shared permission service", file: "lib/social/permissions.ts", via: "query" }
];

const HELPERS = ["areApprovedMuddies", "batchEligibleMuddyIds", "canViewerAccessFeature"];

describe("friendship-gated surfaces read active friendships only", () => {
  const sites = collectFriendshipQuerySites(process.cwd());

  for (const { feature, file, via } of GATED_SURFACES) {
    it(`${feature} (${file})`, () => {
      const forFile = sites.filter((site) => site.file === file && site.kind === "read");

      if (via === "helper") {
        const source = readFileSync(join(process.cwd(), file), "utf8");
        expect(
          HELPERS.some((helper) => source.includes(helper)),
          `expected ${file} to gate through the permission service`
        ).toBe(true);
      } else {
        // A surface with no query at all would make the filter assertion
        // vacuous, so the presence of the query is itself asserted.
        expect(forFile.length, `expected ${file} to read friendships`).toBeGreaterThan(0);
      }

      const unfiltered = forFile.filter((site) => !site.hasEndedFilter && !site.annotatedHistorical);
      expect(unfiltered.map((site) => `${site.file}:${site.line}`)).toEqual([]);
    });
  }
});

describe("historical reads still see ended friendships", () => {
  const sites = collectFriendshipQuerySites(process.cwd());

  it("the Life rebuild replays ended relationships", () => {
    // If rebuild started filtering on ended_at, unfriending would erase the
    // timeline it exists to preserve — the opposite failure, equally wrong.
    const rebuild = sites.filter((site) => site.file === "lib/life/rebuild.ts");
    expect(rebuild.length).toBeGreaterThan(0);
    expect(rebuild.every((site) => site.annotatedHistorical && !site.hasEndedFilter)).toBe(true);
  });

  it("the account export includes ended friendships", () => {
    // A data-rights export that hid history would be an incomplete answer.
    const exportSites = sites.filter((site) => site.file === "app/api/account/export/route.ts");
    expect(exportSites.length).toBeGreaterThan(0);
    expect(exportSites.every((site) => site.annotatedHistorical)).toBe(true);
  });
});
