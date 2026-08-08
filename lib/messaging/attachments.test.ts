import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { attachmentAltText } from "@/lib/messaging/attachment-labels";
import { MAX_UPLOAD_BYTES, kindForMimeType, validateImageUpload } from "@/lib/media/validation";
import { stripComments } from "@/lib/content/strip-comments";

/**
 * Messaging Attachments Foundation (Stage 3D.1).
 *
 * The rules that matter here fail silently if they break: a public URL stored
 * in a row, a removed member still able to mint URLs, a filename leaking into
 * alt text. Each is asserted directly.
 */

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");
const attachments = stripComments(read("lib/messaging/attachments.ts"));
const actions = stripComments(read("app/(app)/messaging-actions.ts"));
const projection = stripComments(read("lib/messaging/mobile.ts"));
const picker = stripComments(read("components/messaging/attachment-picker.tsx"));
const composer = stripComments(read("components/messaging/message-composer.tsx"));
const attachmentImage = stripComments(read("components/messaging/message-attachment-image.tsx"));
const messagesPage = stripComments(read("components/messages/messages-page.tsx"));
const viewer = stripComments(read("components/messaging/message-media-viewer.tsx"));
const groupPage = stripComments(read("components/groups/group-detail-page.tsx"));
const constants = stripComments(read("lib/media/constants.ts"));

