import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * HOW THE LINKR COLLECTION ANSWERS "has this conversation started?".
 *
 * Home reads this collection on every render, so the shape of this one question
 * is a Home performance contract, not a Linkr detail. It has been wrong twice:
 *
 *   1. one `messages` COUNT per connection -- 40 round trips for 40 people.
 *   2. one `messages.select("conversation_id").in(...)` -- one round trip, but
 *      it transferred EVERY undeleted message row across every conversation
 *      just to learn which ids appeared at least once.
 *
 * Both are "correct" and both are unacceptable. The contract these tests hold
 * is BOTH bounds at once: one round trip, and one row per conversation. That is
 * what `conversation_previews` returns, and it already applies the same
 * `deleted_at is null` rule, so the semantics carry over unchanged.
 */

const A = "aaaaaaaa-1111-4111-8111-111111111111";
const B = "bbbbbbbb-2222-4222-8222-222222222222";
const C = "cccccccc-3333-4333-8333-333333333333";
const CONV_LIVE = "d1111111-4444-4444-8444-444444444441";
const CONV_DELETED_ONLY = "d2222222-4444-4444-8444-444444444442";

type Call = { kind: "rpc" | "table"; name: string; ids?: string[] };

let calls: Call[] = [];

/** Rows the fake database holds for one test. */
type Fixture = {
  connections: Array<{
    id: string;
    user_low: string;
    user_high: string;
    conversation_id: string | null;
    connected_at: string;
    event_id: string | null;
  }>;
  /** conversation_id -> last_created_at, exactly as the RPC returns it. */
  previews: Record<string, string | null>;
};

let fixture: Fixture = { connections: [], previews: {} };

function fakeAdmin() {
  return {
    rpc: (name: string, args: Record<string, unknown>) => {
      calls.push({ kind: "rpc", name, ids: (args.p_conversation_ids as string[]) ?? [] });
      const ids = (args.p_conversation_ids as string[]) ?? [];
      /* One row per requested conversation -- the whole point of the RPC. */
      return Promise.resolve({
        data: ids.map((id) => ({
          conversation_id: id,
          last_text: null,
          last_message_type: null,
          last_created_at: fixture.previews[id] ?? null,
          unread_count: 0
        }))
      });
    },
    from: (table: string) => {
      const call: Call = { kind: "table", name: table };
      calls.push(call);
      const chain: Record<string, unknown> = {};
      const self = () => chain as never;
      const settle = () => {
        if (table === "linkr_connections") return Promise.resolve({ data: fixture.connections });
        if (table === "profiles") {
          return Promise.resolve({
            data: [
              { user_id: B, full_name: "Bediako", username: "bediako", visibility_status: "visible", deleted_at: null },
              { user_id: C, full_name: "Cynthia", username: "cynthia", visibility_status: "visible", deleted_at: null }
            ]
          });
        }
        if (table === "blocked_users") return Promise.resolve({ data: [] });
        if (table === "events") return Promise.resolve({ data: [] });
        return Promise.resolve({ data: [] });
      };
      Object.assign(chain, {
        select: () => self(),
        eq: () => self(),
        is: () => self(),
        or: () => self(),
        in: (_column: string, ids: string[]) => {
          call.ids = ids;
          return self();
        },
        order: () => settle(),
        limit: () => settle(),
        maybeSingle: () => settle(),
        then: (resolve: (value: unknown) => unknown) => settle().then(resolve)
      });
      return chain;
    }
  };
}

vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: () => fakeAdmin()
}));
vi.mock("@/lib/supabase/env", () => ({
  getSupabaseServerEnv: () => ({ url: "http://local", serviceRoleKey: "service" })
}));
vi.mock("@/lib/social/permissions", () => ({
  batchBlockedIds: () => Promise.resolve(new Set<string>())
}));
vi.mock("@/lib/linkr/media-projection", () => ({
  loadLinkrGalleries: () => Promise.resolve(new Map<string, string[]>())
}));

const { loadClickedPeople } = await import("@/lib/linkr/collections-service");

const connection = (over: Partial<Fixture["connections"][number]> = {}) => ({
  id: "conn-1",
  user_low: A < B ? A : B,
  user_high: A < B ? B : A,
  conversation_id: CONV_LIVE,
  connected_at: "2026-08-05T10:00:00.000Z",
  event_id: null,
  ...over
});

