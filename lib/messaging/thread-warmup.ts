import type { ConversationView } from "@/lib/messaging/mobile";
import type { CachedThread } from "@/lib/messaging/thread-cache";

/** Four small tails: enough to cover the most likely taps without a data flood. */
export const MAX_PROACTIVE_WARM_THREADS = 4;
export const PROACTIVE_WARM_MESSAGE_LIMIT = 32;

/**
 * Selected first, then the three most recent rows, then unread rows if budget
 * remains. listConversations already supplies newest-first order.
 */
export function selectWarmConversations(
  conversations: ConversationView[],
  selectedId: string | null,
  limit = MAX_PROACTIVE_WARM_THREADS
): ConversationView[] {
  if (limit <= 0) return [];
  const byId = new Map(conversations.map((conversation) => [conversation.id, conversation]));
  const result: ConversationView[] = [];
  const add = (conversation: ConversationView | undefined) => {
    if (conversation && !result.some((item) => item.id === conversation.id) && result.length < limit) {
      result.push(conversation);
    }
  };

  if (selectedId) add(byId.get(selectedId));
  conversations.slice(0, 3).forEach(add);
  conversations.filter((conversation) => conversation.unreadCount > 0).forEach(add);
  conversations.forEach(add);
  return result;
}

/**
 * Inbox metadata is a cheap freshness signal. A known-empty thread is current
 * when the inbox also has no last message; otherwise a missing/newer tail is
 * warmed from the server.
 */
export function shouldRefreshWarmThread(
  thread: CachedThread | null,
  inboxLastMessageAt: string | null
): boolean {
  if (!thread) return true;
  if (!inboxLastMessageAt) return false;
  const latest = thread.messages.at(-1)?.createdAt;
  if (!latest) return true;
  const inboxTime = Date.parse(inboxLastMessageAt);
  const cachedTime = Date.parse(latest);
  return !Number.isFinite(inboxTime) || !Number.isFinite(cachedTime) || cachedTime < inboxTime;
}
