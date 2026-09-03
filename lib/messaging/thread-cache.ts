/**
 * The Messaging thread cache (M1).
 *
 * THE PROBLEM THIS SOLVES. The cache used to be a `useRef` Map owned by
 * MessagesPageV4. `/messages` is `force-dynamic` and the App Router keeps no
 * client cache for a dynamic route, so tapping another bottom-nav tab and
 * coming back remounted the component and threw every cached thread away.
 * Reopening a conversation the person had *just* been reading was a cold
 * network load, every single time -- the "why does it load again?" symptom.
 *
 * WHY MODULE SCOPE. A module singleton outlives any one component mount while
 * still dying with the JS context, which is exactly the lifetime M1 needs: it
 * survives A -> B -> A and it survives leaving and returning to /messages.
 * It deliberately does NOT survive a page refresh or an app restart -- that is
 * persistent storage (IndexedDB / native), and it is a later tranche. Keeping
 * the cache in memory also means there is no at-rest copy of anybody's
 * messages on the device, which is the conservative default for a surface
 * this private.
 *
 * WHAT THIS IS NOT. It is not an authorization boundary. Nothing here decides
 * who may read a conversation; the server and RLS remain the only authority.
 * A cached thread is a redraw of something the server already served THIS
 * viewer, and every open still reconciles against the server. If access has
 * been revoked since, the reconciliation returns nothing and the thread
 * empties -- the cache cannot keep a door open that the server has closed.
 */

import { registerUserScopedMemoryStore } from "@/lib/auth/client-session";
import type { ChatMessageView } from "@/lib/messaging/mobile";
import type { OptimisticMessage } from "@/lib/messaging/optimistic-messages";

export type ReplyContextMap = Record<
  string,
  { replyToMessageId: string; senderName: string; text: string }
>;

export type CachedThread = {
  messages: ChatMessageView[];
  replyContexts: ReplyContextMap;
  /**
   * Outgoing rows that have not been confirmed by the server yet.
   *
   * These live in the cache rather than in component state because a pending
   * or failed send belongs to ITS conversation, not to whichever conversation
   * happens to be selected (M2). Switching threads must not be able to
   * destroy somebody's unsent message.
   */
  optimistic: OptimisticMessage[];
  /** When the server rows were last reconciled. Drives staleness display only. */
  updatedAt: number;
};

/**
 * How many conversations to retain.
 *
 * Chosen for what it buys, not as a round number: the cache exists to make
 * RE-entering a recent conversation instant, and people cycle through a small
 * working set of chats. Twenty covers that working set comfortably while
 * bounding worst-case memory at roughly twenty threads' worth of already-
 * projected rows. Beyond that the entries stop being re-opened and only cost
 * memory, so the least-recently-used one is evicted.
 */
const MAX_CACHED_CONVERSATIONS = 20;

type CacheState = {
  /** The account this cache belongs to. Never null once anything is stored. */
  ownerId: string | null;
  /** Insertion-ordered: JS Map iteration order gives LRU eviction for free. */
  threads: Map<string, CachedThread>;
};

const state: CacheState = { ownerId: null, threads: new Map() };

/**
 * Tear down with the session, through the same path that clears browser
 * storage. Registered at module load rather than from a component, so a cache
 * that was populated is always cleared even if Messaging is not mounted at
 * the moment the person logs out.
 */
if (typeof window !== "undefined") {
  registerUserScopedMemoryStore(() => clearThreadCache());
}

/**
 * Binds the cache to an account, clearing it if the viewer changed.
 *
 * THE ACCOUNT BOUNDARY. Module scope outlives a component, and on a shared
 * device it could outlive a logout too, so ownership is explicit rather than
 * assumed. Any read or write for a different viewer wipes the cache first, so
 * User B can never be served a redraw of User A's conversation. This is a
 * privacy guard on cached PRESENTATION, not a substitute for authorization --
 * the server still refuses the data itself.
 */
export function bindThreadCacheOwner(ownerId: string | null): void {
  const previousOwner = state.ownerId;
  if (previousOwner === ownerId) return;
  state.threads.clear();
  state.ownerId = ownerId;
  /* The previous account's messages are now at rest on this device, so
     changing accounts has to erase them rather than merely stop reading them.
     Only the OUTGOING owner is wiped: signing in as somebody else must not
     discard the threads of an account that may sign back in. */
  if (previousOwner && typeof window !== "undefined") {
    void import("@/lib/messaging/thread-store")
      .then(({ clearPersistedThreads }) => clearPersistedThreads(previousOwner))
      .catch(() => {
        // Best effort: memory is already cleared above.
      });
  }
}

/** Drops everything, in memory and on the device. Call on logout. */
export function clearThreadCache(): void {
  state.threads.clear();
  state.ownerId = null;
  if (typeof window === "undefined") return;
  void import("@/lib/messaging/thread-store")
    .then(({ clearAllPersistedThreads }) => clearAllPersistedThreads())
    .catch(() => {
      // Memory is cleared regardless; storage is wiped again on next sign-in.
    });
}

function ownedBy(ownerId: string | null): boolean {
  return state.ownerId !== null && state.ownerId === ownerId;
}

/**
 * The cached thread for one conversation, or null.
 *
 * Returns null rather than throwing for a mismatched owner: a caller that
 * has just switched accounts should get a cold load, not an error.
 */
export function readThread(ownerId: string | null, conversationId: string): CachedThread | null {
  if (!ownedBy(ownerId)) return null;
  const entry = state.threads.get(conversationId);
  if (!entry) return null;
  // Re-insert so the most recently READ thread is also the most recently used.
  state.threads.delete(conversationId);
  state.threads.set(conversationId, entry);
  return entry;
}

