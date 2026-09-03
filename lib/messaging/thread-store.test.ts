import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  clearAllPersistedThreads,
  clearPersistedThreads,
  loadPersistedThread,
  resetPersistedThreadConnectionForTests,
  savePersistedThread,
  MAX_PERSISTED_CONVERSATIONS_FOR_TESTS,
  PERSISTED_WINDOW_FOR_TESTS
} from "@/lib/messaging/thread-store";
import type { CachedThread } from "@/lib/messaging/thread-cache";
import type { ChatMessageView } from "@/lib/messaging/mobile";
import { DEFAULT_CHAT_SETTINGS, DEFAULT_CONVERSATION_USER_PREFERENCES } from "@/lib/messaging/ultimate-types";

/**
 * Durable thread storage.
 *
 * Two things are being protected here. The first is that reopening the app
 * shows the conversation immediately -- the journey the in-memory cache could
 * never help with. The second matters more: this is the first time message text
 * rests on the device, so the account boundary and the teardown paths have to
 * be right, and a browser that refuses to store must degrade to the network
 * rather than break Messaging.
 */

const VIEWER = "viewer-1";
const OTHER = "viewer-2";
const CHAT_A = "chat-a";

function message(id: string): ChatMessageView {
  return {
    id,
    createdAt: "2026-01-01T00:00:00.000Z",
    text: `message ${id}`,
    isMine: false,
    clientMessageId: null
  } as ChatMessageView;
}

function thread(over: Partial<CachedThread> = {}): CachedThread {
  return {
    messages: [message("m1")],
    replyContexts: {},
    optimistic: [],
    updatedAt: Date.now(),
    ...over
  };
}

/**
 * A minimal in-memory IndexedDB good enough for this store's access pattern:
 * get / put / delete / clear by key, plus getAll and getAllKeys on the two
 * indexes it declares. Deliberately hand-rolled rather than pulling in a
 * polyfill dependency for one module.
 */
function installFakeIndexedDB() {
  const rows = new Map<string, Record<string, unknown>>();

  function request<T>(compute: () => T) {
    const req: Record<string, unknown> = { result: undefined, onsuccess: null, onerror: null };
    queueMicrotask(() => {
      try {
        req.result = compute();
        (req.onsuccess as (() => void) | null)?.();
      } catch {
        (req.onerror as (() => void) | null)?.();
      }
    });
    return req;
  }

  function objectStore() {
    const index = (field: string) => ({
      getAll: (value: unknown) =>
        request(() => [...rows.values()].filter((row) => row[field] === value)),
      getAllKeys: (value: unknown) =>
        request(() =>
          [...rows.entries()].filter(([, row]) => row[field] === value).map(([key]) => key)
        )
    });
    return {
      get: (key: string) => request(() => rows.get(key)),
      put: (row: Record<string, unknown>) => request(() => void rows.set(String(row.key), row)),
      delete: (key: string) => request(() => void rows.delete(key)),
      clear: () => request(() => void rows.clear()),
      getAllKeys: () => request(() => [...rows.keys()]),
      index
    };
  }

  (globalThis as Record<string, unknown>).indexedDB = {
    open: () => {
      const req: Record<string, unknown> = { result: null, onsuccess: null, onerror: null, onupgradeneeded: null, onblocked: null };
      queueMicrotask(() => {
        req.result = {
          objectStoreNames: { contains: () => true },
          createObjectStore: () => ({ createIndex: () => undefined }),
          transaction: () => ({ objectStore, onabort: null })
        };
        (req.onsuccess as (() => void) | null)?.();
      });
      return req;
    }
  };
  return rows;
}

function removeIndexedDB() {
  delete (globalThis as Record<string, unknown>).indexedDB;
}

beforeEach(() => {
  resetPersistedThreadConnectionForTests();
});

afterEach(() => {
  removeIndexedDB();
  resetPersistedThreadConnectionForTests();
});

describe("a thread survives closing the app", () => {
  beforeEach(() => installFakeIndexedDB());

  it("reads back what it stored", async () => {
    await savePersistedThread(VIEWER, CHAT_A, thread());

    const restored = await loadPersistedThread(VIEWER, CHAT_A);
    expect(restored?.messages.map((row) => row.id)).toEqual(["m1"]);
  });

  it("keeps unsent messages, so a send interrupted by a close is still retryable", async () => {
    await savePersistedThread(
      VIEWER,
      CHAT_A,
      thread({
        optimistic: [
          {
            clientMessageId: "c1",
            text: "unsent",
            kind: "text",
            durationSeconds: null,
            createdAt: "2026-01-01T00:00:00.000Z",
            status: "failed"
          }
        ]
      })
    );

    const restored = await loadPersistedThread(VIEWER, CHAT_A);
    expect(restored?.optimistic[0].status).toBe("failed");
  });

  it("restores the lightweight settings snapshot after a restart", async () => {
    await savePersistedThread(VIEWER, CHAT_A, thread({
      controls: {
        settings: { ...DEFAULT_CHAT_SETTINGS, messageLifetimeSeconds: 604800 },
        preferences: { ...DEFAULT_CONVERSATION_USER_PREFERENCES, notifyMentionsWhenMuted: false },
        viewerRole: "member",
        updatedAt: 456
      }
    }));

    const restored = await loadPersistedThread(VIEWER, CHAT_A);
    expect(restored?.controls?.settings.messageLifetimeSeconds).toBe(604800);
    expect(restored?.controls?.preferences.notifyMentionsWhenMuted).toBe(false);
  });

  it("stores only the recent tail, not the whole window", async () => {
    const many = Array.from({ length: 200 }, (_, index) => message(`m${index}`));
    await savePersistedThread(VIEWER, CHAT_A, thread({ messages: many }));

    const restored = await loadPersistedThread(VIEWER, CHAT_A);
    expect(restored?.messages).toHaveLength(PERSISTED_WINDOW_FOR_TESTS);
    // The TAIL -- the newest messages, which is where the reader is looking.
    expect(restored?.messages.at(-1)?.id).toBe("m199");
  });

  it("returns null for a conversation never stored", async () => {
    expect(await loadPersistedThread(VIEWER, "never-opened")).toBeNull();
  });
});

