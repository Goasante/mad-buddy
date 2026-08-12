import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { messagePreviewText, VOICE_MESSAGE_PREVIEW } from "@/lib/messaging/message-preview";

const read = (path: string) => readFileSync(path, "utf8");
const service = read("lib/messaging/voice-message-service.ts");
const send = read("lib/messaging/mobile.ts");
const bubble = read("components/messaging/voice-message-bubble.tsx");
const composer = read("components/messaging/message-composer.tsx");
const dm = read("components/messages/messages-page.tsx");
const group = read("components/groups/group-detail-page.tsx");
const playback = read("lib/media/voice-playback-service.ts");

describe("Phase 4F canonical voice messages", () => {
  it("uses one neutral preview for inboxes and notifications", () => {
    expect(VOICE_MESSAGE_PREVIEW).toBe("Voice message");
    expect(messagePreviewText("voice_note", "ignored")).toBe("Voice message");
    expect(messagePreviewText("text", "  hello  ")).toBe("hello");
  });

  it("derives voice semantics and trusted metadata from the READY asset", () => {
    expect(send).not.toContain("sendVoiceMessageAction");
    expect(send).toContain("resolveSendableMessageMedia");
    expect(send).toContain("message_type: messageType");
    expect(send).toContain("duration_seconds: media?.kind === \"voice_note\" ? media.durationSeconds : null");
    expect(send).toContain("waveform_data: media?.kind === \"voice_note\" ? media.waveform : null");
    expect(service).toContain("resolveUserEntitlements");
    expect(service).toContain("max_voice_note_seconds");
    expect(service).toContain("validateVoiceWaveform(asset.waveform_data)");
  });

  it("rejects foreign, wrong-conversation, unready, moderated, queued, reused and over-limit assets", () => {
    for (const guard of [
      "asset.owner_id !== userId",
      "asset.intended_conversation_id !== conversationId",
      'asset.processing_status !== "ready"',
      'asset.moderation_status !== "active"',
      "media_deletion_queue",
      '.eq("media_id", mediaId)',
      "asset.duration_ms > entitlements.max_voice_note_seconds * 1_000"
    ]) expect(service).toContain(guard);
  });

  it("preserves idempotency and prevents client metadata overrides", () => {
    expect(send).toContain('.eq("client_message_id", parsed.data.clientMessageId)');
    expect(send.indexOf("client_message_id")).toBeLessThan(send.indexOf("resolveSendableMessageMedia"));
    expect(sendMessageInput()).not.toContain("duration");
    expect(sendMessageInput()).not.toContain("waveform");
    expect(sendMessageInput()).not.toContain("messageType");
    expect(service).toContain('.eq("updated_at", asset.updated_at)');
    expect(service).toContain("claimError || !claimed ? null : resolved");
  });

  it("sends ready voice through the normal composer and preserves typed text", () => {
    // Voice is its own message with its own send path, rather than riding
    // along with the text send. A typed draft is never consumed by it.
    expect(composer).toContain("const sendVoice = useCallback(");
    expect(composer).toContain("sendMessageAction({ conversationId, mediaId: prepared.mediaId, clientMessageId })");
    // One upload, one message, however many times send is tapped.
    expect(composer).toContain("if (sendingRef.current) return;");
    expect(composer).toContain("sendingRef.current = true;");
    // A photo and a voice note are different messages.
    expect(composer).toContain("Remove the photo before recording a voice message.");
  });

  it("renders one player in DM, Plan-inherited Messages, and Group surfaces", () => {
    // The presentation was rebuilt (VoiceNotePlayer -> VoiceMessageBubble),
    // but the rule is unchanged: exactly one player per message, on every
    // conversation surface, rooted in the message id.
    expect(dm).toContain("<VoiceMessageBubble");
    expect(dm).toContain("messageId={message.id}");
    expect(dm).toContain('id: "plans"');
    expect(group).toContain("<VoiceMessageBubble");
    expect(group).toContain("senderName={message.isMine ? \"you\" : message.senderName}");
  });

  it("roots sent playback in conversation -> message -> asset and mints lazily", () => {
    expect(playback).toContain("projectVoiceMessages");
    expect(playback).toContain('.eq("id", input.messageId)');
    expect(playback).toContain('.eq("conversation_id", input.conversationId)');
    // Lazily minted on first play, through the per-message grant.
    expect(bubble).toContain("getMessageVoicePlaybackAction");
    expect(bubble).toContain("if (!src)");
    expect(service).not.toContain("storageKey:");
  });

  it("removes playback for deleted or inaccessible parents", () => {
    expect(service).toContain("messageAttachmentCanBeSigned");
    expect(service).toContain('if (!access.canView || access.status !== "active")');
    expect(service).toContain("canCreateDirectConversation");
    expect(service).toContain("blocked_users");
    expect(send).toContain("row.deleted_at ? null : voicesByMessageId");
  });
});

function sendMessageInput(): string {
  return send.slice(send.indexOf("export const sendMessageSchema"), send.indexOf("function serviceRoleEnvMessage"));
}
