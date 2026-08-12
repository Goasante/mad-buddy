import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { messageAttachmentCanBeSigned } from "@/lib/messaging/attachment-retention";
import { MEDIA_SIGNED_URL_TTL_SECONDS, mediaSignedUrlExpiresAt } from "@/lib/media/constants";
import { stripComments } from "@/lib/content/strip-comments";

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");
const migration = stripComments(read("supabase/migrations/20260808260000_messaging_media_hardening.sql"));
const attachments = stripComments(read("lib/messaging/attachments.ts"));
const uploadService = stripComments(read("lib/media/chat-upload-service.ts"));
const actions = stripComments(read("app/(app)/messaging-actions.ts"));
const picker = stripComments(read("components/messaging/attachment-picker.tsx"));
const handlers = stripComments(read("lib/jobs/handlers.ts"));

describe("media lifecycle authority", () => {
  it("uses a PostgreSQL-compatible UUID aggregate for the historical backfill", () => {
    expect(migration).toContain("min(conversation_id::text)::uuid");
    expect(migration).not.toContain("min(conversation_id) as conversation_id");
  });

  it("removes client lifecycle and raw storage mutation authority", () => {
    expect(migration).toContain('drop policy if exists "media assets owner access"');
    expect(migration).toContain('create policy "media assets owner read"');
    expect(migration).not.toContain('create policy "media assets owner read" on public.media_assets\n  for all');
    expect(migration).toContain('drop policy if exists "media bucket owner writes"');
    expect(migration).toContain('drop policy if exists "media bucket owner deletes"');
  });

  it("keeps generated variants read-only to clients", () => {
    const foundation = read("supabase/migrations/20260717140000_moments_drops_media_safety.sql");
    const start = foundation.indexOf('create policy "media variants owner access"');
    const variantPolicy = foundation.slice(start, foundation.indexOf(";", start) + 1);
    expect(variantPolicy).toContain("for select");
    expect(variantPolicy).not.toContain("for insert");
  });

  it("removes direct client message insertion and update", () => {
    expect(migration).toContain('drop policy if exists "messages insert by member sender"');
    expect(migration).toContain('drop policy if exists "messages update own"');
  });
});

describe("non-bypassable attachment insertion", () => {
  const trigger = migration.slice(migration.indexOf("function public.validate_message_media_attachment"));

  it("rejects another owner's or wrong-conversation media", () => {
    expect(trigger).toContain("asset.owner_id <> new.sender_id");
    expect(trigger).toContain("asset.context_type <> 'chat'");
    expect(trigger).toContain("asset.intended_conversation_id is distinct from new.conversation_id");
  });

  it("rejects unready, moderated, deleted, or cleanup-queued media", () => {
    expect(trigger).toContain("asset.processing_status <> 'ready'");
    expect(trigger).toContain("asset.moderation_status <> 'active'");
    expect(trigger).toContain("asset.deleted_at is not null");
    expect(trigger).toContain("public.media_deletion_queue");
  });

  it("checks live membership, conversation state, posting controls, and DM blocks", () => {
    expect(trigger).toContain("conversation_row.status <> 'active'");
    expect(trigger).toContain("member_row.status <> 'joined'");
    expect(trigger).toContain("posting_mode = 'admins_only'");
    expect(trigger).toContain("public.blocked_users");
  });
});

describe("parent-bound reads and retention", () => {
  it("starts with messages rather than arbitrary asset ids", () => {
    expect(attachments).toContain("messageIds: readonly string[]");
    expect(attachments).toContain('.from("messages")');
    expect(attachments.indexOf('.from("messages")')).toBeLessThan(attachments.indexOf('.from("media_assets")', attachments.indexOf("signAttachmentsForMessages")));
  });

  it("denies removed members, closed conversations, and blocked direct threads", () => {
    expect(attachments).toContain('if (!access.canView || access.status !== "active") return byId;');
    expect(attachments).toContain("canCreateDirectConversation");
    expect(attachments).toContain("if (!eligibility.allowed) return byId;");
  });

  it("never signs deleted or moderated message states", () => {
    expect(messageAttachmentCanBeSigned({ status: "sent", deletedAt: null })).toBe(true);
    expect(messageAttachmentCanBeSigned({ status: "deleted", deletedAt: new Date().toISOString() })).toBe(false);
    expect(messageAttachmentCanBeSigned({ status: "removed_by_moderation", deletedAt: null })).toBe(false);
  });
});