function evictIfNeeded(): void {
  while (state.threads.size > MAX_CACHED_CONVERSATIONS) {
    const oldest = state.threads.keys().next();
    if (oldest.done) return;
    state.threads.delete(oldest.value);
  }
}

/**
 * Mirrors a thread to durable storage, fire-and-forget.
 *
 * Never awaited and never allowed to reject: persistence is a courtesy to the
 * NEXT app launch, and a device that refuses to store must not make this one
 * slower or noisier. The in-memory cache is already correct by the time this
 * runs.
 */
function persist(conversationId: string, entry: CachedThread): void {
  const ownerId = state.ownerId;
  if (!ownerId || typeof window === "undefined") return;
  void import("@/lib/messaging/thread-store")
    .then(({ savePersistedThread }) => savePersistedThread(ownerId, conversationId, entry))
    .catch(() => {
      // Storage is optional. Messaging works without it.
    });
}

function put(conversationId: string, entry: CachedThread): void {
  state.threads.delete(conversationId);
  state.threads.set(conversationId, entry);
  evictIfNeeded();
  persist(conversationId, entry);
}

/**
 * Seeds the in-memory cache from durable storage.
 *
 * Returns the thread so a caller can paint it, and only fills a conversation
 * the memory cache does not already hold -- memory is always the fresher of
 * the two, so a stored copy must never overwrite it.
 */
export async function hydrateThreadFromStore(
  ownerId: string | null,
  conversationId: string
): Promise<CachedThread | null> {
  if (!ownedBy(ownerId) || typeof window === "undefined") return null;
  if (state.threads.has(conversationId)) return state.threads.get(conversationId) ?? null;
  try {
    const { loadPersistedThread } = await import("@/lib/messaging/thread-store");
    const stored = await loadPersistedThread(ownerId, conversationId);
    // Re-check ownership: the account can change while this await is pending.
    if (!stored || !ownedBy(ownerId) || state.threads.has(conversationId)) return null;
    state.threads.set(conversationId, stored);
    evictIfNeeded();
    return stored;
  } catch {
    return null;
  }
}

/**
 * Stores the server's rows for a conversation.
 *
 * Optimistic rows are preserved across the write, because a reconciliation
 * that landed while something was still sending must not erase the thing
 * being sent. `replyContexts` is merged rather than replaced when the caller
 * has none: the message payload and the reply metadata arrive from separate
 * requests, and the faster one must not blank the slower one's result.
 */
export function writeThreadMessages(
  ownerId: string | null,
  conversationId: string,
  messages: ChatMessageView[],
  replyContexts?: ReplyContextMap
): void {
  if (!ownedBy(ownerId)) return;
  const existing = state.threads.get(conversationId);
  put(conversationId, {
    messages,
    replyContexts: replyContexts ?? existing?.replyContexts ?? {},
    optimistic: existing?.optimistic ?? [],
    updatedAt: Date.now()
  });
}

/** Stores reply metadata without disturbing the cached message rows. */
export function writeThreadReplyContexts(
  ownerId: string | null,
  conversationId: string,
  replyContexts: ReplyContextMap
): void {
  if (!ownedBy(ownerId)) return;
  const existing = state.threads.get(conversationId);
  if (!existing) return;
  put(conversationId, { ...existing, replyContexts });
}

/**
 * Stores the outgoing rows for a conversation (M2).
 *
 * Creates an entry if the conversation has none yet, so the very first
 * message sent into a brand-new chat is still protected by a thread switch.
 */
export function writeThreadOptimistic(
  ownerId: string | null,
  conversationId: string,
  optimistic: OptimisticMessage[]
): void {
  if (!ownedBy(ownerId)) return;
  const existing = state.threads.get(conversationId);
  put(conversationId, {
    messages: existing?.messages ?? [],
    replyContexts: existing?.replyContexts ?? {},
    optimistic,
    updatedAt: existing?.updatedAt ?? 0
  });
}

/**
 * Applies one Realtime row to a cached thread without a refetch.
 *
 * Ordered by `createdAt` with the id as the tiebreak so two messages sent in
 * the same millisecond keep a stable order rather than swapping on each
 * patch. An id already present is REPLACED, not appended, which is what makes
 * an edit, a delete tombstone or a status change land correctly -- and is
 * also the duplicate guard when the Realtime echo races the send response.
 */
export function patchThreadMessage(
  ownerId: string | null,
  conversationId: string,
  message: ChatMessageView
): ChatMessageView[] | null {
  if (!ownedBy(ownerId)) return null;
  const existing = state.threads.get(conversationId);
  if (!existing) return null;

  const next = mergeThreadMessage(existing.messages, message);

  put(conversationId, { ...existing, messages: next, updatedAt: Date.now() });
  return next;
}

/** Pure merge used by both the cache and the selected-thread React state. */
export function mergeThreadMessage(
  messages: ChatMessageView[],
  message: ChatMessageView
): ChatMessageView[] {
  const index = messages.findIndex((row) => row.id === message.id);
  return index >= 0
    ? messages.map((row) => (row.id === message.id ? message : row))
    : [...messages, message].sort((a, b) => {
        const byTime = Date.parse(a.createdAt) - Date.parse(b.createdAt);
        return byTime !== 0 ? byTime : a.id.localeCompare(b.id);
      });
}

/** Applies several independently projected Realtime rows deterministically. */
export function mergeThreadPatches(
  messages: ChatMessageView[],
  patches: Iterable<ChatMessageView>
): ChatMessageView[] {
  let merged = messages;
  for (const patch of patches) merged = mergeThreadMessage(merged, patch);
  return merged;
}

/** Test/diagnostic view. Never used to make product decisions. */
export function cacheSizeForTests(): number {
  return state.threads.size;
}
