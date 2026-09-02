import { beforeEach, describe, expect, it } from "vitest";

import {
  bindThreadCacheOwner,
  cacheSizeForTests,
  clearThreadCache,
  patchThreadMessage,
  readThread,
  writeThreadMessages,
  writeThreadOptimistic,
  writeThreadReplyContexts
} from "@/lib/messaging/thread-cache";
import type { OptimisticMessage } from "@/lib/messaging/optimistic-messages";
import type { ChatMessageView } from "@/lib/messaging/mobile";

/**
 * The cache that makes reopening a chat instant (M1), and the store that keeps
 * an unsent message alive across a thread switch (M2).
 *
 * These are the rules that decide whether somebody's message quietly
 * disappears, and whether one account can ever be shown another's
 * conversation, so they are tested directly rather than through a component.
 */

const VIEWER = "viewer-1";
const OTHER_VIEWER = "viewer-2";
const CHAT_A = "chat-a";
const CHAT_B = "chat-b";

function message(id: string, createdAt: string, over: Partial<ChatMessageView> = {}): ChatMessageView {
  return {
    id,
    createdAt,
    text: `message ${id}`,
    isMine: false,
    clientMessageId: null,
    ...over
  } as ChatMessageView;
}

function optimistic(clientMessageId: string, status: OptimisticMessage["status"] = "pending"): OptimisticMessage {
  return {
    clientMessageId,
    text: "unsent",
    kind: "text",
    durationSeconds: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    status
  };
}

beforeEach(() => {
  clearThreadCache();
  bindThreadCacheOwner(VIEWER);
});

describe("a cached thread survives what a component mount does not", () => {
  it("returns the messages written for a conversation", () => {
    writeThreadMessages(VIEWER, CHAT_A, [message("m1", "2026-01-01T00:00:00.000Z")]);

    expect(readThread(VIEWER, CHAT_A)?.messages).toHaveLength(1);
  });

  it("survives switching to another conversation and back", () => {
    writeThreadMessages(VIEWER, CHAT_A, [message("m1", "2026-01-01T00:00:00.000Z")]);
    writeThreadMessages(VIEWER, CHAT_B, [message("m2", "2026-01-01T00:01:00.000Z")]);

    expect(readThread(VIEWER, CHAT_A)?.messages[0].id).toBe("m1");
    expect(readThread(VIEWER, CHAT_B)?.messages[0].id).toBe("m2");
  });

  it("survives a remount, because the store is not component state", () => {
    writeThreadMessages(VIEWER, CHAT_A, [message("m1", "2026-01-01T00:00:00.000Z")]);

    // A remount re-binds the same owner. That must not be read as a change of
    // account, or leaving /messages and coming back would empty the cache --
    // which is precisely the bug M1 exists to fix.
    bindThreadCacheOwner(VIEWER);

    expect(readThread(VIEWER, CHAT_A)?.messages[0].id).toBe("m1");
  });

  it("keeps reply metadata when only messages are rewritten", () => {
    writeThreadMessages(VIEWER, CHAT_A, [message("m1", "2026-01-01T00:00:00.000Z")], {
      m1: { replyToMessageId: "m0", senderName: "Ama", text: "earlier" }
    });
    writeThreadMessages(VIEWER, CHAT_A, [message("m1", "2026-01-01T00:00:00.000Z")]);

    expect(readThread(VIEWER, CHAT_A)?.replyContexts.m1?.senderName).toBe("Ama");
  });

  it("keeps messages when only reply metadata is rewritten", () => {
    writeThreadMessages(VIEWER, CHAT_A, [message("m1", "2026-01-01T00:00:00.000Z")]);
    writeThreadReplyContexts(VIEWER, CHAT_A, {
      m1: { replyToMessageId: "m0", senderName: "Ama", text: "earlier" }
    });

    expect(readThread(VIEWER, CHAT_A)?.messages).toHaveLength(1);
  });
});

describe("the cache is bound to one account", () => {
  it("refuses to serve a thread to a different viewer", () => {
    writeThreadMessages(VIEWER, CHAT_A, [message("m1", "2026-01-01T00:00:00.000Z")]);

    expect(readThread(OTHER_VIEWER, CHAT_A)).toBeNull();
  });

  it("drops everything when the account changes", () => {
    writeThreadMessages(VIEWER, CHAT_A, [message("m1", "2026-01-01T00:00:00.000Z")]);
    bindThreadCacheOwner(OTHER_VIEWER);

    expect(readThread(OTHER_VIEWER, CHAT_A)).toBeNull();
    expect(cacheSizeForTests()).toBe(0);
  });

  it("refuses to serve anything once the session has ended", () => {
    writeThreadMessages(VIEWER, CHAT_A, [message("m1", "2026-01-01T00:00:00.000Z")]);
    clearThreadCache();

    expect(readThread(VIEWER, CHAT_A)).toBeNull();
  });

  it("ignores writes from a viewer that does not own the cache", () => {
    writeThreadMessages(OTHER_VIEWER, CHAT_A, [message("m1", "2026-01-01T00:00:00.000Z")]);

    expect(readThread(VIEWER, CHAT_A)).toBeNull();
  });

  it("never treats a signed-out viewer as an owner", () => {
    bindThreadCacheOwner(null);
    writeThreadMessages(null, CHAT_A, [message("m1", "2026-01-01T00:00:00.000Z")]);

    expect(readThread(null, CHAT_A)).toBeNull();
  });
});

