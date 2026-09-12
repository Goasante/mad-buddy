import { isBuiltForMobile, toMobilePath } from "@/lib/platform/routes.mobile";
import type { NotificationDestination } from "@/lib/notifications/destination";

/**
 * Decides what a notification row should do in the NATIVE app.
 *
 * The resolver in destination.ts answers "where does this notification point",
 * which is a product question with one answer. Whether that destination can be
 * reached is a platform question, and the two apps genuinely differ:
 *
 *   DEAD ENDS      /linkr, /drops, /hangout-mode and /badges do not exist in
 *                  the SPA, so they fall through to its "*" catch-all. A row
 *                  that looks tappable and lands on an unavailable screen is
 *                  worse than one that plainly does not navigate.
 *
 *   NO DEEP ROUTE  /groups/<id> resolves to a group's detail page. Android has
 *                  /groups (the list) and no detail route, so the id cannot be
 *                  honoured. Better to open nothing than the wrong group.
 *
 *   QUERY IGNORED  No SPA screen reads query parameters yet, so
 *                  /plans?plan=<id>, /events?event=<id> and
 *                  /friends?tab=requests open the right screen but not the
 *                  intended item. That is a partial answer, not a wrong one,
 *                  so those links stay — degraded knowingly rather than
 *                  silently — and the query is stripped so nothing suggests a
 *                  precision the screen does not deliver.
 *
 *   DEEP-LINKED    /messages?conversation=<id> is the exception: the SPA
 *                  already has /messages/:id, so the id is rewritten into the
 *                  path and the thread opens directly.
 *
 * Returning null makes the row render as plain content, which the shared
 * component already handles for informational notifications.
 */
export function resolveMobileNotificationDestination(
  destination: NotificationDestination
): NotificationDestination {
  if (!destination) return null;

  const [rawPath = "", rawQuery = ""] = destination.href.split("?");

  /* THE ONE DEEP LINK ANDROID CAN HONOUR TODAY.
     /messages?conversation=<id> carries the thread id in a query the SPA does
     not read, but /messages/:id is a real route. Rewriting the shape is what
     turns "opens the inbox" into "opens the conversation". */
  if (rawPath === "/messages" && rawQuery) {
    const conversationId = new URLSearchParams(rawQuery).get("conversation");
    if (conversationId) {
      return { type: "internal", href: `/messages/${conversationId}` as NonNullable<NotificationDestination>["href"] };
    }
  }

  /* A group notification names a specific group, and Android has only the
     list. Opening the list would answer a different question from the one the
     notification asked, so the row does not navigate at all. */
  if (rawPath.startsWith("/groups/")) return null;

  const mobilePath = toMobilePath(rawPath);
  if (!isBuiltForMobile(mobilePath)) return null;

  /* Everything reachable keeps its path and loses its query: no screen reads
     one, and carrying it would imply a precision that does not exist. When a
     screen learns to read its parameters, drop it from this list rather than
     preserving queries wholesale — the link should only promise what the
     destination can actually do. */
  return { type: "internal", href: mobilePath as NonNullable<NotificationDestination>["href"] };
}