describe("one account can never read another's stored messages", () => {
  beforeEach(() => installFakeIndexedDB());

  it("refuses a read for a different viewer", async () => {
    await savePersistedThread(VIEWER, CHAT_A, thread());

    expect(await loadPersistedThread(OTHER, CHAT_A)).toBeNull();
  });

  it("stores the two accounts separately rather than overwriting", async () => {
    await savePersistedThread(VIEWER, CHAT_A, thread({ messages: [message("mine")] }));
    await savePersistedThread(OTHER, CHAT_A, thread({ messages: [message("theirs")] }));

    expect((await loadPersistedThread(VIEWER, CHAT_A))?.messages[0].id).toBe("mine");
    expect((await loadPersistedThread(OTHER, CHAT_A))?.messages[0].id).toBe("theirs");
  });

  it("never stores anything for a signed-out viewer", async () => {
    await savePersistedThread(null, CHAT_A, thread());

    expect(await loadPersistedThread(null, CHAT_A)).toBeNull();
  });

  it("erases one account's threads without touching the other's", async () => {
    await savePersistedThread(VIEWER, CHAT_A, thread());
    await savePersistedThread(OTHER, CHAT_A, thread());

    await clearPersistedThreads(VIEWER);

    expect(await loadPersistedThread(VIEWER, CHAT_A)).toBeNull();
    expect(await loadPersistedThread(OTHER, CHAT_A)).not.toBeNull();
  });

  it("erases everything on a full session teardown", async () => {
    await savePersistedThread(VIEWER, CHAT_A, thread());
    await savePersistedThread(OTHER, CHAT_A, thread());

    await clearAllPersistedThreads();

    expect(await loadPersistedThread(VIEWER, CHAT_A)).toBeNull();
    expect(await loadPersistedThread(OTHER, CHAT_A)).toBeNull();
  });
});

describe("storage stays bounded", () => {
  beforeEach(() => installFakeIndexedDB());

  it("keeps only the most recently updated conversations", async () => {
    for (let index = 0; index < MAX_PERSISTED_CONVERSATIONS_FOR_TESTS + 5; index += 1) {
      await savePersistedThread(VIEWER, `chat-${index}`, thread({ updatedAt: 1000 + index }));
    }

    // The oldest fell out; the newest is still there.
    expect(await loadPersistedThread(VIEWER, "chat-0")).toBeNull();
    expect(await loadPersistedThread(VIEWER, `chat-${MAX_PERSISTED_CONVERSATIONS_FOR_TESTS + 4}`)).not.toBeNull();
  });
});

describe("a browser that refuses to store must not break Messaging", () => {
  it("returns null rather than throwing when IndexedDB is unavailable", async () => {
    removeIndexedDB();
    resetPersistedThreadConnectionForTests();

    // Private browsing, blocked site data, a full disk. Messaging falls back to
    // the in-memory cache and the network, exactly as before this existed.
    await expect(loadPersistedThread(VIEWER, CHAT_A)).resolves.toBeNull();
  });

  it("swallows a write when storage is unavailable", async () => {
    removeIndexedDB();
    resetPersistedThreadConnectionForTests();

    await expect(savePersistedThread(VIEWER, CHAT_A, thread())).resolves.toBeUndefined();
  });

  it("survives a database that fails to open", async () => {
    (globalThis as Record<string, unknown>).indexedDB = {
      open: () => {
        const req: Record<string, unknown> = { onsuccess: null, onerror: null };
        queueMicrotask(() => (req.onerror as (() => void) | null)?.());
        return req;
      }
    };
    resetPersistedThreadConnectionForTests();

    await expect(loadPersistedThread(VIEWER, CHAT_A)).resolves.toBeNull();
  });

  it("survives an open() that throws outright", async () => {
    (globalThis as Record<string, unknown>).indexedDB = {
      open: () => {
        throw new Error("SecurityError");
      }
    };
    resetPersistedThreadConnectionForTests();

    await expect(loadPersistedThread(VIEWER, CHAT_A)).resolves.toBeNull();
  });
});
