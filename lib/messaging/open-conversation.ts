import type { Route } from "next";

/**
 * The canonical destination for one direct conversation.
 *
 * Every "Message this person" affordance ends here. Three separate surfaces
 * previously navigated to a bare `/messages` instead — the quick-view modal,
 * the Muddies list, and (via a stale-list guard) the Messages page itself —
 * which dropped the user on the inbox to find the person again. One helper
 * means there is a single spelling of the destination to get right.
 *
 * The id must be one the SERVER returned from openDirectConversationAction:
 * it resolves or creates the canonical direct conversation for the user pair
 * and re-checks eligibility. Never build this from a username.
 */
export function conversationHref(conversationId: string): Route {
  return `/messages?conversation=${conversationId}` as Route;
}
