import { describe, expect, it } from "vitest";

import {
  TYPING_PRESENCE_HEARTBEAT_MS,
  shouldPublishTypingPresence
} from "@/lib/messaging/typing-presence";

describe("typing presence publish policy", () => {
  it("publishes immediately when typing starts", () => {
    expect(
      shouldPublishTypingPresence({
        typing: true,
        wasTyping: false,
        lastPublishedAt: 0,
        now: 100
      })
    ).toBe(true);
  });

  it("does not publish on every keystroke while the typing lease is fresh", () => {
    expect(
      shouldPublishTypingPresence({
        typing: true,
        wasTyping: true,
        lastPublishedAt: 1_000,
        now: 1_250
      })
    ).toBe(false);
  });

  it("refreshes sustained typing after the heartbeat interval", () => {
    expect(
      shouldPublishTypingPresence({
        typing: true,
        wasTyping: true,
        lastPublishedAt: 1_000,
        now: 1_000 + TYPING_PRESENCE_HEARTBEAT_MS
      })
    ).toBe(true);
  });

  it("publishes idle once when typing stops", () => {
    expect(
      shouldPublishTypingPresence({
        typing: false,
        wasTyping: true,
        lastPublishedAt: 1_000,
        now: 1_500
      })
    ).toBe(true);
  });

  it("does not repeat idle presence while already idle", () => {
    expect(
      shouldPublishTypingPresence({
        typing: false,
        wasTyping: false,
        lastPublishedAt: 1_000,
        now: 1_500
      })
    ).toBe(false);
  });
});
