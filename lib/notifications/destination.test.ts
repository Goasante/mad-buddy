import { describe, expect, it } from "vitest";
import { resolveNotificationDestination } from "@/lib/notifications/destination";

const ID = "3f8c1e2a-0000-4000-8000-000000000000";

describe("record-specific notification destinations", () => {
  it.each([
    [`message:${ID}`, `/messages?conversation=${ID}`],
    [`hangout:${ID}`, `/hangout-mode?hangout=${ID}`],
    [`plan:${ID}`, `/plans?plan=${ID}`],
    [`event:${ID}`, `/events?event=${ID}`],
    [`group_message:${ID}`, `/groups/${ID}`],
    [`group:${ID}`, `/groups/${ID}`],
    [`safe_arrival:${ID}`, `/safe-arrival?session=${ID}`]
  ])("resolves %s", (type, href) => {
    expect(resolveNotificationDestination(type)).toEqual({ type: "internal", href });
  });

  it("opens an achievement code without treating it as a route fragment", () => {
    expect(resolveNotificationDestination("achievement:first_safe_arrival")).toEqual({
      type: "internal",
      href: "/badges?achievement=first_safe_arrival"
    });
  });

  it("falls back safely for legacy and malformed suffixes", () => {
    expect(resolveNotificationDestination("message:new")).toEqual({ type: "internal", href: "/messages" });
    expect(resolveNotificationDestination("plan:https://evil.example")).toEqual({ type: "internal", href: "/plans" });
    expect(resolveNotificationDestination("group:not-a-uuid")).toEqual({ type: "internal", href: "/groups" });
    expect(resolveNotificationDestination("unknown:anything")).toBeNull();
  });
});
