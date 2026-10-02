import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(path, "utf8");
const page = read("components/messages/messages-page-v4.tsx");
const bubble = read("components/messaging/message-bubble-v4.tsx");
const reactions = read("components/messaging/reaction-summary-cache-v4.ts");
const voice = read("components/messaging/voice-message-bubble-v4.tsx");

describe("chat composer visibility and thread performance", () => {
  it("always reveals a newly-created outgoing row and tracks composer height", () => {
    expect(page).toContain("outgoingCount > previous.count");
    expect(page).toContain('scrollToBottom("auto")');
    expect(page).toContain("data-chat-composer-host");
    expect(page).toContain("new ResizeObserver");
    expect(page).toContain("thread.scrollTo({ top: thread.scrollHeight");
  });

  it("subscribes to reaction summaries once per thread, not once per message bubble", () => {
    expect(page).toContain("useConversationReactionSummaries(selectedId)");
    expect(page).toContain("reactionAggregates={reactionSummaries[message.id] ?? []}");
    expect(bubble).not.toContain("useConversationReactionSummaries");
    expect(reactions).toContain("const POLL_MS = 15_000");
  });

  it("does not authorize every voice note when a thread opens", () => {
    expect(voice).toContain("new IntersectionObserver");
    expect(voice).toContain('rootMargin: "180px 0px"');
    expect(voice).toContain("prefetchStartedRef");
    expect(voice).toContain("ref={bubbleRef}");
  });

  it("reuses one message time formatter instead of allocating one per bubble render", () => {
    expect(bubble).toContain("const MESSAGE_TIME_FORMATTER");
    expect(bubble).toContain("MESSAGE_TIME_FORMATTER.format");
    expect(bubble).not.toContain("new Intl.DateTimeFormat(undefined, { hour: \"numeric\", minute: \"2-digit\" }).format");
  });
});
