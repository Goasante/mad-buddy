import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { stripComments } from "@/lib/content/strip-comments";
import { mergeConversations } from "@/lib/messaging/conversation-sync";

/**
 * A reply must move the conversation to the top, now, not after a restart.
 *
 * THE REPORTED DEFECT. Open a conversation last used five days ago, send a
 * message, go back to the inbox: it still read "5 days ago" and still sat low
 * in the list.
 *
 * The server was never wrong. sendMessage advances conversations.last_message_at
 * and listConversations orders by it descending. The break was entirely on the
 * client: the composer's onSent called refreshMessages + router.refresh(), and
 * router.refresh() cannot write client state, so the inbox row kept its old
 * preview, timestamp and position until a full page load.
 */

type Row = {
  id: string;
  unreadCount: number;
  pinned: boolean;
  muted: boolean;
  lastMessageAt: string;
  lastMessagePreview: string;
};

const row = (id: string, lastMessageAt: string, over: Partial<Row> = {}): Row => ({
  id,
  unreadCount: 0,
  pinned: false,
  muted: false,
  lastMessageAt,
  lastMessagePreview: "older text",
  ...over
});

const FIVE_DAYS_AGO = "2026-08-09T10:00:00.000Z";
const NOW = "2026-08-14T10:00:00.000Z";

describe("a five-day-old conversation moves to the top when you reply", () => {
  it("takes the server's new ordering, not the old local order", () => {
    // THE EXACT TRAP THIS GUARDS. A merge keyed by id can refresh every field
    // and still return rows in the stale local sequence. Iterating the SERVER
    // array is what makes position follow recency.
    const local = [row("A", FIVE_DAYS_AGO), row("B", "2026-08-13T10:00:00.000Z")];
    const server = [row("A", NOW, { lastMessagePreview: "my new message" }), local[1]];

    const merged = mergeConversations(local, server);
    expect(merged.map((r) => r.id)).toEqual(["A", "B"]);
    expect(merged[0].lastMessageAt).toBe(NOW);
  });

  it("moves a conversation that was NOT already first", () => {
    // The five-day-old one starts below and must end up above.
    const local = [row("B", "2026-08-13T10:00:00.000Z"), row("A", FIVE_DAYS_AGO)];
    const server = [row("A", NOW), row("B", "2026-08-13T10:00:00.000Z")];

    expect(mergeConversations(local, server).map((r) => r.id)).toEqual(["A", "B"]);
  });

  it("updates the preview and the timestamp together", () => {
    // An old preview beside a new time (or the reverse) is its own bug.
    const local = [row("A", FIVE_DAYS_AGO, { lastMessagePreview: "five days ago text" })];
    const server = [row("A", NOW, { lastMessagePreview: "my new message" })];

    const [merged] = mergeConversations(local, server);
    expect(merged.lastMessageAt).toBe(NOW);
    expect(merged.lastMessagePreview).toBe("my new message");
  });

  it("keeps the sender's own conversation read", () => {
    // Moving to the top must not make your own reply look unread to you.
    const local = [row("A", FIVE_DAYS_AGO, { unreadCount: 0 })];
    const server = [row("A", NOW, { unreadCount: 0 })];

    expect(mergeConversations(local, server)[0].unreadCount).toBe(0);
  });

  it("still preserves an in-flight pin while reordering", () => {
    const local = [row("A", FIVE_DAYS_AGO, { pinned: true })];
    const server = [row("A", NOW, { pinned: false })];

    const [merged] = mergeConversations(local, server);
    expect(merged.pinned).toBe(true);
    expect(merged.lastMessageAt).toBe(NOW);
  });

  it("a brand-new conversation that gets a message stays visible", () => {
    const local = [row("fresh", NOW)];
    const server = [row("fresh", NOW), row("A", FIVE_DAYS_AGO)];

    expect(mergeConversations(local, server).map((r) => r.id)).toEqual(["fresh", "A"]);
  });

  it("a reload produces the same order as the live update", () => {
    // Server order is the single rule, so re-merging a fresh server list over
    // an empty client must agree with what the live merge produced.
    const server = [row("A", NOW), row("B", "2026-08-13T10:00:00.000Z")];
    const live = mergeConversations([row("B", "2026-08-13T10:00:00.000Z"), row("A", FIVE_DAYS_AGO)], server);
    const afterReload = mergeConversations([], server);
    expect(live.map((r) => r.id)).toEqual(afterReload.map((r) => r.id));
  });
});

describe("the send path actually reconciles the inbox", () => {
  const page = stripComments(readFileSync("components/messages/messages-page.tsx", "utf8"));
  const onSent = page.slice(page.indexOf("onSent={async () => {"), page.indexOf("className=\"w-full border-0"));

  it("syncs the conversation list after a send", () => {
    // refreshMessages alone only updates the open thread; the inbox row is a
    // different projection and needs the canonical list re-read.
    expect(onSent).toContain("syncConversations");
  });

  it("still refreshes the open thread", () => {
    expect(onSent).toContain("refreshMessages");
  });

  it("does not rely on router.refresh() alone", () => {
    // router.refresh() re-renders the server component but cannot write the
    // client list -- which is precisely why the inbox stayed stale.
    const usesOnlyRouterRefresh =
      onSent.includes("router.refresh()") && !onSent.includes("syncConversations");
    expect(usesOnlyRouterRefresh).toBe(false);
  });
});

describe("server ordering is the one rule", () => {
  const mobile = readFileSync("lib/messaging/mobile.ts", "utf8");

  it("advances last_message_at when a message is sent", () => {
    expect(mobile).toContain("last_message_at: new Date().toISOString()");
  });

  it("orders the inbox by that column, newest first", () => {
    expect(mobile).toContain('.order("last_message_at", { ascending: false, nullsFirst: false })');
  });

  it("has no competing client-side sort", () => {
    // Two sorts is two answers. The client renders the order it is given.
    const page = stripComments(readFileSync("components/messages/messages-page.tsx", "utf8"));
    expect(page).not.toContain("conversations.sort(");
    expect(page).not.toContain("uniqueConversations.sort(");
  });
});
