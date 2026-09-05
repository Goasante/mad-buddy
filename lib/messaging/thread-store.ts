/**
 * Durable thread storage (M1b).
 *
 * WHY THIS EXISTS. M1 put the thread cache in module memory, which survives a
 * component unmount and a bottom-nav round trip but dies with the JS context.
 * That covered switching between chats and leaving /messages -- and missed the
 * journey that actually matters to this product's users: closing the app or
 * refreshing and coming back. For somebody who re-enters Mad Buddy that way,
 * an in-memory cache never helps even once, and every chat is a cold open
 * forever. The evidence asked for persistence, so this is persistence.
 *
 * WHY IndexedDB. Message rows are exactly its workload: bounded, keyed,
 * append-mostly, read on every open. localStorage is disqualified twice over --
 * a 5 MB ceiling that a few hundred projected messages will breach, and
 * synchronous main-thread access on the very path we are trying to make fast.
 *
 * WHAT IT IS NOT. Not an authorization boundary and not a source of truth.
 * Every open still reconciles against the server, and a viewer whose access was
 * revoked gets an empty list back that overwrites whatever was stored. This can
 * redraw what the server already served THIS account; it can never keep open a
 * door the server has closed.
 *
 * THE PRIVACY COST, STATED PLAINLY. Persisting means message text now rests on
 * the device where it did not before. That is a real change, so it is bounded
 * deliberately: only the recent window for recently-opened conversations, wiped
 * on logout and on any account change, and never written at all for a viewer
 * the store does not own.
 */

import type { ChatMessageView } from "@/lib/messaging/mobile";
import type { OptimisticMessage } from "@/lib/messaging/optimistic-messages";
import type {
  CachedConversationControls,
  CachedThread,
  ReplyContextMap
} from "@/lib/messaging/thread-cache";

const DB_NAME = "mad-buddy:messaging";
const DB_VERSION = 1;
const THREADS = "threads";

/**
 * How many messages are persisted per conversation.
 *
 * Deliberately smaller than the 200-row network window. Fifty is comfortably
 * more than fills any phone viewport, so the reader never sees the boundary --
 * they scroll a little and the reconciled 200 have already arrived -- while
 * keeping each stored record small enough that a full working set of chats
 * stays well inside a mobile storage budget. Persisting all 200 would multiply
 * the at-rest footprint fourfold to cover screens nobody looks at first.
 */
const PERSISTED_WINDOW = 50;

/** Matches the in-memory retention, so the two layers evict alike. */
const MAX_PERSISTED_CONVERSATIONS = 20;

type StoredThread = {
  key: string;
  ownerId: string;
  conversationId: string;
  messages: ChatMessageView[];
  replyContexts: ReplyContextMap;
  optimistic: OptimisticMessage[];
  controls?: CachedConversationControls;
  updatedAt: number;
};

function storageKey(ownerId: string, conversationId: string) {
  return `${ownerId}:${conversationId}`;
}

let dbPromise: Promise<IDBDatabase | null> | null = null;

/**
 * Opens the database, or resolves null when it cannot be used.
 *
 * Null is a first-class answer, not an error path. Private browsing, a full
 * disk, a browser configured to block site data and Safari's eviction all make
 * IndexedDB unavailable, and Messaging has to work anyway -- it simply falls
 * back to the in-memory cache and the network, exactly as it did before this
 * file existed. Nothing here is ever allowed to throw into a render.
 */
function openDatabase(): Promise<IDBDatabase | null> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    if (typeof indexedDB === "undefined") {
      resolve(null);
      return;
    }
    let request: IDBOpenDBRequest;
    try {
      request = indexedDB.open(DB_NAME, DB_VERSION);
    } catch {
      resolve(null);
      return;
    }
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(THREADS)) {
        const store = db.createObjectStore(THREADS, { keyPath: "key" });
        // Owner-scoped wipes and LRU eviction are both index reads, never a
        // full scan of everybody's conversations.
        store.createIndex("ownerId", "ownerId", { unique: false });
        store.createIndex("updatedAt", "updatedAt", { unique: false });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
    request.onblocked = () => resolve(null);
  });
  return dbPromise;
}

