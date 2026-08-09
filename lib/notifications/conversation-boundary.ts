/**
 * Chat unread state belongs to Messages, not Pulse. These are the historical
 * and current notification type prefixes used only to deliver conversation
 * pushes. They must never contribute to the Pulse feed or bell badge.
 */
export const CONVERSATION_NOTIFICATION_TYPE_PATTERNS = ["message:%", "group_message:%"] as const;

export function isConversationMessageNotificationType(type: string): boolean {
  const base = type.split(":", 1)[0];
  return base === "message" || base === "group_message";
}
