import { resolveNotificationDestination } from "@/lib/notifications/destination";
import type { NotificationDestination } from "@/lib/notifications/destination";

/**
 * HOW A NOTIFICATION ROW BEHAVES WHEN IT IS TAPPED.
 *
 * The product has exactly two kinds of notification, and until now only one of
 * them worked:
 *
 *   ACTIONABLE    it points at something -- a Plan, an Event Room, a
 *                 conversation -- and tapping it goes there.
 *   INFORMATIONAL it IS the message. There is nowhere to go; the words are the
 *                 whole point.
 *
 * The second kind had no interaction at all. A row with no resolver
 * destination rendered as a plain <article>: not a button, not a link, not
 * focusable. Tapping it did nothing, and its body was clipped to a single line
 * by `truncate`, so the text could not even be READ. A notification whose only
 * purpose is to tell you something that you cannot open and cannot finish
 * reading is a dead end.
 *
 * This module decides which path a row takes. Pure, so the decision can be
 * tested without rendering, and shared so the row and the detail sheet can
 * never disagree about whether something is openable.
 */

export type NotificationBehaviour =
  /** Go somewhere. The destination resolved and is worth navigating to. */
  | { kind: "navigate"; destination: NonNullable<NotificationDestination> }
  /** Handled in place by the page (a reply modal, a birthday wish). */
  | { kind: "inline" }
  /** Read it here. No destination exists, so the row opens its own detail. */
  | { kind: "detail" };

export type NotificationBehaviourInput = {
  type: string;
  /** True when the page itself owns the interaction (meetup reply, birthday). */
  handledInline: boolean;
};

/**
 * The one decision, in priority order.
 *
 * Inline first: a meetup request opens a reply modal and deliberately has no
 * resolver destination, so it must not be mistaken for informational. Then a
 * real destination. Everything else opens its detail rather than doing
 * nothing -- which is the whole change. There is no fourth branch, and in
 * particular there is no branch that returns "do nothing", so a dead tap
 * cannot be reintroduced without deleting a case here.
 */
export function resolveNotificationBehaviour(
  input: NotificationBehaviourInput
): NotificationBehaviour {
  if (input.handledInline) return { kind: "inline" };
  const destination = resolveNotificationDestination(input.type);
  if (destination) return { kind: "navigate", destination };
  return { kind: "detail" };
}

/**
 * The absolute timestamp for the detail sheet.
 *
 * The row shows a relative time ("2h"), which is right for scanning and wrong
 * for a record you have opened deliberately -- "2h" tells you nothing a week
 * later. This gives the full date and time, in the viewer's own locale.
 *
 * Returns null rather than a guess when the stored value cannot be parsed, so
 * the sheet omits the line instead of printing "Invalid Date".
 */
export function notificationTimestampLabel(
  createdAtIso: string,
  locale?: string
): string | null {
  const ms = Date.parse(createdAtIso);
  if (!Number.isFinite(ms)) return null;
  return new Intl.DateTimeFormat(locale ?? "en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(ms));
}

/**
 * A human label for where a notification came from.
 *
 * Derived from the SAME `<base>:<id>` convention the destination resolver
 * keys off, so the two can never describe a notification differently. Unknown
 * bases return null and the sheet simply omits the line -- an unrecognised
 * type is not worth inventing a name for.
 */
const SOURCE_LABELS: Record<string, string> = {
  friend_request_received: "Muddies",
  friend_request_accepted: "Muddies",
  friend_nearby: "Proximity",
  best_buddy_nearby: "Proximity",
  circle_nearby: "Proximity",
  wave: "Muddies",
  meeting_ping: "Meeting pings",
  meetup_request: "Meeting pings",
  plan: "Plans",
  hangout: "UpFor",
  safe_arrival: "Safe Arrival",
  event: "Events",
  event_room: "Event Rooms",
  moment: "Moments",
  drop: "Drops",
  message: "Messages",
  group_message: "Groups",
  group: "Groups",
  linkr_connection: "Linkr",
  achievement: "Badges",
  birthday: "Birthdays",
  subscription_update: "Billing",
  system_alert: "Mad Buddy"
};

export function notificationSourceLabel(type: string): string | null {
  const separator = type.indexOf(":");
  const base = separator === -1 ? type : type.slice(0, separator);
  return SOURCE_LABELS[base] ?? null;
}

/**
 * Copy for a destination that no longer resolves.
 *
 * A notification outlives the thing it points at: a Plan is cancelled, an
 * Event Room is archived, a message is deleted. The row should still open --
 * the words are still worth reading -- and the sheet should say plainly why
 * there is nowhere to go, rather than offering a button that lands on an
 * error.
 */
export const NOTIFICATION_STALE_TARGET_MESSAGE =
  "This item is no longer available.";

/**
 * Whether this notification named a SPECIFIC item that can no longer be found.
 *
 * The distinction the sheet needs, and it is narrower than it first looks.
 * `plan:<uuid>` resolves to that plan. `plan:<garbage>` falls back to /plans --
 * deliberately, so a removed record lands on a valid section rather than a
 * dead per-item URL. In that second case the notification DID point at
 * something specific, and that something is gone: worth saying.
 *
 * A notification that never named an item (`system_alert`, a bare base) has
 * lost nothing, so it gets no such line -- telling its reader something is
 * "no longer available" would invent a loss that never happened.
 */
export function hasStaleTarget(type: string): boolean {
  const separator = type.indexOf(":");
  if (separator === -1) return false;
  const entityId = type.slice(separator + 1);
  if (!entityId) return false;

  // It named an item. Did the resolver actually use that id?
  const destination = resolveNotificationDestination(type);
  if (!destination) return true;
  return !destination.href.includes(encodeURIComponent(entityId.split(":")[0]));
}
