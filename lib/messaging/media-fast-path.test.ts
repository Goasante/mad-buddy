import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(path, "utf8");
const picker = read("components/messaging/attachment-picker.tsx");
const mediaClient = read("lib/messaging/media-upload-client.ts");
const mediaRoute = read("app/api/messages/media/route.ts");
const richBubble = read("components/messaging/rich-media-message-v4.tsx");
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

describe("background reconciliation", () => {
  it("does not paint the foreground timeout banner for a Realtime fallback", () => {
    expect(messagesPage).toContain("refreshMessages(selectedId, true, false)");
    expect(messagesPage).toContain("if (reportFailure) setFeedback(failureMessage(error))");
  });

  it("keeps first-load failures visible", () => {
    expect(messagesPage).toContain('operation: "load conversation"');
    expect(messagesPage).toContain("setFeedback(failureMessage(error))");
  });

  it("retries failed outgoing media through the same JSON send lane", () => {
    expect(messagesPage).toContain('import { sendMessageViaApi } from "@/lib/messaging/send-client"');
    expect(messagesPage).toContain("const result = await sendMessageViaApi({ conversationId");
  });
});
