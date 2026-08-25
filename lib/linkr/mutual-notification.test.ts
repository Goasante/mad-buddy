import { describe, expect, it } from "vitest";

import { resolveNotificationDestination } from "@/lib/notifications/destination";
import { resolveMutualDestination } from "@/lib/linkr/mutual-resolution";

/**
 * The mutual notification, end to end: where it points, and what it refuses.
 *
 * The destination is resolved LATE on purpose. These tests are the reason
 * why -- between a notification being written and being tapped, a conversation
 * can start and a block can be placed, and both must change the answer.
 *
 * The Supabase admin client is faked at the query level so the real resolution
 * logic runs against controlled rows. Nothing here touches a database.
 */

const CONNECTION = "11111111-2222-4333-8444-555555555555";
const A = "aaaaaaaa-1111-4111-8111-111111111111";
const B = "bbbbbbbb-2222-4222-8222-222222222222";
const OUTSIDER = "cccccccc-3333-4333-8333-333333333333";
const CONVERSATION = "dddddddd-4444-4444-8444-444444444444";

type Rows = {
  connection: Record<string, unknown> | null;
  blocked: boolean;
  liveMessages: number;
};

/**
 * A fake admin client covering exactly the three reads the resolver performs:
 * the connection row, the block check, and the message-activity count.
 */
function fakeAdmin(rows: Rows) {
  const builder = (table: string) => {
    const chain: Record<string, unknown> = {};
    const self = () => chain as never;

    // Each table is resolved in the shape its real caller reads:
    //   blocked_users -> { data: [] }   (isBlockedEitherDirection reads .length)
    //   messages      -> { count }      (conversationHasActivity reads .count)
    const settle = () => {
      if (table === "blocked_users") {
        return Promise.resolve({ data: rows.blocked ? [{ blocker_id: A }] : [] });
      }
      if (table === "messages") return Promise.resolve({ count: rows.liveMessages });
      return Promise.resolve({ data: null });
    };

    Object.assign(chain, {
      select: () => self(),
      eq: () => self(),
      is: () => self(),
      or: () => self(),
      in: () => self(),
      limit: () => settle(),
      maybeSingle: () =>
        Promise.resolve({ data: table === "linkr_connections" ? rows.connection : null }),
      then: (resolve: (value: unknown) => unknown) => settle().then(resolve)
    });
    return chain;
  };
  return { from: (table: string) => builder(table) } as never;
}

const activeConnection = {
  id: CONNECTION,
  user_low: A < B ? A : B,
  user_high: A < B ? B : A,
  conversation_id: null as string | null,
  ended_at: null as string | null
};

describe("the notification carries a destination at all", () => {
  it("routes a mutual notification to the pair, not a generic page", () => {
    const destination = resolveNotificationDestination(`linkr_connection:${CONNECTION}`);
    expect(destination).not.toBeNull();
    expect(destination?.href).toBe(`/linkr?connection=${CONNECTION}`);
  });

  it("still lands somewhere valid without an id", () => {
    expect(resolveNotificationDestination("linkr_connection")?.href).toBe("/linkr");
  });

  it("refuses a malformed id rather than routing to it", () => {
    // Falls back to the base destination instead of trusting the suffix.
    expect(resolveNotificationDestination("linkr_connection:../../admin")?.href).toBe("/linkr");
  });
});

describe("what the notification opens, decided at tap time", () => {
  it("opens the mutual state when nobody has spoken", async () => {
    const resolved = await resolveMutualDestination(
      fakeAdmin({ connection: { ...activeConnection }, blocked: false, liveMessages: 0 }),
      A,
      CONNECTION
    );
    expect(resolved.kind).toBe("mutual");
  });

  it("an EMPTY conversation still reads as not started", async () => {
    // The conversation is created eagerly with the connection, so its mere
    // existence must not turn "Say hi" into "Continue chat".
    const resolved = await resolveMutualDestination(
      fakeAdmin({
        connection: { ...activeConnection, conversation_id: CONVERSATION },
        blocked: false,
        liveMessages: 0
      }),
      A,
      CONNECTION
    );
    expect(resolved.kind).toBe("mutual");
  });

  it("goes straight to the chat once somebody has actually spoken", async () => {
    const resolved = await resolveMutualDestination(
      fakeAdmin({
        connection: { ...activeConnection, conversation_id: CONVERSATION },
        blocked: false,
        liveMessages: 1
      }),
      A,
      CONNECTION
    );
    expect(resolved.kind).toBe("conversation");
    if (resolved.kind === "conversation") {
      expect(resolved.conversationId).toBe(CONVERSATION);
    }
  });

  it("resolves the same way for BOTH participants", async () => {
    for (const viewer of [A, B]) {
      const resolved = await resolveMutualDestination(
        fakeAdmin({ connection: { ...activeConnection }, blocked: false, liveMessages: 0 }),
        viewer,
        CONNECTION
      );
      expect(resolved.kind).toBe("mutual");
      if (resolved.kind === "mutual") {
        expect(resolved.otherUserId).toBe(viewer === A ? B : A);
      }
    }
  });
});

describe("it fails closed", () => {
  it("a block placed AFTER the notification wins", async () => {
    const resolved = await resolveMutualDestination(
      fakeAdmin({ connection: { ...activeConnection }, blocked: true, liveMessages: 0 }),
      A,
      CONNECTION
    );
    expect(resolved.kind).toBe("unavailable");
  });

  it("a block wins even when the chat is already running", async () => {
    const resolved = await resolveMutualDestination(
      fakeAdmin({
        connection: { ...activeConnection, conversation_id: CONVERSATION },
        blocked: true,
        liveMessages: 5
      }),
      A,
      CONNECTION
    );
    expect(resolved.kind).toBe("unavailable");
  });

  it("an outsider cannot open somebody else's connection", async () => {
    const resolved = await resolveMutualDestination(
      fakeAdmin({ connection: { ...activeConnection }, blocked: false, liveMessages: 0 }),
      OUTSIDER,
      CONNECTION
    );
    expect(resolved.kind).toBe("unavailable");
  });

  it("an ended connection opens nothing", async () => {
    const resolved = await resolveMutualDestination(
      fakeAdmin({
        connection: { ...activeConnection, ended_at: "2026-08-20T00:00:00.000Z" },
        blocked: false,
        liveMessages: 0
      }),
      A,
      CONNECTION
    );
    expect(resolved.kind).toBe("unavailable");
  });

  it("a missing connection opens nothing", async () => {
    const resolved = await resolveMutualDestination(
      fakeAdmin({ connection: null, blocked: false, liveMessages: 0 }),
      A,
      CONNECTION
    );
    expect(resolved.kind).toBe("unavailable");
  });

  it("never names the other person when it fails", async () => {
    const resolved = await resolveMutualDestination(
      fakeAdmin({ connection: { ...activeConnection }, blocked: true, liveMessages: 0 }),
      A,
      CONNECTION
    );
    // The failure carries no user id at all, so a caller cannot render
    // "so-and-so blocked you" from it.
    expect(Object.keys(resolved)).toEqual(["kind"]);
  });
});
