import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Requested: a way to get from an Event Room's Chat tab to the full
 * conversation on the main Messaging page.
 *
 * Room chat is canonical Messaging (conversation_type 'event', context_type
 * 'event_circle') -- see event-rooms-productization. `room.conversationId`
 * is already the right id, and `/messages?conversation=<id>` is an
 * already-proven deep link (MessagesExperienceV5 uses the identical
 * pattern), so the Room detail panel only needs to navigate there.
 */

const detail = () => readFileSync("components/events/event-room-detail.tsx", "utf8");

describe("Event Room chat links out to the full conversation", () => {
  it("navigates to the canonical Messages deep link using the Room's conversation id", () => {
    const source = detail();
    expect(source).toContain("router.push(`/messages?conversation=${room.conversationId}` as Route)");
  });

  it("only offers the link once the Room has a conversation and the viewer is a member", () => {
    const source = detail();
    const chatTab = source.slice(source.indexOf('{tab === "chat" ?'));
    const link = chatTab.slice(0, chatTab.indexOf("Open in Messages"));

    // A draft Room's conversationId is null; navigating to
    // /messages?conversation=null would be a dead link.
    expect(link).toContain("room.isMember && room.conversationId");
  });

  it("imports the router and Route type it navigates with", () => {
    const source = detail();
    expect(source).toContain('import { useRouter } from "next/navigation"');
    expect(source).toContain('import type { Route } from "next"');
  });
});
