import "server-only";

import { messageAttachmentCanBeSigned } from "@/lib/messaging/attachment-retention";
import { canCreateDirectConversation, resolveConversationAccess } from "@/lib/messaging/service";
import {
  MEDIA_SIGNED_URL_TTL_SECONDS,
  mediaSignedUrlExpiresAt
} from "@/lib/media/constants";
import type { createSupabaseAdminClient } from "@/lib/supabase/admin";

type Admin = ReturnType<typeof createSupabaseAdminClient>;

/** One canonical TTL, shared with every other private-media signer. */
export const ATTACHMENT_SIGNED_TTL_SECONDS = MEDIA_SIGNED_URL_TTL_SECONDS;

export const ATTACHMENT_CONTENT_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;

export type AttachmentView = {
  mediaId: string;
  thumbUrl: string | null;
  fullUrl: string | null;
  width: number | null;
  height: number | null;
  /** Lets an open conversation refresh shortly before expiry without polling per image. */
  expiresAt: string;
};

/**
 * Application-level preflight for a friendly send error. The database trigger
 * repeats the authoritative checks and cannot be bypassed by a modified client.
 */
export async function canAttachMedia(
  admin: Admin,
  userId: string,
  conversationId: string,
  mediaId: string
): Promise<boolean> {
  const { data: asset } = await admin
    .from("media_assets")
    .select("owner_id, context_type, intended_conversation_id, processing_status, moderation_status, deleted_at")
    .eq("id", mediaId)
    .maybeSingle();

  if (!asset) return false;
  if (asset.owner_id !== userId) return false;
  if (asset.context_type !== "chat") return false;
  if (asset.intended_conversation_id !== conversationId) return false;
  if (asset.processing_status !== "ready") return false;
  if (asset.deleted_at || asset.moderation_status !== "active") return false;

  const { data: queued } = await admin
    .from("media_deletion_queue")
    .select("id")
    .eq("media_asset_id", mediaId)
    .is("processed_at", null)
    .limit(1)
    .maybeSingle();
  return !queued;
}

/**
 * Resolves all attachments for one authorised message page with bounded work:
 * one parent-message read, one asset read, one variant read, and one batch
 * Storage signing call. Asset ids alone are never accepted as authorization.
 */
export async function signAttachmentsForMessages(
  admin: Admin,
  viewerId: string,
  conversationId: string,
  messageIds: readonly string[]
): Promise<Map<string, AttachmentView>> {
  const byId = new Map<string, AttachmentView>();
  const uniqueMessageIds = [...new Set(messageIds.filter(Boolean))];
  if (uniqueMessageIds.length === 0) return byId;

  const access = await resolveConversationAccess(admin, viewerId, conversationId);
  if (!access.canView || access.status !== "active") return byId;

  // A direct thread remains archived after a block while its old membership
  // rows remain joined. Re-evaluate the live relationship before minting URLs.
  if (access.conversationType === "direct") {
    const otherId = access.directKey?.split(":").find((id) => id !== viewerId);
    if (!otherId) return byId;
    const eligibility = await canCreateDirectConversation(admin, viewerId, otherId);
    if (!eligibility.allowed) return byId;
  }

  const { data: messages } = await admin
    .from("messages")
    .select("id, sender_id, media_id, status, deleted_at, created_at")
    .eq("conversation_id", conversationId)
    .in("id", uniqueMessageIds)
    .gte("created_at", access.historyVisibleFrom ?? new Date(0).toISOString());

  let authorisedMessages = (messages ?? []).filter(
    (message) =>
      Boolean(message.media_id) &&
      messageAttachmentCanBeSigned({ status: message.status, deletedAt: message.deleted_at })
  );

  // In a shared conversation, blocking somebody hides their attachment bytes
  // even though both people may remain legitimate members of the group.
  const senderIds = [
    ...new Set(
      authorisedMessages
        .map((message) => message.sender_id)
        .filter((id): id is string => Boolean(id) && id !== viewerId)
    )
  ];
  if (senderIds.length > 0) {
    const { data: blocks } = await admin
      .from("blocked_users")
      .select("blocker_id, blocked_id")
      .or(`blocker_id.eq.${viewerId},blocked_id.eq.${viewerId}`);
    const blockedSenderIds = new Set(
      (blocks ?? []).flatMap((block) => {
        if (block.blocker_id === viewerId && senderIds.includes(block.blocked_id)) return [block.blocked_id];
        if (block.blocked_id === viewerId && senderIds.includes(block.blocker_id)) return [block.blocker_id];
        return [];
      })
    );
    authorisedMessages = authorisedMessages.filter(
      (message) => !message.sender_id || !blockedSenderIds.has(message.sender_id)
    );
  }

  const mediaIds = [
    ...new Set(authorisedMessages.map((message) => message.media_id).filter((id): id is string => Boolean(id)))
  ];
  if (mediaIds.length === 0) return byId;

  const [{ data: assets }, { data: variants }] = await Promise.all([
    admin
      .from("media_assets")
      .select("id, storage_key, width, height")
      .in("id", mediaIds)
      .eq("context_type", "chat")
      .eq("intended_conversation_id", conversationId)
      .eq("processing_status", "ready")
      .eq("moderation_status", "active")
      .is("deleted_at", null),
    admin
      .from("media_variants")
      .select("media_asset_id, variant_type, storage_key")
      .in("media_asset_id", mediaIds)
      .in("variant_type", ["thumb", "full"])
  ]);

  const variantsByAsset = new Map<string, Map<string, string>>();
  for (const variant of variants ?? []) {
    const map = variantsByAsset.get(variant.media_asset_id) ?? new Map<string, string>();
    map.set(variant.variant_type, variant.storage_key);
    variantsByAsset.set(variant.media_asset_id, map);
  }

  const paths = [
    ...new Set(
      (assets ?? []).flatMap((asset) => {
        const assetVariants = variantsByAsset.get(asset.id);
        return [assetVariants?.get("thumb") ?? asset.storage_key, assetVariants?.get("full") ?? asset.storage_key];
      })
    )
  ];
  if (paths.length === 0) return byId;

  const { data: signed } = await admin.storage
    .from("media")
    .createSignedUrls(paths, MEDIA_SIGNED_URL_TTL_SECONDS);
  const signedByPath = new Map(
    (signed ?? [])
      .filter((item): item is typeof item & { path: string; signedUrl: string } => Boolean(item.path && item.signedUrl))
      .map((item) => [item.path, item.signedUrl])
  );
  const expiresAt = mediaSignedUrlExpiresAt();

  for (const asset of assets ?? []) {
    const assetVariants = variantsByAsset.get(asset.id);
    const thumbPath = assetVariants?.get("thumb") ?? asset.storage_key;
    const fullPath = assetVariants?.get("full") ?? asset.storage_key;
    byId.set(asset.id, {
      mediaId: asset.id,
      thumbUrl: signedByPath.get(thumbPath) ?? null,
      fullUrl: signedByPath.get(fullPath) ?? null,
      width: asset.width,
      height: asset.height,
      expiresAt
    });
  }

  return byId;
}

export { attachmentAltText } from "@/lib/messaging/attachment-labels";
