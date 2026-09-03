import { describe, expect, it } from "vitest";

import type { ConversationView } from "@/lib/messaging/mobile";
import type { CachedThread } from "@/lib/messaging/thread-cache";
import {
  MAX_PROACTIVE_WARM_THREADS,
  PROACTIVE_WARM_MESSAGE_LIMIT,
  selectWarmConversations,
  shouldRefreshWarmThread
} from "@/lib/messaging/thread-warmup";

function conversation(id: string, unreadCount = 0): ConversationView {
  return {
    id,
    title: id,
    avatarUrl: null,
    otherUsername: null,
    kind: "direct",
    lastMessagePreview: "hello",
    lastMessageAt: `2026-01-01T00:0${id.slice(-1)}:00.000Z`,
    unreadCount,
    muted: false,
    pinned: false
  } as ConversationView;
}

function thread(createdAt: string | null): CachedThread {
  return {
    messages: createdAt ? [{ id: "m1", createdAt } as CachedThread["messages"][number]] : [],
    replyContexts: {},
    optimistic: [],
    updatedAt: Date.now()
  };
}

describe("bounded proactive thread warming", () => {
  it("keeps both thread and payload budgets small", () => {
    expect(MAX_PROACTIVE_WARM_THREADS).toBe(4);
    expect(PROACTIVE_WARM_MESSAGE_LIMIT).toBe(32);
  });

  it("prioritises the selected thread and recent inbox rows without duplicates", () => {
    const rows = [conversation("chat-1"), conversation("chat-2"), conversation("chat-3"), conversation("chat-4", 2), conversation("chat-5")];

    expect(selectWarmConversations(rows, "chat-5").map((row) => row.id)).toEqual([
      "chat-5",
      "chat-1",
      "chat-2",
      "chat-3"
    ]);
  });

  it("fills remaining budget with unread then recent rows", () => {
    const rows = [conversation("chat-1"), conversation("chat-2"), conversation("chat-3"), conversation("chat-4", 2), conversation("chat-5")];

    expect(selectWarmConversations(rows, null).map((row) => row.id)).toEqual([
      "chat-1",
      "chat-2",
      "chat-3",
      "chat-4"
    ]);
  });
});

describe("inbox freshness signal", () => {
  it("warms a cache miss", () => {
    expect(shouldRefreshWarmThread(null, "2026-01-01T00:01:00.000Z")).toBe(true);
  });

  it("recognises a valid known-empty thread", () => {
    expect(shouldRefreshWarmThread(thread(null), null)).toBe(false);
  });

  it("warms when the inbox is newer than the local tail", () => {
    expect(shouldRefreshWarmThread(thread("2026-01-01T00:00:00.000Z"), "2026-01-01T00:01:00.000Z")).toBe(true);
  });

  it("does not refetch a tail already current with the inbox", () => {
    expect(shouldRefreshWarmThread(thread("2026-01-01T00:01:00.000Z"), "2026-01-01T00:01:00.000Z")).toBe(false);
  });
});
