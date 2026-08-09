import { describe, expect, it } from "vitest";
import { sumUnreadConversationCounts } from "@/lib/messaging/unread-count";

describe("sumUnreadConversationCounts", () => {
  it("totals unread messages across conversation previews", () => {
    expect(
      sumUnreadConversationCounts([
        { unread_count: 2 },
        { unread_count: 0 },
        { unread_count: 4 },
        {}
      ])
    ).toBe(6);
  });
});
