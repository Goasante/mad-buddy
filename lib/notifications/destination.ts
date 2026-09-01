import type { Route } from "next";

/**
 * Central resolver that turns a stored notification `type` into where the row
 * should take the user. It is the single source of truth for notification
 * routing so Pulse, Home "Recent activity" and any future notification preview
 * never grow their own divergent switch statements.
 *
 * The only structured destination metadata this product stores is the
 * `type` string itself, using the existing `"<base>:<id>"` convention (see
 * CreateNotificationInput in lib/notifications/server.ts). There is no separate
 * payload/entity column, so this resolver keys purely off the base type and
 * routes to the relevant feature surface. Per-record deep links (e.g. a single
 * plan page) are not part of the current routing model, so a removed record
 * still lands on a valid section rather than a dead per-item URL.
 *
 * `meetup_request` is deliberately absent: it opens an in-place reply modal on
 * the Pulse page (an action, not a route), which the page layers on top.
 * `system_alert` is absent because it is informational with no reliable
 * destination, so its rows stay non-clickable.
 */
export type NotificationDestination = { type: "internal"; href: Route } | null;

const DESTINATION_BY_BASE: Record<string, Route> = {
  // Muddy requests and approvals
  friend_request_received: "/friends?tab=requests" as Route,
  friend_request_accepted: "/friends" as Route,
  // Proximity: the Home nearby section, never an exact location
  friend_nearby: "/dashboard" as Route,
  best_buddy_nearby: "/dashboard" as Route,
  circle_nearby: "/dashboard" as Route,
  wave: "/friends" as Route,
  // Feature records addressed by the id suffix
  meeting_ping: "/meeting-pings" as Route,
  plan: "/plans" as Route,
  hangout: "/hangout-mode" as Route,
  safe_arrival: "/safe-arrival" as Route,
  event: "/events" as Route,
  // An Event Room notification lands on its Event, and with both ids on the
  // Room itself. Never on generic Events Home.
  event_room: "/events" as Route,
  moment: "/moments" as Route,
  drop: "/drops" as Route,
  message: "/messages" as Route,
  group_message: "/groups" as Route,
  group: "/groups" as Route,
  // Linkr mutual connection. The base form lands on Linkr itself; the
  // id-suffixed form below resolves the pair's CURRENT state instead, so a
  // notification does not freeze into a "Say hi" screen after the chat has
  // already started.
  linkr_connection: "/linkr" as Route,
  // Personal milestones
  achievement: "/badges" as Route,
  birthday: "/notifications" as Route,
  // Account
  subscription_update: "/settings/access" as Route
};

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ACHIEVEMENT_CODE_PATTERN = /^[a-z0-9][a-z0-9_-]{0,79}$/i;

function withQuery(path: string, key: string, value: string): Route {
  const params = new URLSearchParams({ [key]: value });
  return `${path}?${params.toString()}` as Route;
}

export function resolveNotificationDestination(type: string): NotificationDestination {
  const separator = type.indexOf(":");
  const base = separator === -1 ? type : type.slice(0, separator);
  const entityId = separator === -1 ? null : type.slice(separator + 1);

  /* EVENT ROOM: "event_room:<eventId>:<roomId>".
   *
   * Two ids, because a Room is only reachable THROUGH its Event -- the Events
   * surface is query-driven and opens a Room inside the Event that owns it.
   * Both halves are validated; a malformed pair falls through to the Event
   * rather than producing a broken URL. Authorization is re-checked when the
   * Room is read, so a link held by someone since removed opens nothing. */
  if (base === "event_room" && entityId) {
    const [eventId, roomId] = entityId.split(":");
    if (eventId && roomId && UUID_PATTERN.test(eventId) && UUID_PATTERN.test(roomId)) {
      const params = new URLSearchParams({ event: eventId, room: roomId });
      return { type: "internal", href: `/events?${params.toString()}` as Route };
    }
    if (eventId && UUID_PATTERN.test(eventId)) {
      return { type: "internal", href: withQuery("/events", "event", eventId) };
    }
  }

  if (entityId && UUID_PATTERN.test(entityId)) {
    switch (base) {
      case "message":
        return { type: "internal", href: withQuery("/messages", "conversation", entityId) };
      case "group_message":
        return { type: "internal", href: `/groups/${entityId}` as Route };
      case "hangout":
        return { type: "internal", href: withQuery("/hangout-mode", "hangout", entityId) };
      case "plan":
        return { type: "internal", href: withQuery("/plans", "plan", entityId) };
      case "event":
        return { type: "internal", href: withQuery("/events", "event", entityId) };
      case "group":
        return { type: "internal", href: `/groups/${entityId}` as Route };
      case "safe_arrival":
        return { type: "internal", href: withQuery("/safe-arrival", "session", entityId) };
      case "linkr_connection":
        // Deliberately NOT a frozen destination. `/linkr?connection=<id>`
        // re-resolves at open time: blocks and eligibility are re-checked, and
        // an already-started conversation wins over the mutual screen.
        return { type: "internal", href: withQuery("/linkr", "connection", entityId) };
    }
  }

  if (base === "achievement" && entityId && ACHIEVEMENT_CODE_PATTERN.test(entityId)) {
    return { type: "internal", href: withQuery("/badges", "achievement", entityId) };
  }

  const href = DESTINATION_BY_BASE[base];
  return href ? { type: "internal", href } : null;
}
