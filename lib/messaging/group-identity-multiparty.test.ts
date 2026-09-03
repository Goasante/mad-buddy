import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { startsNewRun } from "@/lib/messaging/conversation-presence";
import { stripComments } from "@/lib/content/strip-comments";

/**
 * BETA-012. Group messages did not say who sent them.
 *
 * A beta tester in a multi-person chat could not tell Ama's messages from
 * Kojo's without inferring it from order. The identity block existed, the
 * server projection carried the avatar, the run-grouping helper was correct --
 * and none of it rendered, because `/messages` decided whether a conversation
 * was a group by testing `kind === "group"`.
 *
 * `conversation_type` is an enum of FIVE values: direct, group, plan, event and
 * safe_arrival. Four of them are multi-party. Testing for the literal string
 * "group" therefore told every Plan chat, Event Room and Safe Arrival thread
 * that it was a two-person conversation, and MessageBubbleV4 gates sender
 * identity on exactly that flag.
 *
 * The same file already had the right test for the composer
 * (`kind !== "direct"`), so one screen carried two definitions of a group and
 * the half that renders other people's names had the wrong one.
 */

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");
const v4Page = stripComments(read("components/messages/messages-page-v4.tsx"));
const bubble = stripComments(read("components/messaging/message-bubble-v4.tsx"));
const projection = stripComments(read("lib/messaging/mobile.ts"));
const types = read("lib/supabase/database.types.ts");

const AMA = "11111111-1111-4111-8111-111111111111";
const KOFI = "22222222-2222-4222-8222-222222222222";

/**
 * The predicate under test, stated once here exactly as the page states it.
 *
 * Kept as a local mirror rather than imported because it is one expression
 * inside a client component; the source assertions below pin the page to this
 * same shape, so the two cannot drift apart silently.
 */
const isMultiParty = (kind: string) => kind !== "direct";

// ---------------------------------------------------------------------------
// The defect, as behaviour
// ---------------------------------------------------------------------------

describe("every multi-party conversation counts as a group", () => {
  it("treats plan, event and safe_arrival as groups, not as direct chats", () => {
    /* THE BUG. Each of these returned false under `kind === "group"`, which is
     * what removed the avatar and the name from the bubbles. */
    expect(isMultiParty("plan")).toBe(true);
    expect(isMultiParty("event")).toBe(true);
    expect(isMultiParty("safe_arrival")).toBe(true);
  });

  it("still treats a literal group as a group", () => {
    expect(isMultiParty("group")).toBe(true);
  });

  it("G8 — leaves one-to-one chats alone", () => {
    /* Direct conversations must NOT gain sender labels: naming the only other
     * person in a two-person thread is noise. */
    expect(isMultiParty("direct")).toBe(false);
  });

  it("covers every conversation_type the database can produce", () => {
    /* If a sixth type is ever added, this test fails until somebody decides
     * which side of the line it belongs on -- rather than it silently
     * defaulting to "not a group" and losing identity again. */
    const line = types.match(/export type ConversationType = ([^;]+);/)?.[1] ?? "";
    const kinds = [...line.matchAll(/"([a-z_]+)"/g)].map((match) => match[1]);
    expect(kinds.sort()).toEqual(["direct", "event", "group", "plan", "safe_arrival"]);
    for (const kind of kinds) {
      expect(typeof isMultiParty(kind)).toBe("boolean");
    }
  });
});

// ---------------------------------------------------------------------------
// G1/G2/G3 — runs, so identity appears exactly where a reader needs it
// ---------------------------------------------------------------------------

describe("G1 — three members are individually attributable", () => {
  it("starts a new run for each change of sender", () => {
    const a = { isMine: false, senderId: AMA, createdAt: "2026-09-02T10:00:00.000Z" };
    const b = { isMine: false, senderId: KOFI, createdAt: "2026-09-02T10:00:10.000Z" };
    expect(startsNewRun(a, undefined)).toBe(true);
    expect(startsNewRun(b, a)).toBe(true);
  });
});

describe("G2 — a run from one person is not re-labelled on every bubble", () => {
  it("continues the run for consecutive messages from the same sender", () => {
    const first = { isMine: false, senderId: AMA, createdAt: "2026-09-02T10:00:00.000Z" };
    const second = { isMine: false, senderId: AMA, createdAt: "2026-09-02T10:00:20.000Z" };
    const third = { isMine: false, senderId: AMA, createdAt: "2026-09-02T10:00:40.000Z" };
    expect(startsNewRun(second, first)).toBe(false);
    expect(startsNewRun(third, second)).toBe(false);
  });
});

