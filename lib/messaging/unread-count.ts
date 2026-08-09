/**
 * Client-safe unread aggregation shared by the App Shell and focused tests.
 *
 * Keep this separate from `lib/messaging/mobile.ts`: that module performs
 * privileged server reads and notification delivery and must never enter a
 * browser dependency graph.
 */
export function sumUnreadConversationCounts(
  previews: Array<{ unread_count?: number | null; unreadCount?: number | null } | undefined | null>
): number {
  return previews.reduce((total, preview) => total + (preview?.unread_count ?? preview?.unreadCount ?? 0), 0);
}
