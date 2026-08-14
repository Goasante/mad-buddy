/**
 * Reconciling the server's conversation list with the client's copy.
 *
 * PURE. No React, no network, no clock -- the merge rule is the thing that
 * decides whether a person who just started a conversation can see it, so it
 * has to be assertable as arithmetic rather than observed in a browser.
 *
 * THE BUG THIS EXISTS FOR. `conversations` was seeded once with
 * `useState(initialConversations)`. A useState initialiser ignores later
 * props, so `router.refresh()` could re-render the server component all it
 * liked and the client list never changed. Every setConversations call was a
 * `.map()` over existing rows -- five of them, not one able to ADD a row. So a
 * conversation created moments ago could not enter the list by any path, and
 * the only cure was a full page load. That is exactly why closing and
 * reopening the app made conversations appear.
 *
 * WHY NOT JUST OVERWRITE WITH THE SERVER LIST. The client holds state the
 * server has not caught up with yet: a pin that is still in flight, a
 * conversation marked read a moment ago, a mute toggled optimistically.
 * Replacing wholesale would flick those back to their old values and then
 * forward again -- the visible symptom being an unread badge that reappears
 * for a second after you open a conversation. So the merge is field-aware
 * rather than row-aware.
 */

/**
 * The parts of a conversation this module reasons about.
 *
 * Deliberately structural rather than importing ConversationView from
 * lib/messaging/mobile: that module performs privileged server reads and must
 * never be pulled into a browser dependency graph, and the merge only needs
 * these fields. Any wider row type flows through untouched.
 */
export type MergeableConversation = {
  id: string;
  unreadCount: number;
  pinned: boolean;
  muted: boolean;
};

/**
 * Fields the CLIENT owns while a mutation is in flight.
 *
 * Each is a value the user just chose by tapping something. The server will
 * agree shortly; until it does, the local answer is the truthful one because
 * it is what the person actually did.
 */
const CLIENT_OWNED = ["pinned", "muted"] as const;

/**
 * Merge a freshly-fetched server list into the current client list.
 *
 * Rules, in order of what they protect:
 *
 * 1. NEW ROWS ARRIVE. A conversation present on the server and absent locally
 *    is added. This is the whole point -- it is what makes a just-created
 *    conversation appear without a page load.
 *
 * 2. SERVER ORDER WINS. The server returns conversations ordered by
 *    last_message_at, and that ordering is a fact about the data rather than a
 *    client preference, so the merged list follows the server's sequence.
 *    There is no client-side sort to preserve.
 *
 * 3. CLIENT-OWNED FIELDS SURVIVE. pinned and muted keep their local values
 *    when a mutation for them is still in flight, so an optimistic toggle does
 *    not visibly bounce back.
 *
 * 4. UNREAD ONLY DECREASES LOCALLY. If the client has marked a conversation
 *    read (0) the server's older non-zero count must not resurrect the badge.
 *    But a genuinely NEW message arriving from the server -- a higher count on
 *    a row the client has not just read -- must still come through, otherwise
 *    the inbox would go permanently deaf.
 *
 * 5. ROWS DISAPPEAR ONLY ON THE SERVER'S SAY-SO. A row the server no longer
 *    returns is gone (left, deleted, removed) and is dropped. `pendingIds`
 *    exempts rows created so recently that this response may predate them.
 */
export function mergeConversations<T extends MergeableConversation>(
  local: readonly T[],
  server: readonly T[],
  options: { locallyReadIds?: ReadonlySet<string>; pendingIds?: ReadonlySet<string> } = {}
): T[] {
  const locallyRead = options.locallyReadIds ?? new Set<string>();
  const pending = options.pendingIds ?? new Set<string>();
  const localById = new Map(local.map((row) => [row.id, row]));
  const serverIds = new Set(server.map((row) => row.id));

  const merged = server.map((serverRow) => {
    const localRow = localById.get(serverRow.id);
    if (!localRow) return serverRow;

    const next = { ...serverRow } as T;
    for (const field of CLIENT_OWNED) {
      (next as MergeableConversation)[field] = (localRow as MergeableConversation)[field];
    }
    // Rule 4: a local read is authoritative until the server reflects it, but
    // only downwards -- new arrivals still raise the count.
    if (locallyRead.has(serverRow.id) && serverRow.unreadCount > 0) {
      (next as MergeableConversation).unreadCount = 0;
    }
    return next;
  });

  // Rule 5: keep local-only rows that are too new for this response to know
  // about, so an in-flight creation is never erased by a slower list fetch.
  const survivingLocal = local.filter((row) => !serverIds.has(row.id) && pending.has(row.id));

  return [...survivingLocal, ...merged];
}

/**
 * Insert or replace exactly one conversation, keeping ids unique.
 *
 * Used the moment the server resolves a direct conversation: the row is put in
 * front so the person sees what they just opened, unless it is already present
 * -- in which case the existing row is updated in place and NOT duplicated,
 * which is what makes "message someone you already have a thread with" reuse
 * the canonical row instead of stacking a second one.
 */
export function upsertConversation<T extends MergeableConversation>(
  conversations: readonly T[],
  row: T
): T[] {
  const index = conversations.findIndex((existing) => existing.id === row.id);
  if (index === -1) return [row, ...conversations];
  const next = [...conversations];
  next[index] = { ...next[index], ...row };
  return next;
}