beforeEach(() => {
  calls = [];
  fixture = { connections: [], previews: {} };
});

const activityCalls = () =>
  calls.filter((c) => (c.kind === "rpc" && c.name === "conversation_previews") || (c.kind === "table" && c.name === "messages"));

describe("the activity question is bounded in both directions", () => {
  it("asks nothing at all when no connection has a conversation", async () => {
    fixture.connections = [connection({ conversation_id: null })];

    const people = await loadClickedPeople(A);

    expect(activityCalls()).toHaveLength(0);
    expect(people[0]?.hasConversation).toBe(false);
  });

  it("asks ONCE for many conversations, and never reads message rows", async () => {
    fixture.connections = [
      connection({ id: "conn-1", conversation_id: CONV_LIVE }),
      connection({
        id: "conn-2",
        user_low: A < C ? A : C,
        user_high: A < C ? C : A,
        conversation_id: CONV_DELETED_ONLY
      })
    ];
    fixture.previews = {
      [CONV_LIVE]: "2026-08-05T09:00:00.000Z",
      /* Deleted-only: the RPC's `deleted_at is null` lateral finds no last
         message, so it returns the row with a null timestamp. */
      [CONV_DELETED_ONLY]: null
    };

    await loadClickedPeople(A);

    const activity = activityCalls();
    expect(activity).toHaveLength(1);
    expect(activity[0].kind).toBe("rpc");
    expect(activity[0].name).toBe("conversation_previews");
    /* The whole batch in one call -- no per-connection round trip. */
    expect(activity[0].ids).toEqual([CONV_LIVE, CONV_DELETED_ONLY]);
    /* And crucially: the `messages` TABLE is never selected from, so no message
       history is transferred to answer a yes/no question. */
    expect(calls.some((c) => c.kind === "table" && c.name === "messages")).toBe(false);
  });

  it("returns one answer per conversation, not one per message", async () => {
    fixture.connections = [connection({ conversation_id: CONV_LIVE })];
    fixture.previews = { [CONV_LIVE]: "2026-08-05T09:00:00.000Z" };

    await loadClickedPeople(A);

    const activity = activityCalls()[0];
    /* Cardinality is the point: the request names N conversations and the
       response carries N rows, whatever the size of their histories. */
    expect(activity.ids).toHaveLength(1);
  });

  it("deduplicates a conversation shared by more than one row", async () => {
    fixture.connections = [
      connection({ id: "conn-1", conversation_id: CONV_LIVE }),
      connection({
        id: "conn-2",
        user_low: A < C ? A : C,
        user_high: A < C ? C : A,
        conversation_id: CONV_LIVE
      })
    ];
    fixture.previews = { [CONV_LIVE]: "2026-08-05T09:00:00.000Z" };

    await loadClickedPeople(A);

    expect(activityCalls()[0].ids).toEqual([CONV_LIVE]);
  });
});

describe("the semantics the CTA depends on survive the batching", () => {
  it("a conversation with a live message reads as started", async () => {
    fixture.connections = [connection({ conversation_id: CONV_LIVE })];
    fixture.previews = { [CONV_LIVE]: "2026-08-05T09:00:00.000Z" };

    const people = await loadClickedPeople(A);

    expect(people[0]?.hasConversation).toBe(true);
  });

  /**
   * The rule the previous implementations both preserved and this one must too:
   * a conversation whose only message was deleted has nothing to continue, so
   * the pair still gets "Say hi" rather than "Continue chat".
   */
  it("a conversation whose only message was deleted stays unstarted", async () => {
    fixture.connections = [connection({ conversation_id: CONV_DELETED_ONLY })];
    fixture.previews = { [CONV_DELETED_ONLY]: null };

    const people = await loadClickedPeople(A);

    expect(people[0]?.hasConversation).toBe(false);
  });

  it("a conversation the RPC does not answer for stays unstarted", async () => {
    fixture.connections = [connection({ conversation_id: CONV_LIVE })];
    fixture.previews = {};

    const people = await loadClickedPeople(A);

    expect(people[0]?.hasConversation).toBe(false);
  });
});
