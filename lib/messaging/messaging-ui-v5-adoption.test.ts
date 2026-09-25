import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

function read(path: string) {
  return readFileSync(join(process.cwd(), path), "utf8");
}

const route = read("app/(app)/messages/page.tsx");
const shell = read("components/messages/messages-shortcuts.tsx");
const v4 = read("components/messages/messages-page-v4.tsx");
const row = read("components/messaging/conversation-row-v4.tsx");
const bubble = read("components/messaging/message-bubble-v4.tsx");
const composer = read("components/messaging/message-composer-v3.tsx");

describe("Unified Messages experience", () => {
  it("uses one page for inbox and threads, with shortcuts derived from its conversations", () => {
    expect(route).toContain('MessagesPageV4');
    expect(route).not.toContain('MessagesExperienceV5');
    expect(v4).toContain('conversations={displayConversations}');
    expect(shell).not.toContain('setConversationPinnedAction');
  });

  it("uses the agreed inbox hierarchy without the unwanted greeting", () => {
    expect(shell).toContain('>Messages</h1>');
    expect(shell).not.toContain("Good morning");
    expect(shell).toContain('href="/notifications"');
    expect(shell).toContain('href="/profile"');
    expect(v4).toContain('aria-label="New chat"');
  });

  it("makes favorites a real persisted feature, not decorative avatars", () => {
    expect(shell).toContain('aria-label="Favorite chats"');
    expect(shell).toContain('label="Add"');
    expect(shell).toContain('label="More"');
    expect(v4).toContain('setConversationPinnedAction');
    expect(v4).toContain('favoriteRank: next ? 0 : null');
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
    expect(shell).toContain('.messages-page .composer-bubble');
    expect(shell).toContain('.messages-page .composer-action');
  });

  it("does not introduce call or video-call controls", () => {
    expect(shell).not.toContain('PhoneCall');
    expect(shell).not.toContain('VideoIcon');
  });
});