function transact<T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>
): Promise<T | null> {
  return openDatabase().then(
    (db) =>
      new Promise<T | null>((resolve) => {
        if (!db) {
          resolve(null);
          return;
        }
        try {
          const tx = db.transaction(THREADS, mode);
          const request = run(tx.objectStore(THREADS));
          request.onsuccess = () => resolve(request.result ?? null);
          request.onerror = () => resolve(null);
          tx.onabort = () => resolve(null);
        } catch {
          resolve(null);
        }
      })
  );
}

/**
 * Reads one stored thread.
 *
 * The owner is part of the key rather than a field checked afterwards, so a
 * lookup for the wrong account cannot match a row at all -- there is no path
 * where User B's read finds User A's conversation and then relies on a
 * comparison to reject it.
 */
export async function loadPersistedThread(
  ownerId: string | null,
  conversationId: string
): Promise<CachedThread | null> {
  if (!ownerId) return null;
  const stored = await transact<StoredThread>("readonly", (store) =>
    store.get(storageKey(ownerId, conversationId)) as IDBRequest<StoredThread>
  );
  if (!stored || stored.ownerId !== ownerId) return null;
  return {
    messages: stored.messages ?? [],
    replyContexts: stored.replyContexts ?? {},
    optimistic: stored.optimistic ?? [],
    controls: stored.controls,
    updatedAt: stored.updatedAt ?? 0
  };
}

/** Persists the recent tail of a thread. Never awaited by the render path. */
export async function savePersistedThread(
  ownerId: string | null,
  conversationId: string,
  thread: CachedThread
): Promise<void> {
  if (!ownerId) return;
  const record: StoredThread = {
    key: storageKey(ownerId, conversationId),
    ownerId,
    conversationId,
    // Only the tail. The reader is at the bottom of a thread when they open it.
    messages: thread.messages.slice(-PERSISTED_WINDOW),
    replyContexts: thread.replyContexts,
    /* Outgoing rows are persisted too, so a send that was still in flight when
       the app was closed is still visible -- and still retryable -- when it is
       reopened, rather than silently disappearing with the tab. */
    optimistic: thread.optimistic,
    controls: thread.controls,
    updatedAt: thread.updatedAt || Date.now()
  };
  await transact("readwrite", (store) => store.put(record));
  await evictOldest(ownerId);
}

/** Keeps only the most recently updated conversations for this account. */
async function evictOldest(ownerId: string): Promise<void> {
  const rows = await transact<StoredThread[]>("readonly", (store) =>
    store.index("ownerId").getAll(ownerId) as IDBRequest<StoredThread[]>
  );
  if (!rows || rows.length <= MAX_PERSISTED_CONVERSATIONS) return;
  const doomed = [...rows]
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(MAX_PERSISTED_CONVERSATIONS);
  for (const row of doomed) {
    await transact("readwrite", (store) => store.delete(row.key));
  }
}

/**
 * Removes every stored thread for one account.
 *
 * Called on logout and on an account change. Deleting by the owner index rather
 * than clearing the whole store means signing in as somebody else on a shared
 * device does not silently discard the first account's data while they are
 * still, from the browser's point of view, a returning user.
 */
export async function clearPersistedThreads(ownerId: string | null): Promise<void> {
  const keys = await transact<IDBValidKey[]>("readonly", (store) =>
    ownerId
      ? (store.index("ownerId").getAllKeys(ownerId) as IDBRequest<IDBValidKey[]>)
      : (store.getAllKeys() as IDBRequest<IDBValidKey[]>)
  );
  for (const key of keys ?? []) {
    await transact("readwrite", (store) => store.delete(key));
  }
}

/** Wipes everything, for a session teardown that cannot name the account. */
export async function clearAllPersistedThreads(): Promise<void> {
  await transact("readwrite", (store) => store.clear());
}

/** Test seam. Lets a suite point at a fresh database between cases. */
export function resetPersistedThreadConnectionForTests(): void {
  dbPromise = null;
}

export const PERSISTED_WINDOW_FOR_TESTS = PERSISTED_WINDOW;
export const MAX_PERSISTED_CONVERSATIONS_FOR_TESTS = MAX_PERSISTED_CONVERSATIONS;
