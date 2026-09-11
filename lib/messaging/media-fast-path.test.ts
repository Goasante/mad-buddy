import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(path, "utf8");
const picker = read("components/messaging/attachment-picker.tsx");
const mediaClient = read("lib/messaging/media-upload-client.ts");
const mediaRoute = read("app/api/messages/media/route.ts");
const richBubble = read("components/messaging/rich-media-message-v4.tsx");
const voiceBubble = read("components/messaging/voice-message-bubble.tsx");
const voiceUpload = read("hooks/use-voice-upload.ts");
const composerShell = read("components/messaging/message-composer-v4-shell.tsx");
const feedbackHook = read("hooks/use-transient-feedback.ts");
const messagesPage = read("components/messages/messages-page-v4.tsx");
const richAction = read("app/(app)/messaging-rich-media-actions.ts");
const richService = read("lib/messaging/rich-media-service.ts");

describe("chat media control transport", () => {
  it("moves photo, video and document control steps off the Server Action lane", () => {
    expect(picker).toContain('from "@/lib/messaging/media-upload-client"');
    expect(picker).not.toContain('from "@/app/(app)/messaging-rich-media-actions"');
    expect(picker).not.toContain("createMessageAttachmentUploadIntentAction,\n  discardMessageAttachmentAction");
    expect(mediaClient).toContain('"/api/messages/media"');
    expect(mediaClient).toContain('credentials: "same-origin"');
  });

  it("keeps existing server authorization and verification services behind the JSON route", () => {
    expect(mediaRoute).toContain("resolveApiUser(request)");
    expect(mediaRoute).toContain("createChatUploadIntent(admin, userId");
    expect(mediaRoute).toContain("finalizeChatUpload(admin, userId");
    expect(mediaRoute).toContain("createChatV4RichUploadIntent(admin, userId");
    expect(mediaRoute).toContain("finalizeChatV4RichUpload(admin, userId");
    expect(mediaRoute).toContain('control: "media_uploads"');
  });

  it("never leaves the attachment control stuck after an interrupted API request", () => {
    expect(mediaClient).toContain("return null;");
    expect(mediaClient).toContain("Couldn't prepare that photo. Try again.");
    expect(mediaClient).toContain("Couldn't finish that attachment. Try again.");
  });
});

describe("voice-note fast path", () => {
  it("moves voice intent and finalize off the Server Action queue while keeping direct Storage bytes", () => {
    expect(voiceUpload).toContain("createVoiceUploadIntentViaApi");
    expect(voiceUpload).toContain("finalizeVoiceUploadViaApi");
    expect(voiceUpload).toContain("uploadToSignedUrl");
    expect(voiceUpload).toContain("createSupabaseBrowserClient");
    expect(voiceUpload).not.toContain("createVoiceMessageUploadIntentAction");
    expect(voiceUpload).not.toContain("finalizeVoiceMessageUploadAction");
    expect(mediaRoute).toContain('operation: z.literal("voice_intent")');
    expect(mediaRoute).toContain('operation: z.literal("voice_finalize")');
    expect(mediaRoute).toContain('mediaKind: "voice_note"');
    expect(mediaRoute).toContain('expectedMediaKind: "voice_note"');
    expect(mediaRoute).toContain("resolveUserEntitlements(admin, userId)");
  });

  it("mints sent voice playback through the JSON lane instead of a Server Action", () => {
    expect(voiceBubble).toContain("getVoiceMessagePlaybackViaApi");
    expect(voiceBubble).not.toContain("getMessageVoicePlaybackAction");
    expect(mediaRoute).toContain('operation: z.literal("voice_view")');
    expect(mediaRoute).toContain("getMessageVoicePlayback(admin, userId");
  });

  it("does not rely on async post-fetch autoplay that iOS can reject", () => {
    expect(voiceBubble).toContain("await audio.play()");
    expect(voiceBubble).toContain("a second explicit tap");
    expect(voiceBubble).not.toContain("Autoplay once the freshly minted URL lands");
    expect(voiceBubble).toContain("Tap retry");
  });
});

describe("sent rich-media loading", () => {
  it("loads video/document URLs through the independent JSON media lane", () => {
    expect(richBubble).toContain("getRichMediaMessageViaApi");
    expect(richBubble).not.toContain("getRichMediaMessageAction");
    expect(mediaRoute).toContain('operation: z.literal("view")');
    expect(mediaRoute).toContain("getRichMediaMessage(admin, userId");
  });

  it("keeps one authorization/signing implementation for both transports", () => {
    expect(richAction).toContain("getRichMediaMessage(createSupabaseAdminClient(), viewerId");
    expect(richService).toContain("resolveConversationAccess");
    expect(richService).toContain("messageAttachmentCanBeSigned");
    expect(richService).toContain("canCreateDirectConversation");
    expect(richService).toContain("createSignedUrl");
  });

  it("offers retry on a transient media-view transport failure", () => {
    expect(richBubble).toContain("Attachment didn’t load");
    expect(richBubble).toContain("Tap to try again.");
  });
});

describe("draft convergence after send", () => {
  it("serializes server draft writes so an older save cannot beat the sent clear", () => {
    expect(composerShell).toContain("draftWriteChainRef");
    expect(composerShell).toContain("draftWriteChainRef.current");
    expect(composerShell).toContain('void syncDraftToServer("")');
  });

  it("flushes an empty draft on unmount instead of cancelling the clear", () => {
    expect(composerShell).toContain("void syncDraftToServer(lastDraftRef.current)");
    expect(composerShell).not.toContain("if (pending) syncDraftToServer(pending)");
  });

  it("blocks a stale warm-cache draft from repainting immediately after send", () => {
    expect(composerShell).toContain("locallyClearedDraftUntil");
    expect(composerShell).toContain("LOCAL_DRAFT_CLEAR_GRACE_MS");
    expect(composerShell).toContain("suppressStaleDraft");
  });
});

describe("delivery failure presentation", () => {
  it("keeps failed sends on the optimistic message row instead of duplicating a composer banner", () => {
    expect(composerShell).toContain("suppressNextDeliveryFeedbackRef");
    expect(composerShell).toContain('outcome === "failed"');
    expect(messagesPage).toContain("Not sent");
    expect(messagesPage).toContain("Retry");
  });

  it("does not render the chat timeout transport message as global feedback", () => {
    expect(feedbackHook).toContain('"chats took too long to respond. try again."');
    expect(feedbackHook).toContain("suppressGlobalMessagingFeedback(message)");
  });
});

describe("background reconciliation", () => {
  it("does not paint the foreground timeout banner for a Realtime fallback", () => {
    expect(messagesPage).toContain("refreshMessages(selectedId, true, false)");
    expect(messagesPage).toContain("if (reportFailure) setFeedback(failureMessage(error))");
  });

  it("keeps first-load non-suppressed failures visible", () => {
    expect(messagesPage).toContain('operation: "load conversation"');
    expect(messagesPage).toContain("setFeedback(failureMessage(error))");
  });

  it("retries failed outgoing media through the same JSON send lane", () => {
    expect(messagesPage).toContain('import { sendMessageViaApi } from "@/lib/messaging/send-client"');
    expect(messagesPage).toContain("const result = await sendMessageViaApi({ conversationId");
  });
});
