import "server-only";

import { signMediaForAsset } from "@/lib/content/service";
import { resolveConversationAccess } from "@/lib/messaging/service";
import type { createSupabaseAdminClient } from "@/lib/supabase/admin";

type Admin = ReturnType<typeof createSupabaseAdminClient>;

/**
 * Messaging attachments — the canonical pipeline.
 *
 * NOT a Groups feature. Every conversation type shares one `messages` table,
 * so an attachment attached here works in direct messages, group chats, plan
 * chats, event chats and Safe Arrival threads the moment it exists, and every
 * future conversation type inherits it without new work.
 *
 * Deliberately thin: `media_assets`, `media_variants`, the private `media`
 * bucket, EXIF stripping, variant generation and `signMediaForAsset` all
 * already exist and are reused untouched. What was missing was only the join —
 * authorising a media asset onto a message, and signing it back out for people
 * entitled to see it.
 *
 * IMAGES ONLY in this phase (JPEG/PNG/WebP). Video, documents and voice notes
 * are separate phases with their own architecture.
 */

/**
 * How long an attachment URL stays valid.
 *
 * Short by design. A signed URL is a bearer token for a private object: once
 * minted it works for anyone holding it, so revocation on removal from a group
 * is bounded by this TTL and nothing shorter. Ten minutes is long enough for a
 * thread to render and be read, short enough that a leaked URL is stale before
 * it travels.
 */
export const ATTACHMENT_SIGNED_TTL_SECONDS = 600;

/** Image types this phase accepts. Mirrors the media_assets check constraint. */
export const ATTACHMENT_CONTENT_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;

export type AttachmentView = {
  mediaId: string;
  /** Short-lived signed URL for the thread thumbnail. Never a storage path. */
  thumbUrl: string | null;
  /** Larger variant, for the immersive viewer. */
  fullUrl: string | null;
  width: number | null;
  height: number | null;
};

/**
 * Whether `userId` may attach `mediaId` to a message.
 *
 * Two independent conditions, both required:
 *
 *  1. They own the asset. Without this, anyone could attach someone else's
 *     media by guessing an id, and a private photo would surface in a
 *     conversation its owner never chose.
 *  2. The asset is a ready, chat-context image. A `moment` asset must not be
 *     re-parented into a chat — its retention and moderation policy belong to
 *     the Moment, and a Moment expiring would silently blank a message.
 *
 * Membership in the conversation is checked by the SEND path, which already
 * resolves it; this function answers only "is this asset theirs to attach".
 */
export async function canAttachMedia(
  admin: Admin,
  userId: string,
  mediaId: string
): Promise<boolean> {
  const { data: asset } = await admin
    .from("media_assets")
    .select("owner_id, context_type, processing_status, moderation_status, deleted_at")
    .eq("id", mediaId)
    .maybeSingle();

  if (!asset) return false;
  if (asset.owner_id !== userId) return false;
  if (asset.context_type !== "chat") return false;
  if (asset.processing_status !== "ready") return false;
  if (asset.deleted_at) return false;
  // A moderated asset must not be re-surfaced by attaching it somewhere new.
  return asset.moderation_status === "active";
}

/**
 * Sign every attachment in a page of messages, in one pass.
 *
 * THE N+1 THIS EXISTS TO PREVENT: signing inside a render, or per message,
 * would mint a fresh URL on every pass — dozens of storage round trips for one
 * thread, and a URL that changes identity on each render, which defeats
 * browser caching entirely.
 *
 * Deduped by media id, so the same asset referenced twice is signed once.
 *
 * Authorisation happens ONCE for the conversation before anything is signed:
 * if the viewer cannot see the conversation, no URL is minted at all. That is
 * what stops a removed member from refreshing expired attachment URLs — they
 * fail the membership check before reaching storage.
 */
export async function signAttachmentsForMessages(
  admin: Admin,
  viewerId: string,
  conversationId: string,
  mediaIds: readonly (string | null)[]
): Promise<Map<string, AttachmentView>> {
  const unique = [...new Set(mediaIds.filter((id): id is string => Boolean(id)))];
  const byId = new Map<string, AttachmentView>();
  if (unique.length === 0) return byId;

  // Membership gate. Signing is a privileged operation, so it never runs for a
  // viewer who is not currently entitled to the conversation.
  const access = await resolveConversationAccess(admin, viewerId, conversationId);
  if (!access.canView) return byId;

  const { data: assets } = await admin
    .from("media_assets")
    .select("id, width, height, moderation_status, deleted_at")
    .in("id", unique);

  await Promise.all(
    (assets ?? []).map(async (asset) => {
      // A removed or deleted asset resolves to no URL rather than a broken
      // one, so the message renders its "unavailable" state instead of a
      // failing image.
      if (asset.deleted_at || asset.moderation_status !== "active") return;
      const [thumbUrl, fullUrl] = await Promise.all([
        signMediaForAsset(admin, asset.id, "thumb"),
        signMediaForAsset(admin, asset.id, "full")
      ]);
      byId.set(asset.id, {
        mediaId: asset.id,
        thumbUrl,
        fullUrl,
        width: asset.width,
        height: asset.height
      });
    })
  );

  return byId;
}

// The alt-text rule lives in ./attachment-labels so the browser can use it
// too; re-exported here for server callers.
export { attachmentAltText } from "@/lib/messaging/attachment-labels";