const header = (bytes: number[]) => new Uint8Array([...bytes, ...Array(28).fill(0)]);
const JPEG = header([0xff, 0xd8, 0xff, 0xe0]);
const PNG = header([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

// ---------------------------------------------------------------------------
// Canonical, not group-specific
// ---------------------------------------------------------------------------

describe("one pipeline for every conversation type", () => {
  it("extends the canonical send schema rather than adding a send path", () => {
    expect(projection).toContain("mediaId: uuidSchema.optional()");
    // One sendMessage. If a second appeared, group chat and DMs would diverge.
    expect((projection.match(/export const sendMessageSchema/g) ?? []).length).toBe(1);
  });

  it("the upload action takes a conversation id, not a group id", () => {
    // Nothing about it is group-shaped, so DMs and plan chats inherit it.
    expect(actions).toContain('formData.get("conversationId")');
    expect(actions).not.toContain("groupId");
  });

  it("the picker is conversation-agnostic", () => {
    expect(picker).toContain("conversationId: string;");
    expect(picker.toLowerCase()).not.toContain("group");
  });
});

// ---------------------------------------------------------------------------
// Validation and limits
// ---------------------------------------------------------------------------

describe("file validation", () => {
  it("accepts JPEG and PNG by magic bytes", () => {
    expect(validateImageUpload({ claimedMimeType: "image/jpeg", headerBytes: JPEG, sizeBytes: 1000, context: "chat" }).valid).toBe(true);
    expect(validateImageUpload({ claimedMimeType: "image/png", headerBytes: PNG, sizeBytes: 1000, context: "chat" }).valid).toBe(true);
  });

  it("rejects a file whose bytes contradict its claimed type", () => {
    // A .jpg extension on a non-image is the oldest trick there is.
    const result = validateImageUpload({
      claimedMimeType: "image/jpeg",
      headerBytes: header([0x4d, 0x5a]), // MZ — a Windows executable
      sizeBytes: 1000,
      context: "chat"
    });
    expect(result.valid).toBe(false);
  });

  it("rejects GIF, which this phase does not support", () => {
    expect(kindForMimeType("image/gif")).toBeNull();
  });

  it("rejects an oversized file", () => {
    const result = validateImageUpload({
      claimedMimeType: "image/jpeg",
      headerBytes: JPEG,
      sizeBytes: MAX_UPLOAD_BYTES.chat + 1,
      context: "chat"
    });
    expect(result.valid).toBe(false);
  });

  it("uses the existing chat limit rather than inventing one", () => {
    // An infrastructure bound, not a monetization gate.
    expect(MAX_UPLOAD_BYTES.chat).toBe(15 * 1024 * 1024);
  });

  it("narrows the file picker to exactly what the server validates", () => {
    expect(picker).toContain('accept="image/jpeg,image/png,image/webp"');
  });
});

// ---------------------------------------------------------------------------
// Storage and authorization
// ---------------------------------------------------------------------------

describe("storage and authorization", () => {
  it("derives the storage path server-side", () => {
    // The uploader never chooses where bytes land.
    expect(actions).toContain("storageKeyFor({ ownerId: userId, context: \"chat\"");
  });

  it("checks conversation membership before storing any bytes", () => {
    const upload = actions.slice(actions.indexOf("uploadMessageAttachmentAction"));
    expect(upload.indexOf("resolveConversationAccess")).toBeLessThan(upload.indexOf('formData.get("media")'));
  });

  it("only lets a sender attach their OWN ready chat asset", () => {
    expect(attachments).toContain("asset.owner_id !== userId");
    expect(attachments).toContain('asset.context_type !== "chat"');
    expect(attachments).toContain('asset.processing_status !== "ready"');
  });

  it("refuses a moderated or deleted asset", () => {
    expect(attachments).toContain('asset.moderation_status !== "active"');
    expect(attachments).toContain("asset.deleted_at");
  });

  it("authorises the conversation before signing anything", () => {
    // This is what denies a removed member a fresh URL.
    const sign = attachments.slice(attachments.indexOf("export async function signAttachmentsForMessages"));
    expect(sign.indexOf("resolveConversationAccess")).toBeLessThan(sign.indexOf("createSignedUrls"));
    expect(sign).toContain('if (!access.canView || access.status !== "active") return byId;');
  });

  it("stores no permanent public URL", () => {
    // Only a media id is persisted; URLs are minted per read.
    expect(actions).not.toContain("getPublicUrl");
    expect(attachments).not.toContain("getPublicUrl");
  });

  it("keeps the signed TTL short", () => {
    expect(attachments).toContain("ATTACHMENT_SIGNED_TTL_SECONDS = MEDIA_SIGNED_URL_TTL_SECONDS");
    expect(constants).toContain("MEDIA_SIGNED_URL_TTL_SECONDS = 5 * 60");
  });
});

// ---------------------------------------------------------------------------
// Performance
// ---------------------------------------------------------------------------

describe("performance", () => {
  it("signs attachments once per page, deduped", () => {
    expect(attachments).toContain("[...new Set(messageIds.filter(Boolean))]");
    expect((attachments.match(/createSignedUrls\(/g) ?? []).length).toBe(1);
    expect(projection).toContain("signAttachmentsForMessages(");
  });

  it("does not mint URLs during render", () => {
    // Signing lives in the server projection, never in a component.
    expect(groupPage).not.toContain("signMediaForAsset");
    expect(picker).not.toContain("createSignedUrl");
  });

  it("lazy-loads thread and gallery images", () => {
    expect(attachmentImage).toContain('loading="lazy"');
  });
});

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

describe("upload lifecycle", () => {
  it("cleans up orphans when any step fails", () => {
    // A failed upload must not leave a ready row or stored object behind.
    expect(actions).toContain("removeFailedUpload");
  });

  it("verifies what was actually persisted before exposing the asset", () => {
    // Storage can acknowledge an upload whose body a runtime transformed.
    const upload = actions.slice(actions.indexOf("uploadMessageAttachmentAction"));
    expect(upload).toContain("sniffImageKind");
    expect(upload).toContain("storedKind !== validation.kind");
  });

  it("discards an unsent attachment, but never one already sent", () => {
    const discard = actions.slice(actions.indexOf("discardMessageAttachmentAction"));
    expect(discard).toContain('.eq("media_id", mediaId)');
    expect(discard).toContain('return { ok: true, message: "Already sent." }');
  });

  it("preserves the typed draft when an upload fails", () => {
    expect(picker).toContain('transition({ status: "failed"');
    // The failure path touches only upload state, never the caption.
    const fail = picker.slice(picker.indexOf('if (!result.ok || !result.mediaId)'));
    expect(fail.slice(0, 200)).not.toContain("setDraft");
  });

  it("clears the attachment only after a confirmed send", () => {
    // Anchored inside sendMessage — the file has other `if (result.ok)`
    // branches (transfer, role changes) that would match first.
    const failure = composer.slice(
      composer.indexOf("if (!result.ok) {"),
      composer.indexOf('setDraft("")')
    );
    expect(failure).not.toContain("setAttachment(null)");
    const success = composer.slice(composer.indexOf('setDraft("")'));
    expect(success.slice(0, 250)).toContain("setAttachment(null)");
    // And only there: a failed send keeps the photo so retry is one tap.
    expect(success.indexOf("setAttachment(null)")).toBeGreaterThan(-1);
  });

  it("blocks a send with neither text nor photo", () => {
    expect(composer).toContain("if ((!text && !attachment) || uploadBusy || isPending) return;");
  });

  it("keeps idempotency on the send", () => {
    expect(composer).toContain("clientMessageIdRef.current ?? crypto.randomUUID()");
    expect(composer).toContain("clientMessageIdRef.current = clientMessageId");
  });

  it("treats a photo with no caption as a complete message", () => {
    expect(projection).toContain("hasAttachment");
    expect(projection).toContain('hasAttachment ? "image" : "text"');
  });

  it("uses the same composer for DM, Plan, and Group conversations", () => {
    expect(messagesPage).toContain("<MessageComposer");
    expect(messagesPage).toContain('id: "plans"');
    expect(groupPage).toContain("<MessageComposer");
    expect(groupPage).not.toContain("<AttachmentPicker");
  });
});

// ---------------------------------------------------------------------------
// Rendering and the single viewer
// ---------------------------------------------------------------------------

describe("rendering", () => {
  it("reuses the ONE immersive viewer", () => {
    expect(viewer).toContain("MomentMediaViewer");
    // No second full-screen layer for chat.
    expect(groupPage).not.toContain("fixed inset-0 z-[100]");
  });

  it("passes the larger variant to the viewer and the thumb to the thread", () => {
    expect(viewer).toContain("message.attachment.fullUrl");
    expect(attachmentImage).toContain("attachment.thumbUrl ?? attachment.fullUrl");
    expect(attachmentImage).toContain("refreshMessageAttachmentAction({ conversationId, messageId })");
  });

  it("does not render a photo for a deleted message", () => {
    expect(projection).toContain("row.deleted_at ? null : attachmentsById");
  });

  it("renders the caption without inventing placeholder text", () => {
    expect(groupPage).toContain("message.attachment ? null : (");
    expect(messagesPage).toContain('message.text ?? (message.attachment ? null : "Message")');
  });

  it("deduplicates signed URL refreshes and fails closed", () => {
    expect(attachmentImage).toContain("const refreshes = new Map");
    expect(attachmentImage).toContain("if (existing) return existing");
    expect(attachmentImage).toContain("setFailed(true)");
  });
});

// ---------------------------------------------------------------------------
// Privacy
// ---------------------------------------------------------------------------

describe("privacy", () => {
  it("alt text never uses the uploader's filename", () => {
    expect(attachmentAltText("Ama", false)).toBe("Photo from Ama");
    expect(attachmentAltText("Ama", true)).toBe("Photo you sent");
  });

  it("never exposes a storage path to the client", () => {
    const view = attachments.slice(attachments.indexOf("export type AttachmentView"));
    expect(view.slice(0, 400)).not.toContain("storage_key");
  });

  it("exposes no uploader contact fields", () => {
    for (const forbidden of ["email", "phone", "latitude", "longitude"]) {
      expect(attachments, `attachments must not project ${forbidden}`).not.toContain(forbidden);
    }
  });

  it("Media index reuses the already-authorised thread messages", () => {
    // Never a second query that could return media the thread would not show.
    expect(groupPage).toContain("messages.filter((item) => item.attachment)");
  });

  it("shows Media only — Files and Links are absent until they exist", () => {
    expect(groupPage).toContain('"media"');
    expect(groupPage).not.toContain('"files"');
    expect(groupPage).not.toContain('"links"');
  });
});

// ---------------------------------------------------------------------------
// Accessibility
// ---------------------------------------------------------------------------

describe("accessibility", () => {
  it("labels the attachment control and the remove button", () => {
    expect(picker).toContain('aria-label="Add an attachment"');
    expect(picker).toContain('aria-label="Remove photo"');
  });

  it("announces upload state without spamming", () => {
    expect(picker).toContain('aria-live="polite"');
    expect(picker).toContain('role="alert"');
  });

  it("keeps 44px targets", () => {
    expect(picker).toContain("h-11 w-11");
  });

  it("gives every thread image an accessible name", () => {
    expect(attachmentImage).toContain("attachmentAltText(message.senderName, message.isMine)");
  });

  it("respects reduced motion on the upload spinner", () => {
    expect(picker).toContain("motion-reduce:animate-none");
  });
});