describe("an unsent message belongs to its own thread", () => {
  it("keeps a pending row for a conversation the person has left", () => {
    writeThreadOptimistic(VIEWER, CHAT_A, [optimistic("c1")]);
    writeThreadMessages(VIEWER, CHAT_B, [message("m2", "2026-01-01T00:01:00.000Z")]);

    expect(readThread(VIEWER, CHAT_A)?.optimistic).toHaveLength(1);
  });

  it("keeps a FAILED row across a switch, so it can still be retried", () => {
    writeThreadOptimistic(VIEWER, CHAT_A, [optimistic("c1", "failed")]);
    readThread(VIEWER, CHAT_B);

    expect(readThread(VIEWER, CHAT_A)?.optimistic[0].status).toBe("failed");
  });

  it("does not lose outgoing rows when the server rows are reconciled", () => {
    writeThreadOptimistic(VIEWER, CHAT_A, [optimistic("c1")]);
    writeThreadMessages(VIEWER, CHAT_A, [message("m1", "2026-01-01T00:00:00.000Z")]);

    expect(readThread(VIEWER, CHAT_A)?.optimistic).toHaveLength(1);
  });

  it("holds an outgoing row for a conversation with no cached messages yet", () => {
    writeThreadOptimistic(VIEWER, "brand-new-chat", [optimistic("c1")]);

    expect(readThread(VIEWER, "brand-new-chat")?.optimistic).toHaveLength(1);
  });
});

describe("a realtime row is patched in, not refetched", () => {
  it("appends a new message in time order", () => {
    writeThreadMessages(VIEWER, CHAT_A, [message("m1", "2026-01-01T00:00:00.000Z")]);
    const next = patchThreadMessage(VIEWER, CHAT_A, message("m2", "2026-01-01T00:01:00.000Z"));

    expect(next?.map((row) => row.id)).toEqual(["m1", "m2"]);
  });

  it("orders an out-of-sequence arrival correctly", () => {
    writeThreadMessages(VIEWER, CHAT_A, [message("m2", "2026-01-01T00:01:00.000Z")]);
    const next = patchThreadMessage(VIEWER, CHAT_A, message("m1", "2026-01-01T00:00:00.000Z"));

    expect(next?.map((row) => row.id)).toEqual(["m1", "m2"]);
  });

  it("replaces a message it already has rather than duplicating it", () => {
    writeThreadMessages(VIEWER, CHAT_A, [message("m1", "2026-01-01T00:00:00.000Z", { text: "before" })]);
    const next = patchThreadMessage(VIEWER, CHAT_A, message("m1", "2026-01-01T00:00:00.000Z", { text: "after" }));

    expect(next).toHaveLength(1);
    expect(next?.[0].text).toBe("after");
  });

  it("keeps a stable order for two messages sent in the same millisecond", () => {
    writeThreadMessages(VIEWER, CHAT_A, [message("b", "2026-01-01T00:00:00.000Z")]);
    const next = patchThreadMessage(VIEWER, CHAT_A, message("a", "2026-01-01T00:00:00.000Z"));

    expect(next?.map((row) => row.id)).toEqual(["a", "b"]);
  });

  it("does not invent a thread for a conversation that was never cached", () => {
    expect(patchThreadMessage(VIEWER, "never-opened", message("m1", "2026-01-01T00:00:00.000Z"))).toBeNull();
  });

  it("refuses a patch from a different viewer", () => {
    writeThreadMessages(VIEWER, CHAT_A, [message("m1", "2026-01-01T00:00:00.000Z")]);

    expect(patchThreadMessage(OTHER_VIEWER, CHAT_A, message("m2", "2026-01-01T00:01:00.000Z"))).toBeNull();
  });
});

describe("the cache stays bounded", () => {
  it("evicts the least recently used conversation past the retention limit", () => {
    for (let index = 0; index < 25; index += 1) {
      writeThreadMessages(VIEWER, `chat-${index}`, [message(`m${index}`, "2026-01-01T00:00:00.000Z")]);
    }

    expect(cacheSizeForTests()).toBe(20);
    expect(readThread(VIEWER, "chat-0")).toBeNull();
    expect(readThread(VIEWER, "chat-24")).not.toBeNull();
  });

  it("counts a read as a use, so an actively revisited chat is not evicted", () => {
    writeThreadMessages(VIEWER, "keep-me", [message("m1", "2026-01-01T00:00:00.000Z")]);
    for (let index = 0; index < 19; index += 1) {
      writeThreadMessages(VIEWER, `filler-${index}`, [message(`m${index}`, "2026-01-01T00:00:00.000Z")]);
      // Re-reading keeps it the most recently used entry.
      readThread(VIEWER, "keep-me");
    }
    writeThreadMessages(VIEWER, "one-more", [message("mx", "2026-01-01T00:00:00.000Z")]);

    expect(readThread(VIEWER, "keep-me")).not.toBeNull();
  });
});
