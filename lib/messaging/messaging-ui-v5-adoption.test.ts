import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

function read(path: string) {
  return readFileSync(join(process.cwd(), path), "utf8");
}

const route = read("app/(app)/messages/page.tsx");
const shell = read("components/messages/messages-experience-v5.tsx");
const v4 = read("components/messages/messages-page-v4.tsx");
const row = read("components/messaging/conversation-row-v4.tsx");
const bubble = read("components/messaging/message-bubble-v4.tsx");
const composer = read("components/messaging/message-composer-v3.tsx");

describe("Messages V5 concept adoption", () => {
  it("keeps V4 as the messaging authority and adds the V5 presentation shell", () => {
    expect(route).toContain('MessagesExperienceV5');
    expect(shell).toContain('MessagesPageV4');
    expect(shell).toContain('initialConversations={initialConversations}');
  });

  it("uses the agreed inbox hierarchy without the unwanted greeting", () => {
    expect(shell).toContain('>Messages</h1>');
    expect(shell).not.toContain("Good morning");
    expect(shell).toContain('href="/notifications"');
    expect(shell).toContain('href="/profile"');
    expect(shell).toContain('aria-label="New chat"');
  });

  it("makes favorites a real persisted feature, not decorative avatars", () => {
    expect(shell).toContain('aria-label="Favorite chats"');
    expect(shell).toContain('label="Add"');
    expect(shell).toContain('label="More"');
    expect(shell).toContain('setConversationPinnedAction');
    expect(shell).toContain('favoriteRank: next ? 0 : null');
  });

  it("keeps mute visible and distinguishes multi-person conversations", () => {
    expect(row).toContain('aria-label="Muted"');
    expect(row).toContain('ConversationRowAvatar');
    expect(row).toContain('UsersRound');
  });

  it("keeps the rich messaging features already built instead of reimplementing them", () => {
    expect(bubble).toContain('VoiceMessageBubbleV4');
    expect(bubble).toContain('RichMediaMessageV4');
    expect(bubble).toContain('StructuredMessageCardV4');
    expect(bubble).toContain('message.messageType === "event"');
    expect(v4).toContain('is typing…');
  });

  it("keeps the real attachment and microphone composer and applies the new visual shell", () => {
    expect(composer).toContain('AttachmentPicker');
    expect(composer).toContain('<Mic className="h-5 w-5" />');
    expect(shell).toContain('.messages-experience-v5 .composer-bubble');
    expect(shell).toContain('.messages-experience-v5 .composer-action');
  });

  it("does not introduce call or video-call controls", () => {
    expect(shell).not.toContain('PhoneCall');
    expect(shell).not.toContain('VideoIcon');
  });
});
