import type { ChatMessageView } from "@/lib/messaging/mobile";

/**
 * Signed Storage URLs are short-lived credentials. They must never become the
 * durable identity of a cached attachment because IndexedDB can outlive the
 * URL by hours or days.
 *
 * Keep the canonical media id and display metadata, but remove the credentials
 * before persistence. Existing stored rows are sanitized on read as well, so
 * this fixes already-written stale URLs without a database-version migration.
 */
export function stripEphemeralSignedMediaUrls(messages: readonly ChatMessageView[]): ChatMessageView[] {
  return messages.map((message) => {
    if (!message.attachment) return message;
    return {
      ...message,
      attachment: {
        ...message.attachment,
        thumbUrl: null,
        fullUrl: null
      }
    };
  });
}
