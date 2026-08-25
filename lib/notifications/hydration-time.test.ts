import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { stripComments } from "@/lib/content/strip-comments";

describe("notification relative-time hydration", () => {
  it("uses one server-provided clock for the server and first client render", () => {
    const route = stripComments(readFileSync("app/(app)/notifications/page.tsx", "utf8"));
    const page = stripComments(readFileSync("components/notifications/notifications-page.tsx", "utf8"));

    expect(route).toContain("const serverNowMs = Date.now();");
    expect(route).toContain("initialNowMs={serverNowMs}");
    expect(page).toContain("toNotificationItem(notification, initialClockMs)");
    expect(page).not.toContain("map(toNotificationItem)");
    expect(page).toContain("formatNotificationTime(notification.created_at, nowMs)");
    expect(page).toContain("Math.floor((nowMs - new Date(createdAt).getTime()) / 60000)");
  });
});
