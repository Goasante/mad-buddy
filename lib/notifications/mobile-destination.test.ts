import { describe, expect, it } from "vitest";
import { resolveMobileNotificationDestination as adapt } from "./mobile-destination";
import { resolveNotificationDestination } from "./destination";

/**
 * Where a notification row goes in the NATIVE app.
 *
 * The shared Notifications screen renders the same rows on both platforms, but
 * several destinations do not exist on Android. Left alone they fall through to
 * the SPA catch-all, so a row looks tappable and lands nowhere useful.
 *
 * The rule these tests hold: a row navigates only where it can actually
 * arrive, and never somewhere that answers a different question from the one
 * the notification asked.
 */

const href = (path: string) => ({ type: "internal" as const, href: path as never });

describe("destinations Android does not have", () => {
  it.each([
    ["/linkr", "Linkr"],
    ["/linkr?connection=abc", "a Linkr connection"],
    ["/drops", "Drops"],
    ["/hangout-mode", "Hangout Mode"],
    ["/hangout-mode?hangout=abc", "a specific hangout"],
    ["/badges", "Badges"]
  ])("does not navigate to %s (%s)", (path) => {
    expect(adapt(href(path))).toBeNull();
  });

  it("opens nothing for a specific group rather than the group list", () => {
    // Android has /groups but no /groups/<id>. Opening the list would answer a
    // different question from the one the notification asked.
    expect(adapt(href("/groups/0f1e2d3c-4b5a-4987-8765-1a2b3c4d5e6f"))).toBeNull();
  });
});

describe("the one deep link Android can honour", () => {
  it("rewrites a conversation query into the real /messages/:id route", () => {
    // The SPA ignores query parameters but DOES have /messages/:id, so this is
    // the difference between opening the inbox and opening the conversation.
    expect(adapt(href("/messages?conversation=abc-123"))).toEqual({
      type: "internal",
      href: "/messages/abc-123"
    });
  });

  it("still opens the inbox when there is no conversation id", () => {
    expect(adapt(href("/messages"))).toEqual({ type: "internal", href: "/messages" });
  });

  it("ignores an unrelated query on /messages", () => {
    expect(adapt(href("/messages?foo=bar"))).toEqual({ type: "internal", href: "/messages" });
  });
});

describe("destinations that exist but ignore their query", () => {
  it.each([
    ["/plans?plan=abc", "/plans"],
    ["/events?event=abc", "/events"],
    ["/events?event=abc&room=def", "/events"],
    ["/friends?tab=requests", "/muddies"],
    ["/safe-arrival?session=abc", "/safety"]
  ])("%s degrades to %s", (input, expected) => {
    // A partial answer, not a wrong one: the right screen opens, just not the
    // exact item. The query is dropped so nothing implies a precision the
    // screen does not deliver.
    expect(adapt(href(input))).toEqual({ type: "internal", href: expected });
  });
});

describe("destinations that map cleanly", () => {
  it.each([
    ["/dashboard", "/home"],
    ["/friends", "/muddies"],
    ["/meeting-pings", "/pings"],
    ["/settings/access", "/subscription"],
    ["/messages", "/messages"],
    ["/plans", "/plans"],
    ["/events", "/events"],
    ["/moments", "/moments"],
    ["/notifications", "/notifications"],
    ["/groups", "/groups"]
  ])("%s -> %s", (input, expected) => {
    expect(adapt(href(input))).toEqual({ type: "internal", href: expected });
  });

  it("passes a null destination straight through", () => {
    // Informational notifications have no destination at all.
    expect(adapt(null)).toBeNull();
  });
});

/**
 * The adapter is only correct if it covers what the resolver actually
 * produces. These run real notification types through both, so a new
 * destination added to the resolver cannot quietly bypass this.
 */
describe("against real resolver output", () => {
  const UUID = "0f1e2d3c-4b5a-4987-8765-1a2b3c4d5e6f";

  it.each([
    ["friend_request_received", "/muddies"],
    ["friend_nearby", "/home"],
    ["wave", "/muddies"],
    [`message:${UUID}`, `/messages/${UUID}`],
    [`plan:${UUID}`, "/plans"],
    [`event:${UUID}`, "/events"],
    ["subscription_update", "/subscription"]
  ])("%s opens %s", (type, expected) => {
    expect(adapt(resolveNotificationDestination(type))).toEqual({ type: "internal", href: expected });
  });

  it.each([
    [`linkr_connection:${UUID}`, "Linkr"],
    [`hangout:${UUID}`, "Hangout Mode"],
    [`group:${UUID}`, "a specific group"],
    [`group_message:${UUID}`, "a specific group"]
  ])("%s does not navigate (%s is not on Android)", (type) => {
    expect(adapt(resolveNotificationDestination(type))).toBeNull();
  });

  it("every destination the resolver can produce is either reachable or null", () => {
    /* The catch-all guard. If someone adds a destination to the resolver that
       Android cannot reach, and forgets this adapter, the row would render as
       a tappable link to the SPA catch-all. This asserts the invariant
       directly rather than trusting the enumerations above to stay complete. */
    const types = [
      "friend_request_received", "friend_request_accepted", "friend_nearby",
      "best_buddy_nearby", "circle_nearby", "wave", "subscription_update",
      "system_alert", "staff_message", `birthday:${UUID}`, `message:${UUID}`,
      `group_message:${UUID}`, `hangout:${UUID}`, `plan:${UUID}`, `event:${UUID}`,
      `group:${UUID}`, `safe_arrival:${UUID}`, `linkr_connection:${UUID}`,
      `meetup_request:${UUID}`, `event_room:${UUID}:${UUID}`
    ];
    const reachable = new Set([
      "/home", "/muddies", "/messages", "/plans", "/events", "/moments",
      "/notifications", "/groups", "/pings", "/safety", "/subscription",
      "/socialize", "/profile", "/settings", "/buddy-score", "/help", "/more"
    ]);
    for (const type of types) {
      const adapted = adapt(resolveNotificationDestination(type));
      if (adapted === null) continue;
      const [path] = adapted.href.split("?");
      const isConversation = /^\/messages\/[^/]+$/.test(path);
      expect(
        reachable.has(path) || isConversation,
        `${type} -> ${adapted.href} is not a route the Android app has`
      ).toBe(true);
    }
  });
});