describe("G3 — a sender change is visibly a new run", () => {
  it("breaks the run even when the messages are seconds apart", () => {
    const ama = { isMine: false, senderId: AMA, createdAt: "2026-09-02T10:00:00.000Z" };
    const kofi = { isMine: false, senderId: KOFI, createdAt: "2026-09-02T10:00:01.000Z" };
    expect(startsNewRun(kofi, ama)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// The page and the bubble
// ---------------------------------------------------------------------------

describe("the page computes the flag correctly, and only once", () => {
  it("no longer narrows a group to the literal 'group' type", () => {
    expect(v4Page).not.toContain('const isGroup = selected?.kind === "group"');
  });

  it("derives it from not-direct", () => {
    expect(v4Page).toMatch(/const isGroup = Boolean\(selected\) && selected\?\.kind !== "direct"/);
  });

  it("has ONE definition, reused by the composer", () => {
    /* The two spellings disagreeing is what produced a screen that offered a
     * mention picker in a Plan chat while refusing to name anybody in it. */
    expect(v4Page.match(/kind !== "direct"/g) ?? []).toHaveLength(1);
    expect(v4Page).toContain("isGroup={isGroup}");
  });
});

describe("G4/G5 — the identity block, and its fallback", () => {
  it("renders avatar and name at the start of an incoming run", () => {
    expect(bubble).toContain("showIdentity && !message.isMine && isGroup");
    expect(bubble).toContain("src={message.senderAvatarUrl}");
    expect(bubble).toContain("name={message.senderName}");
  });

  it("G5 — uses the shared UserAvatar, which draws initials when there is no image", () => {
    /* No bespoke fallback and no broken <img>: UserAvatar already renders a
     * deterministic initial for a null src everywhere else in the product. */
    expect(bubble).toContain("<UserAvatar");
    expect(bubble).not.toMatch(/<img[^>]*senderAvatarUrl/);
  });
});

// ---------------------------------------------------------------------------
// G6/G7 — every path produces the same identity
// ---------------------------------------------------------------------------

describe("G6/G7 — server load, realtime and cache agree", () => {
  it("the projection is the single producer of sender identity", () => {
    expect(projection).toContain("senderAvatarUrl: row.sender_id ?");
    expect(projection).toContain("senderUsername: row.sender_id ?");
  });

  it("G6 — realtime re-reads through that same projection", () => {
    /* The realtime handler never builds a message view out of the Realtime
     * payload, so an INSERT cannot produce a bubble with weaker identity than
     * a refresh would.
     *
     * INTEGRATION NOTE (beta + instant-messaging). This originally asserted
     * that the handler called `refreshThread`, because at the time refetching
     * the whole thread was the only way it re-read through the projection.
     * The performance work replaced that with `getMessageAction`, which
     * projects the ONE changed row through the very same `listMessages` path
     * (same authorisation, same sender-identity fields) instead of reprojecting
     * 200 rows for every incoming message.
     *
     * The contract was never "call refreshThread" -- it was "identity comes
     * from the server projection, never from the payload". So this now asserts
     * that directly: the payload is read ONLY to learn which message changed,
     * and the ambiguous cases still fall back to a full authoritative refresh. */
    const subscription = v4Page.slice(v4Page.indexOf('table: "messages"'));
    const handler = subscription.slice(0, 400);

    // The id is the only thing taken from the payload...
    expect(handler).toContain("patchMessage");
    // ...and anything unresolvable still falls back to the full refresh.
    expect(handler).toContain("refreshThread");

    /* No field of a rendered bubble is ever read off the Realtime record.
       Sender identity in particular must come back from the projection. */
    expect(v4Page).not.toMatch(/payload\.(new|old)\.(sender|text|body|content)/);
    expect(v4Page).toContain("getMessageAction");
  });

  it("G7 — the durable cache stores whole message views, losing no field", () => {
    const cache = stripComments(read("lib/messaging/thread-cache.ts"));
    expect(cache).toContain("ChatMessageView");
    /* No field allow-list anywhere in the cache: if it named fields, a new one
     * would silently fail to survive a restart. */
    expect(cache).not.toContain("senderAvatarUrl:");
  });
});
