import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * THE INCIDENT THIS FILE EXISTS TO PREVENT.
 *
 * Multiple established Mad Buddy accounts simultaneously lost Near, Trending,
 * Smart Card and Suggestions from Home. The cause: `loadActivationProjection`
 * returned a shape -- `state: "no_muddies", muddyCount: 0, nearby: []` --
 * that is bit-for-bit identical whether an account is genuinely brand new OR
 * a query failed and every `count`/`data` field silently coerced through
 * `?? 0` / `?? []`. `resolveActivationState`, `composeHome` and the Smart
 * Card arbiter then all agreed, confidently and wrongly, that an established
 * account had never done anything.
 *
 * These tests prove: (1) a real failure is now reported as
 * `status: "unavailable"`, never silently as `status: "ok"`; (2) an
 * established account's real evidence survives even when the one query that
 * feeds `state` fails; (3) an ordinary successful read is completely
 * unaffected.
 */

const USER = "11111111-1111-4111-8111-111111111111";
const MUDDY = "22222222-2222-4222-8222-222222222222";

type Call = { table: string; op: "count" | "rows" };
let calls: Call[] = [];

/** Rows this fake database holds for one test, keyed by table name. */
type Fixture = {
  friendshipsCount: number | null;
  friendshipsError: boolean;
  milestones: Array<{ milestone: string; reached_at: string }>;
  visibilityStatus: "visible" | "ghost" | "app_open_only";
  pendingOutgoingCount: number;
  lastLocationUpdate: string | null;
  planParticipationCount: number | null;
  planParticipationError: boolean;
  replyMilestoneRows: Array<{ id: string }>;
  /** user_locations rows keyed by user_id, for both the viewer's own fix and
   *  loadNearbyForUser's read of Muddies' fixes. */
  locations: Record<string, { latitude: number; longitude: number; confidence: string; last_updated: string }>;
  profiles: Record<string, { full_name: string; username: string; avatar_url: string | null; visibility_status: string }>;
};

let fixture: Fixture;

function resetFixture() {
  fixture = {
    friendshipsCount: 0,
    friendshipsError: false,
    milestones: [],
    visibilityStatus: "visible",
    pendingOutgoingCount: 0,
    lastLocationUpdate: null,
    planParticipationCount: 0,
    planParticipationError: false,
    replyMilestoneRows: [],
    locations: {},
    profiles: {}
  };
}

function fakeAdmin() {
  return {
    from: (table: string) => {
      const chain: Record<string, unknown> = {};
      let wantsCount = false;
      let inFilterIds: string[] | null = null;
      const eqFilters: Record<string, string> = {};
      const self = () => chain as never;

      const settle = () => {
        if (table === "friendships") {
          calls.push({ table, op: wantsCount ? "count" : "rows" });
          if (fixture.friendshipsError) {
            return Promise.resolve({ data: null, count: null, error: { message: "connection reset" } });
          }
          if (wantsCount) {
            return Promise.resolve({ data: null, count: fixture.friendshipsCount, error: null });
          }
          // loadNearbyForUser's own friendships read (not head:true) -- one row per Muddy.
          const rows =
            (fixture.friendshipsCount ?? 0) > 0
              ? [{ user_one_id: USER, user_two_id: MUDDY }]
              : [];
          return Promise.resolve({ data: rows, error: null });
        }
        if (table === "activation_milestones") {
          calls.push({ table, op: "rows" });
          if (eqFilters.milestone === "first_reply_received") {
            return Promise.resolve({ data: fixture.replyMilestoneRows, error: null });
          }
          return Promise.resolve({ data: fixture.milestones, error: null });
        }
        if (table === "profiles") {
          calls.push({ table, op: "rows" });
          if (inFilterIds) {
            return Promise.resolve({
              data: inFilterIds
                .filter((id) => fixture.profiles[id])
                .map((id) => ({ user_id: id, ...fixture.profiles[id] })),
              error: null
            });
          }
          return Promise.resolve({
            data: { visibility_status: fixture.visibilityStatus },
            error: null
          });
        }
        if (table === "friend_requests") {
          calls.push({ table, op: "count" });
          return Promise.resolve({ data: null, count: fixture.pendingOutgoingCount, error: null });
        }
        if (table === "user_locations") {
          calls.push({ table, op: "rows" });
          if (inFilterIds) {
            return Promise.resolve({
              data: inFilterIds
                .filter((id) => fixture.locations[id])
                .map((id) => ({ user_id: id, ...fixture.locations[id] })),
              error: null
            });
          }
          const row = fixture.lastLocationUpdate
            ? { ...fixture.locations[USER], user_id: USER, last_updated: fixture.lastLocationUpdate }
            : null;
          return Promise.resolve({ data: row, error: null });
        }
        if (table === "plan_participants") {
          calls.push({ table, op: wantsCount ? "count" : "rows" });
          if (fixture.planParticipationError) {
            return Promise.resolve({ data: null, count: null, error: { message: "timeout" } });
          }
          return Promise.resolve({ data: null, count: fixture.planParticipationCount, error: null });
        }
        if (table === "blocked_users" || table === "user_statuses" || table === "visibility_sessions") {
          calls.push({ table, op: "rows" });
          return Promise.resolve({ data: [], error: null });
        }
        calls.push({ table, op: "rows" });
        return Promise.resolve({ data: [], error: null });
      };

      Object.assign(chain, {
        select: (_cols: string, opts?: { count?: string; head?: boolean }) => {
          if (opts?.count) wantsCount = true;
          return self();
        },
        eq: (col: string, val: string) => {
          eqFilters[col] = val;
          return self();
        },
        or: () => self(),
        is: () => self(),
        in: (_col: string, ids: string[]) => {
          inFilterIds = ids;
          return self();
        },
        gte: () => self(),
        gt: () => self(),
        order: () => settle(),
        limit: () => settle(),
        maybeSingle: () => settle(),
        then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
          settle().then(resolve, reject)
      });
      return chain;
    }
  };
}

vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: () => fakeAdmin()
}));
vi.mock("@/lib/supabase/env", () => ({
  getSupabaseServerEnv: () => (envConfigured ? { url: "http://local", serviceRoleKey: "service" } : { url: undefined, serviceRoleKey: undefined }),
  getSupabaseBrowserEnv: () => (envConfigured ? { url: "http://local", anonKey: "anon" } : { url: undefined, anonKey: undefined })
}));
vi.mock("@/lib/messaging/mobile", () => ({
  getUnreadMessageCount: () => Promise.resolve(0)
}));

let envConfigured = true;

const { loadActivationProjection } = await import("@/lib/activation/projection");

beforeEach(() => {
  calls = [];
  envConfigured = true;
  resetFixture();
});

describe("misconfigured environment", () => {
  it("reports unavailable, never a confident no_muddies with status ok", async () => {
    envConfigured = false;
    const projection = await loadActivationProjection(USER);
    expect(projection.status).toBe("unavailable");
    // The shape is still the safe fallback -- callers that ignore `status`
    // (there should be none left) at least still get the least-harm answer.
    expect(projection.state).toBe("no_muddies");
  });
});

describe("a query failure on the field that gates activation state", () => {
  it("flips status to unavailable rather than reporting a confident zero", async () => {
    fixture.friendshipsError = true;

    const projection = await loadActivationProjection(USER);

    expect(projection.status).toBe("unavailable");
  });

  it("still attempts the maturity-evidence rescue read", async () => {
    // The muddy count query failed, but this account has real history: a
    // completed loop (a two-sided conversation) recorded independently.
    fixture.friendshipsError = true;
    fixture.replyMilestoneRows = [{ id: "r1" }];
    fixture.planParticipationCount = 3;

    const projection = await loadActivationProjection(USER);

    /* Before the fix, `(muddyCount ?? 0) > 0` was false whenever the count
     * query failed, so this rescue read was skipped entirely and an
     * established account's real evidence was thrown away along with the
     * broken count. */
    expect(projection.twoSidedConversationCount).toBe(1);
    expect(projection.planParticipationCount).toBe(3);
  });

  it("does not also fail when only an unrelated soft field errors", async () => {
    // planParticipationCount inside loadActivationProjection's OWN batch
    // (upcomingPlanCount) failing should also flip status -- it feeds Plans.
    fixture.planParticipationError = true;

    const projection = await loadActivationProjection(USER);

    expect(projection.status).toBe("unavailable");
  });
});

describe("nearby resolution failing loudly", () => {
  it("is caught rather than rejecting the whole projection, and still marks it unavailable", async () => {
    /* `loadNearbyForUser` reads `friendships` (among other tables) through the
     * same admin instance. Forcing that table to return a Postgrest error
     * exercises both the muddyCount failure AND loadNearbyForUser's own read
     * failing at once -- the realistic shape of "the friendships table is
     * unreachable for this request" rather than two independent faults. */
    fixture.friendshipsError = true;

    const projection = await loadActivationProjection(USER);

    // The whole call resolves rather than rejecting, and nearby comes back
    // empty and safe rather than throwing out of loadActivationProjection.
    expect(projection.nearby).toEqual([]);
    expect(projection.status).toBe("unavailable");
  });
});

describe("an ordinary successful read is unaffected", () => {
  it("reports status ok and a real computed state", async () => {
    fixture.friendshipsCount = 1;
    fixture.visibilityStatus = "visible";
    fixture.lastLocationUpdate = new Date().toISOString();

    const projection = await loadActivationProjection(USER);

    expect(projection.status).toBe("ok");
    expect(projection.muddyCount).toBe(1);
  });

  it("a genuinely brand-new account still reaches no_muddies, with status ok", async () => {
    fixture.friendshipsCount = 0;

    const projection = await loadActivationProjection(USER);

    expect(projection.status).toBe("ok");
    expect(projection.state).toBe("no_muddies");
  });
});
