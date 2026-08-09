import { describe, expect, it } from "vitest";
import { isConversationMessageNotificationType } from "@/lib/notifications/conversation-boundary";

describe("conversation notification boundary", () => {
  it.each(["message:8b9e9e41-97c3-4e57-a3c2-d9333db3e134", "group_message:8b9e9e41-97c3-4e57-a3c2-d9333db3e134"])(
    "classifies %s as chat-only",
    (type) => expect(isConversationMessageNotificationType(type)).toBe(true)
  );

  it.each(["friend_request_received", "group:8b9e9e41-97c3-4e57-a3c2-d9333db3e134", "plan:8b9e9e41-97c3-4e57-a3c2-d9333db3e134"])(
    "keeps %s in Pulse",
    (type) => expect(isConversationMessageNotificationType(type)).toBe(false)
  );
});