describe("batch signing and canonical TTL", () => {
  it("uses one metadata batch and one storage signing batch", () => {
    expect((attachments.match(/createSignedUrls\(/g) ?? []).length).toBe(1);
    expect(attachments).not.toContain("signMediaForAsset");
    expect(attachments).toContain("expiresAt");
  });

  it("derives expiration from the one canonical TTL", () => {
    const now = Date.parse("2026-08-08T12:00:00.000Z");
    expect(Date.parse(mediaSignedUrlExpiresAt(now)) - now).toBe(MEDIA_SIGNED_URL_TTL_SECONDS * 1000);
    expect(read("lib/content/service.ts")).toContain("MEDIA_SIGNED_URL_TTL_SECONDS");
  });
});

describe("orphan cleanup and send race", () => {
  const cleanup = migration.slice(migration.indexOf("function public.queue_stale_unattached_chat_media"));

  it("only queues stale unattached chat assets and is idempotent", () => {
    expect(cleanup).toContain("asset.context_type = 'chat'");
    // THE INVARIANT: an asset is only queued when NO message references it.
    //
    // This used to be asserted as one string containing a literal \n plus
    // exact indentation, so it passed on an LF checkout and failed on a CRLF
    // one -- a real defect that made a clean clone fail. The rule is about
    // the SQL, not about how the line happens to be wrapped, so the guard and
    // the lookup are asserted independently and the ordering between them is
    // checked directly.
    const notExistsIndex = cleanup.indexOf("not exists (");
    const messageLookupIndex = cleanup.indexOf(
      "select 1 from public.messages message where message.media_id = asset.id"
    );
    expect(notExistsIndex, "cleanup must guard on absence").toBeGreaterThan(-1);
    expect(messageLookupIndex, "cleanup must look for an attached message").toBeGreaterThan(-1);
    expect(
      messageLookupIndex,
      "the message lookup must sit inside the not-exists guard"
    ).toBeGreaterThan(notExistsIndex);
    expect(cleanup).toContain("on conflict (media_asset_id) do nothing");
  });

  it("serializes overlapping cleanup and refuses a send after queueing", () => {
    expect(cleanup).toContain("for update skip locked");
    expect(migration).toContain("queue.media_asset_id = asset.id and queue.processed_at is null");
    expect(handlers).toContain('row.reason === "orphaned_upload"');
    expect(handlers).toContain('.eq("media_id", row.media_asset_id)');
  });
});

describe("canonical upload intent", () => {
  it("server creates owner, path, context, conversation binding, and expiry", () => {
    expect(uploadService).toContain("const mediaId = crypto.randomUUID()");
    expect(uploadService).toContain("storageKeyFor({ ownerId: userId");
    expect(uploadService).toContain('context_type: "chat"');
    expect(uploadService).toContain("intended_conversation_id: input.conversationId");
    expect(uploadService).toContain("upload_expires_at: expiresAt");
  });

  it("validates stored magic bytes before ready and keeps existing image processing", () => {
    expect(uploadService).toContain("validateImageUpload");
    expect(uploadService).toContain("processImageUpload");
    expect(uploadService).toContain('processing_status: "ready"');
    expect(uploadService.indexOf("validateImageUpload")).toBeLessThan(uploadService.lastIndexOf('processing_status: "ready"'));
  });

  it("moves the Group picker off the Server Action body-size path", () => {
    expect(picker).toContain("createMessageAttachmentUploadIntentAction");
    expect(picker).toContain("uploadToSignedUrl");
    expect(picker).toContain("finalizeMessageAttachmentUploadAction");
    expect(picker).not.toContain("uploadMessageAttachmentAction");
    expect(actions).toContain("createMessageAttachmentUploadIntentAction");
  });
});
