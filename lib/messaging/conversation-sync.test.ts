import { describe, expect, it } from "vitest";
import { mergeConversations, upsertConversation } from "@/lib/messaging/conversation-sync";
import { readFileSync } from "node:fs";
import { stripComments } from "@/lib/content/strip-comments";

/**
 * These assert the DEAD ENDS are gone, not that the functions were called.
 *
 * The bug being pinned: a conversation created moments ago could not enter the
 * client list by any path, so the thread pane opened fullscreen onto "Select a
 * conversation" and the only cure was restarting the app.
 */

type Row = {
  id: string;
  unreadCount: number;
  pinned: boolean;
  muted: boolean;
  title?: string;
  lastMessageAt?: string | null;
};

const row = (id: string, over: Partial<Row> = {}): Row => ({
  id,
  unreadCount: 0,
  pinned: false,
  muted: false,
  title: id,
  ...over
});

describe("a newly created conversation reaches the inbox", () => {
  it("adds a server row the client has never seen", () => {
    const merged = mergeConversations([row("a")], [row("b"), row("a")]);
    expect(merged.map((r) => r.id)).toEqual(["b", "a"]);
  });

  it("puts a just-opened conversation where the user can see it", () => {
    const next = upsertConversation([row("a")], row("new"));
    expect(next[0].id).toBe("new");
  });

  it("never needs an app restart: an empty client list can gain rows", () => {
    // The exact reported state -- inbox appeared empty, conversations existed.
    const merged = mergeConversations([], [row("x"), row("y")]);
    expect(merged).toHaveLength(2);
  });
});

describe("returning from a Circle reconciles the inbox", () => {
  const page = stripComments(readFileSync("components/messages/messages-page.tsx", "utf8"));

  it("refreshes canonical rows whenever the inbox mounts", () => {
    // Next can restore the inbox with the row state from before /groups/:id.
    // The global nav badge refreshes in the layout, but the row and Unread
    // filter live here and need their own authoritative reconciliation.
    expect(page).toMatch(/useEffect\(\(\) => \{\s*void syncConversations\(\);\s*\}, \[syncConversations\]\);/);
  });
});

describe("an existing conversation is reused, never duplicated", () => {
  it("does not add a second row for a conversation already present", () => {
    const next = upsertConversation([row("a"), row("b")], row("b", { title: "fresh" }));
    expect(next).toHaveLength(2);
    expect(next.filter((r) => r.id === "b")).toHaveLength(1);
  });

  it("updates the existing row in place", () => {
    const next = upsertConversation([row("a", { title: "old" })], row("a", { title: "new" }));
    expect(next[0].title).toBe("new");
  });

  it("keeps ids unique when the server repeats a row the client holds", () => {
    const merged = mergeConversations([row("a"), row("b")], [row("a"), row("b")]);
    expect(new Set(merged.map((r) => r.id)).size).toBe(merged.length);
  });
});

describe("optimistic client state is not clobbered by a refresh", () => {
  it("keeps a pin that the server has not caught up with", () => {
    const merged = mergeConversations([row("a", { pinned: true })], [row("a", { pinned: false })]);
    expect(merged[0].pinned).toBe(true);
  });

  it("keeps a local mute", () => {
    const merged = mergeConversations([row("a", { muted: true })], [row("a", { muted: false })]);
    expect(merged[0].muted).toBe(true);
  });

  it("does not resurrect the unread badge for a conversation just read", () => {
    // The visible symptom this prevents: open a conversation, badge clears,
    // then a refresh lands and the badge flicks back for a second.
    const merged = mergeConversations([row("a", { unreadCount: 0 })], [row("a", { unreadCount: 6 })], {
      locallyReadIds: new Set(["a"])
    });
    expect(merged[0].unreadCount).toBe(0);
  });

  it("still delivers genuinely new messages, so the inbox never goes deaf", () => {
    // Without this the read-suppression above would silence the conversation
    // permanently -- a worse bug than the one it fixes.
    const merged = mergeConversations([row("a", { unreadCount: 0 })], [row("a", { unreadCount: 3 })]);
    expect(merged[0].unreadCount).toBe(3);
  });
});

describe("server authority over membership", () => {
  it("drops a conversation the server no longer returns", () => {
    // Left, deleted or removed: the server is the authority on membership.
    const merged = mergeConversations([row("a"), row("gone")], [row("a")]);
    expect(merged.map((r) => r.id)).toEqual(["a"]);
  });

  it("keeps a just-created row the server response may predate", () => {
    const merged = mergeConversations([row("fresh")], [row("a")], { pendingIds: new Set(["fresh"]) });
    expect(merged.map((r) => r.id)).toContain("fresh");
  });

  it("follows the server's ordering rather than inventing one", () => {
    const merged = mergeConversations([row("a"), row("b")], [row("b"), row("a")]);
    expect(merged.map((r) => r.id)).toEqual(["b", "a"]);
  });
});

describe("degenerate inputs do not strand the user", () => {
  it("an empty server list with no pending rows clears the inbox", () => {
    expect(mergeConversations([row("a")], [])).toEqual([]);
  });

  it("merging is idempotent, so repeated refreshes do not grow the list", () => {
    const server = [row("a"), row("b")];
    const once = mergeConversations([], server);
    const twice = mergeConversations(once, server);
    expect(twice).toEqual(once);
  });

  it("upserting the same conversation twice leaves one row", () => {
    const once = upsertConversation([], row("a"));
    const twice = upsertConversation(once, row("a"));
    expect(twice).toHaveLength(1);
  });
});
