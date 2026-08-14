/**
 * Whether a conversation belongs in this member's inbox.
 *
 * PURE. No database, no clock of its own -- "should I see this chat" decides
 * whether somebody's conversation disappears, so it has to be assertable as
 * arithmetic rather than observed in a browser.
 *
 * WHAT HIDING IS. A direct conversation is one row shared by two people, so
 * there is no safe way to delete it for one of them. Hiding is recorded on the
 * MEMBERSHIP instead: `hidden_at` on the viewer's own row. The conversation,
 * its messages and the other person's inbox are untouched.
 *
 * WHAT BRINGS IT BACK. A hidden chat should return when the conversation
 * genuinely resumes -- somebody says something. It must NOT return because of
 * bookkeeping: a Circle rename or an admin change is not a resumed
 * conversation, and letting those resurrect a chat somebody deliberately put
 * away is the same confusion that made system events count as unread mail.
 *
 * So the authority is `last_user_message_at` -- the newest NON-SYSTEM message,
 * computed by the conversation_previews RPC. Deliberately not
 * `conversations.last_message_at`, which publishSystemMessage also advances.
 */

export type ConversationVisibilityInput = {
  /** When this member hid the conversation. Null means never hidden. */
  hiddenAt: string | null;
  /**
   * Newest message sent by a person, system events excluded. Null when the
   * conversation contains nothing but system events (or nothing at all).
   */
  lastUserMessageAt: string | null;
};

/** Milliseconds, or null when absent or unparseable. */
function parseMs(value: string | null): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Is this conversation visible to the member who hid it?
 *
 * Fails OPEN. An unreadable or missing timestamp shows the conversation rather
 * than hiding it: wrongly showing a chat is a small annoyance the person can
 * fix with one tap, while wrongly hiding one silently removes a conversation
 * they may be waiting on.
 */
export function isConversationVisible(input: ConversationVisibilityInput): boolean {
  const hiddenMs = parseMs(input.hiddenAt);
  // Never hidden, or a timestamp that cannot be read: visible.
  if (hiddenMs === null) return true;

  const lastUserMs = parseMs(input.lastUserMessageAt);
  // Hidden, and nobody has spoken since -- including the case where the only
  // activity since was a system event, which must not resurrect it.
  if (lastUserMs === null) return false;

  return lastUserMs > hiddenMs;
}

/**
 * Does sending a message make a hidden conversation reappear?
 *
 * Yes, and for the sender too: deliberately messaging somebody you had hidden
 * is an unambiguous statement that you want that conversation back. This is
 * the same rule as above -- the send writes a user message, whose timestamp is
 * newer than hidden_at -- stated separately because it is a product promise
 * worth testing on its own.
 */
export function sendingUnhides(hiddenAt: string | null, sentAt: string): boolean {
  return isConversationVisible({ hiddenAt, lastUserMessageAt: sentAt });
}
