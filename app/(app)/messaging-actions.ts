"use server";

import { z } from "zod";
import {
  canDeleteForEveryone,
  canEditMessage,
  validateMessageText
} from "@/lib/messaging/rules";
import {
  canSendMessage as canSendIntoConversation,
  loadCommunicationPreferences,
  normalizeCommunicationPreferences,
  resolveConversationAccess,
  type CommunicationPreferences
} from "@/lib/messaging/service";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { resolveUserEntitlements } from "@/lib/billing/service";
import { guardAction } from "@/lib/admin/enforcement";
import { consumeRateLimit, rateLimitMessage } from "@/lib/security/rate-limit";
import { signMediaForAsset } from "@/lib/content/service";
import { sniffImageKind, storageKeyFor, uploadValidationMessage, validateImageUpload } from "@/lib/media/validation";
import type { MediaContentType } from "@/lib/supabase/database.types";
import { getSupabaseServerEnv } from "@/lib/supabase/env";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { MessageReactionType } from "@/lib/supabase/database.types";
import {
  listConversations,
  listMessages,
  listMessageableFriends,
  markConversationRead,
  openDirectConversation,
  sendMessage,
  setConversationPinned,
  type ChatMessageView,
  type ConversationView,
  type MessageableFriend
} from "@/lib/messaging/mobile";
import type { VoiceRecorderConfig } from "@/lib/messaging/voice-recording";
import type { AuthorizedVoicePlayback } from "@/lib/messaging/voice-playback";

// The read/send views + logic (and these view types) live in
// lib/messaging/mobile.ts so the mobile /api/messages/* routes share them.
// A "use server" file can't re-export types (Turbopack treats every export as
// an action), so importers get the types straight from lib/messaging/mobile.

export type MessagingActionState = {
  ok: boolean;
  message: string;
  conversationId?: string;
  messageId?: string;
};

const uuidSchema = z.string().uuid();

function missingEnvState(): MessagingActionState | null {
  const env = getSupabaseServerEnv();
  if (!env.url || !env.serviceRoleKey) {
    return { ok: false, message: "This action needs the server database configuration." };
  }
  return null;
}

async function getAuthedUserId() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
    error
  } = await supabase.auth.getUser();
  return error || !user ? null : user.id;
}

// ---------------------------------------------------------------------------
// Open a conversation (spec §4), no manual "create chat" step.
// ---------------------------------------------------------------------------

export async function openDirectConversationAction(recipientId: string): Promise<MessagingActionState> {
  const userId = await getAuthedUserId();
  if (!userId) return { ok: false, message: "Log in first." };

  return openDirectConversation(userId, recipientId);
}

// ---------------------------------------------------------------------------
// Send (spec §7, §20)
// ---------------------------------------------------------------------------

export async function sendMessageAction(input: unknown): Promise<MessagingActionState> {
  const userId = await getAuthedUserId();
  if (!userId) return { ok: false, message: "Log in first." };

  return sendMessage(userId, input);
}

export async function getMessageableFriendsAction(): Promise<MessageableFriend[]> {
  const userId = await getAuthedUserId();
  if (!userId) return [];

  return listMessageableFriends(userId);
}

// ---------------------------------------------------------------------------
// Read / list (spec §19)
// ---------------------------------------------------------------------------

export async function getConversationsAction(): Promise<ConversationView[]> {
  const userId = await getAuthedUserId();
  if (!userId) return [];

  return listConversations(userId);
}

export async function getMessagesAction(conversationId: string): Promise<ChatMessageView[]> {
  const userId = await getAuthedUserId();
  if (!userId) return [];

  return listMessages(userId, conversationId);
}

export async function markConversationReadAction(conversationId: string): Promise<MessagingActionState> {
  const userId = await getAuthedUserId();
  if (!userId) return { ok: false, message: "Log in first." };

  return markConversationRead(userId, conversationId);
}

export async function muteConversationAction(
  conversationId: string,
  hours: number
): Promise<MessagingActionState> {
  const missing = missingEnvState();
  if (missing) return missing;
  if (!uuidSchema.safeParse(conversationId).success) return { ok: false, message: "Not found." };

  const userId = await getAuthedUserId();
  if (!userId) return { ok: false, message: "Log in first." };

  const admin = createSupabaseAdminClient();
  const mutedUntil = hours > 0 ? new Date(Date.now() + hours * 60 * 60 * 1000).toISOString() : null;
  await admin
    .from("conversation_members")
    .update({ muted_until: mutedUntil, updated_at: new Date().toISOString() })
    .eq("conversation_id", conversationId)
    .eq("user_id", userId);

  return { ok: true, message: mutedUntil ? "Conversation muted." : "Conversation unmuted." };
}

export async function setConversationPinnedAction(
  conversationId: string,
  pinned: boolean
): Promise<MessagingActionState> {
  const missing = missingEnvState();
  if (missing) return missing;
  if (!uuidSchema.safeParse(conversationId).success) return { ok: false, message: "Not found." };

  const userId = await getAuthedUserId();
  if (!userId) return { ok: false, message: "Log in first." };

  return setConversationPinned(userId, conversationId, pinned);
}

// ---------------------------------------------------------------------------
// Edit / delete / react (spec §13, §14, §15)
// ---------------------------------------------------------------------------

export async function editMessageAction(messageId: string, text: string): Promise<MessagingActionState> {
  const missing = missingEnvState();
  if (missing) return missing;
  if (!uuidSchema.safeParse(messageId).success) return { ok: false, message: "Message not found." };

  const textError = validateMessageText(text);
  if (textError) return { ok: false, message: textError };

  const userId = await getAuthedUserId();
  if (!userId) return { ok: false, message: "Log in first." };

  const admin = createSupabaseAdminClient();
  const { data: message } = await admin
    .from("messages")
    .select("id, sender_id, message_type, created_at, deleted_at")
    .eq("id", messageId)
    .maybeSingle();
  if (!message) return { ok: false, message: "Message not found." };

  if (
    !canEditMessage({
      isSender: message.sender_id === userId,
      createdAtMs: Date.parse(message.created_at),
      nowMs: Date.now(),
      messageType: message.message_type,
      deleted: Boolean(message.deleted_at)
    })
  ) {
    return { ok: false, message: "This message can't be edited anymore." };
  }

  const { error } = await admin
    .from("messages")
    .update({ text_content: text.trim(), edited_at: new Date().toISOString() })
    .eq("id", messageId)
    .eq("sender_id", userId);
  if (error) return { ok: false, message: "Couldn't edit that message." };
  return { ok: true, message: "Message edited." };
}

export async function deleteMessageAction(
  messageId: string,
  forEveryone: boolean
): Promise<MessagingActionState> {
  const missing = missingEnvState();
  if (missing) return missing;
  if (!uuidSchema.safeParse(messageId).success) return { ok: false, message: "Message not found." };

  const userId = await getAuthedUserId();
  if (!userId) return { ok: false, message: "Log in first." };

  const admin = createSupabaseAdminClient();

  if (!forEveryone) {
    // Delete for me: hide locally, leave the other participant's copy alone.
    await admin
      .from("message_hides")
      .upsert({ message_id: messageId, user_id: userId }, { onConflict: "message_id,user_id" });
    return { ok: true, message: "Message removed for you." };
  }

  const { data: message } = await admin
    .from("messages")
    .select("id, sender_id, created_at")
    .eq("id", messageId)
    .maybeSingle();
  if (!message) return { ok: false, message: "Message not found." };

  if (
    !canDeleteForEveryone({
      isSender: message.sender_id === userId,
      createdAtMs: Date.parse(message.created_at),
      nowMs: Date.now()
    })
  ) {
    return { ok: false, message: "This message can't be deleted for everyone anymore." };
  }

  const { error } = await admin
    .from("messages")
    .update({ status: "deleted", deleted_at: new Date().toISOString(), text_content: null })
    .eq("id", messageId)
    .eq("sender_id", userId);
  if (error) return { ok: false, message: "Couldn't delete that message." };
  return { ok: true, message: "Message deleted." };
}

export async function reactToMessageAction(
  messageId: string,
  reaction: string
): Promise<MessagingActionState> {
  const missing = missingEnvState();
  if (missing) return missing;
  if (!uuidSchema.safeParse(messageId).success) return { ok: false, message: "Message not found." };

  const parsed = z.enum(["heart", "laugh", "thumbs_up", "wave", "fire", "wow"]).safeParse(reaction);
  if (!parsed.success) return { ok: false, message: "Choose a valid reaction." };

  const userId = await getAuthedUserId();
  if (!userId) return { ok: false, message: "Log in first." };

  const admin = createSupabaseAdminClient();
  const { data: message } = await admin
    .from("messages")
    .select("conversation_id")
    .eq("id", messageId)
    .maybeSingle();
  if (!message) return { ok: false, message: "Message not found." };

  const access = await resolveConversationAccess(admin, userId, message.conversation_id);
  if (!access.canView) return { ok: false, message: "Message not found." };

  await admin
    .from("message_reactions")
    .upsert(
      { message_id: messageId, user_id: userId, reaction_type: parsed.data as MessageReactionType },
      { onConflict: "message_id,user_id" }
    );
  return { ok: true, message: "Reaction added." };
}

export async function removeMessageReactionAction(messageId: string): Promise<MessagingActionState> {
  const missing = missingEnvState();
  if (missing) return missing;
  const userId = await getAuthedUserId();
  if (!userId) return { ok: false, message: "Log in first." };

  const admin = createSupabaseAdminClient();
  await admin.from("message_reactions").delete().eq("message_id", messageId).eq("user_id", userId);
  return { ok: true, message: "Reaction removed." };
}

// ---------------------------------------------------------------------------
// Communication privacy preferences (spec §53-§56)
// ---------------------------------------------------------------------------

export async function getCommunicationPreferencesAction(): Promise<CommunicationPreferences> {
  const env = getSupabaseServerEnv();
  const userId = await getAuthedUserId();
  if (!env.url || !env.serviceRoleKey || !userId) return normalizeCommunicationPreferences(null);
  const admin = createSupabaseAdminClient();
  return loadCommunicationPreferences(admin, userId);
}

export async function updateCommunicationPreferencesAction(input: unknown): Promise<MessagingActionState> {
  const missing = missingEnvState();
  if (missing) return missing;

  const userId = await getAuthedUserId();
  if (!userId) return { ok: false, message: "Log in first." };

  const normalized = normalizeCommunicationPreferences(input);
  const admin = createSupabaseAdminClient();
  const { error } = await admin
    .from("user_preferences")
    .upsert(
      { user_id: userId, communication_preferences: normalized as never },
      { onConflict: "user_id" }
    );
  if (error) return { ok: false, message: "Couldn't save your settings." };
  return { ok: true, message: "Communication settings saved." };
}

// ---------------------------------------------------------------------------
// Messaging attachments (Stage 3D.1) — canonical, every conversation type.
// ---------------------------------------------------------------------------

export type AttachmentUploadState = MessagingActionState & {
  mediaId?: string;
  previewUrl?: string | null;
};

export type AttachmentUploadIntentState = AttachmentUploadState & {
  path?: string;
  token?: string;
  signedUrl?: string;
  expiresAt?: string;
};

const attachmentIntentSchema = z.object({
  conversationId: z.string().uuid(),
  contentType: z.enum(["image/jpeg", "image/png", "image/webp"]),
  sizeBytes: z.number().int().positive()
});

/** Starts the canonical direct-to-private-storage upload lifecycle. */
export async function createMessageAttachmentUploadIntentAction(
  input: unknown
): Promise<AttachmentUploadIntentState> {
  const missing = missingEnvState();
  if (missing) return missing;
  const userId = await getAuthedUserId();
  if (!userId) return { ok: false, message: "Log in before uploading." };
  const parsed = attachmentIntentSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Check that photo and try again." };

  const rateLimit = await consumeRateLimit({ action: "media.upload", userId });
  if (!rateLimit.allowed) return { ok: false, message: rateLimitMessage(rateLimit.resetAt) };
  const admin = createSupabaseAdminClient();
  const guard = await guardAction(admin, { userId, surface: "messaging", control: "media_uploads" });
  if (!guard.allowed) return { ok: false, message: guard.message };

  const { createChatUploadIntent } = await import("@/lib/media/chat-upload-service");
  const result = await createChatUploadIntent(admin, userId, { ...parsed.data, mediaKind: "image" });
  if (!result.ok) return result;
  return {
    ok: true,
    message: "Upload ready.",
    mediaId: result.intent.mediaId,
    path: result.intent.path,
    token: result.intent.token,
    signedUrl: result.intent.signedUrl,
    expiresAt: result.intent.expiresAt
  };
}

/**
 * The recorder receives only a server-resolved limit, never a client-selected
 * plan. Paid, trial, earned, grace, expiry, and Owner overrides therefore use
 * the same entitlement path as every protected premium capability.
 */
export async function getVoiceRecorderConfigAction(): Promise<VoiceRecorderConfig> {
  const env = getSupabaseServerEnv();
  const userId = await getAuthedUserId();
  if (!userId || !env.url || !env.serviceRoleKey) {
    return { enabled: false, maxDurationSeconds: 0 };
  }

  const entitlements = await resolveUserEntitlements(createSupabaseAdminClient(), userId);
  return {
    enabled: entitlements.voice_notes,
    maxDurationSeconds: entitlements.max_voice_note_seconds
  };
}

const voiceIntentSchema = z.object({
  conversationId: z.string().uuid(),
  contentType: z.enum(["audio/webm;codecs=opus", "audio/webm", "audio/mp4"]),
  sizeBytes: z.number().int().positive()
});

/** Creates a conversation-bound voice intent after server entitlement checks. */
export async function createVoiceMessageUploadIntentAction(input: unknown): Promise<AttachmentUploadIntentState> {
  const missing = missingEnvState();
  if (missing) return missing;
  const userId = await getAuthedUserId();
  if (!userId) return { ok: false, message: "Log in before uploading." };
  const parsed = voiceIntentSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "That voice recording isn't supported." };

  const rateLimit = await consumeRateLimit({ action: "media.upload", userId });
  if (!rateLimit.allowed) return { ok: false, message: rateLimitMessage(rateLimit.resetAt) };
  const admin = createSupabaseAdminClient();
  const guard = await guardAction(admin, { userId, surface: "messaging", control: "media_uploads" });
  if (!guard.allowed) return { ok: false, message: guard.message };
  const entitlements = await resolveUserEntitlements(admin, userId);
  if (!entitlements.voice_notes) return { ok: false, message: "Voice messages aren't available for this account." };

  const { createChatUploadIntent } = await import("@/lib/media/chat-upload-service");
  const result = await createChatUploadIntent(admin, userId, { ...parsed.data, mediaKind: "voice_note" });
  if (!result.ok) return result;
  return {
    ok: true,
    message: "Voice upload ready.",
    mediaId: result.intent.mediaId,
    path: result.intent.path,
    token: result.intent.token,
    signedUrl: result.intent.signedUrl,
    expiresAt: result.intent.expiresAt
  };
}

export type VoiceFinalizeState = AttachmentUploadState & { durationMs?: number };

/** Validates the stored container, codec, bytes and duration before READY. */
export async function finalizeVoiceMessageUploadAction(input: unknown): Promise<VoiceFinalizeState> {
  const missing = missingEnvState();
  if (missing) return missing;
  const userId = await getAuthedUserId();
  if (!userId) return { ok: false, message: "Log in before uploading." };
  const parsed = z.object({
    conversationId: z.string().uuid(),
    mediaId: z.string().uuid(),
    waveform: z.unknown().optional()
  }).safeParse(input);
  if (!parsed.success) return { ok: false, message: "That voice upload isn't available." };

  const admin = createSupabaseAdminClient();
  const guard = await guardAction(admin, { userId, surface: "messaging", control: "media_uploads" });
  if (!guard.allowed) return { ok: false, message: guard.message };
  const { finalizeChatUpload } = await import("@/lib/media/chat-upload-service");
  const result = await finalizeChatUpload(admin, userId, {
    ...parsed.data,
    expectedMediaKind: "voice_note"
  });
  return result.ok
    ? { ok: true, message: "Voice message prepared.", mediaId: result.mediaId, durationMs: result.durationMs ?? undefined }
    : result;
}

export type PreparedVoicePlaybackState = MessagingActionState & {
  playback?: AuthorizedVoicePlayback;
};

/** Mints a short-lived read grant only for the owner's ready, unsent asset. */
export async function getPreparedVoicePlaybackAction(input: unknown): Promise<PreparedVoicePlaybackState> {
  const missing = missingEnvState();
  if (missing) return missing;
  const userId = await getAuthedUserId();
  if (!userId) return { ok: false, message: "Log in before playing this voice message." };
  const parsed = z.object({ conversationId: z.string().uuid(), mediaId: z.string().uuid() }).safeParse(input);
  if (!parsed.success) return { ok: false, message: "That voice message isn't available." };

  const admin = createSupabaseAdminClient();
  const { getPreparedVoicePlayback } = await import("@/lib/media/voice-playback-service");
  const playback = await getPreparedVoicePlayback(admin, userId, parsed.data);
  return playback
    ? { ok: true, message: "Voice message ready.", playback }
    : { ok: false, message: "That voice message isn't available." };
}

/** Playback grant rooted in the sent parent message, never a bare asset id. */
export async function getMessageVoicePlaybackAction(input: unknown): Promise<PreparedVoicePlaybackState> {
  const missing = missingEnvState();
  if (missing) return missing;
  const userId = await getAuthedUserId();
  if (!userId) return { ok: false, message: "Log in before playing this voice message." };
  const parsed = z.object({ conversationId: z.string().uuid(), messageId: z.string().uuid() }).safeParse(input);
  if (!parsed.success) return { ok: false, message: "That voice message isn't available." };
  const admin = createSupabaseAdminClient();
  const { getMessageVoicePlayback } = await import("@/lib/media/voice-playback-service");
  const playback = await getMessageVoicePlayback(admin, userId, parsed.data);
  return playback
    ? { ok: true, message: "Voice message ready.", playback }
    : { ok: false, message: "That voice message isn't available." };
}

/** Finalizes and validates bytes uploaded through a server-issued intent. */
export async function finalizeMessageAttachmentUploadAction(input: unknown): Promise<AttachmentUploadState> {
  const missing = missingEnvState();
  if (missing) return missing;
  const userId = await getAuthedUserId();
  if (!userId) return { ok: false, message: "Log in before uploading." };
  const parsed = z.object({ conversationId: z.string().uuid(), mediaId: z.string().uuid() }).safeParse(input);
  if (!parsed.success) return { ok: false, message: "That upload isn't available." };

  const admin = createSupabaseAdminClient();
  const guard = await guardAction(admin, { userId, surface: "messaging", control: "media_uploads" });
  if (!guard.allowed) return { ok: false, message: guard.message };
  const { finalizeChatUpload } = await import("@/lib/media/chat-upload-service");
  const result = await finalizeChatUpload(admin, userId, { ...parsed.data, expectedMediaKind: "image" });
  return result.ok
    ? { ok: true, message: "Photo ready.", mediaId: result.mediaId, previewUrl: result.previewUrl }
    : result;
}

export async function refreshMessageAttachmentAction(input: unknown): Promise<{
  ok: boolean;
  message: string;
  attachment?: import("@/lib/messaging/attachments").AttachmentView;
}> {
  const missing = missingEnvState();
  if (missing) return missing;
  const userId = await getAuthedUserId();
  if (!userId) return { ok: false, message: "Log in first." };
  const parsed = z.object({ conversationId: z.string().uuid(), messageId: z.string().uuid() }).safeParse(input);
  if (!parsed.success) return { ok: false, message: "That attachment isn't available." };

  const admin = createSupabaseAdminClient();
  const { signAttachmentsForMessages } = await import("@/lib/messaging/attachments");
  const signed = await signAttachmentsForMessages(
    admin,
    userId,
    parsed.data.conversationId,
    [parsed.data.messageId]
  );
  const attachment = signed.values().next().value;
  return attachment
    ? { ok: true, message: "Attachment refreshed.", attachment }
    : { ok: false, message: "That attachment isn't available." };
}

/**
 * Upload one image for a message attachment.
 *
 * CANONICAL, not group-specific: it takes a conversation id, so direct
 * messages, group chats, plan chats, event chats and Safe Arrival threads all
 * use this one action. Nothing about it knows what kind of conversation it is
 * serving.
 *
 * Mirrors the Moments upload pipeline exactly — EXIF stripping, server-derived
 * storage key, thumb/feed variants, post-upload signature verification and
 * compensating cleanup — because that pipeline is already correct and a second
 * one would be a second place for a privacy rule to be forgotten.
 *
 * Membership is checked BEFORE any bytes are read, so a non-member cannot use
 * this as free storage or probe conversation ids.
 */
export async function uploadMessageAttachmentAction(formData: FormData): Promise<AttachmentUploadState> {
  const missing = missingEnvState();
  if (missing) return missing;

  const userId = await getAuthedUserId();
  if (!userId) return { ok: false, message: "Log in before uploading." };

  const conversationId = formData.get("conversationId");
  if (typeof conversationId !== "string" || !uuidSchema.safeParse(conversationId).success) {
    return { ok: false, message: "That conversation isn't available." };
  }

  const rateLimit = await consumeRateLimit({ action: "media.upload", userId });
  if (!rateLimit.allowed) return { ok: false, message: rateLimitMessage(rateLimit.resetAt) };

  const admin = createSupabaseAdminClient();

  // Kill switch + account restrictions, before any bytes are read or stored.
  const guard = await guardAction(admin, { userId, surface: "messaging", control: "media_uploads" });
  if (!guard.allowed) return { ok: false, message: guard.message };

  // Membership first: never store bytes for someone who cannot post here.
  const access = await canSendIntoConversation(admin, userId, conversationId);
  if (!access.allowed) return { ok: false, message: "That conversation isn't available." };

  const file = formData.get("media");
  if (!(file instanceof File)) return { ok: false, message: "Choose a photo first." };

  // Magic bytes, never the filename extension or the claimed MIME alone.
  const headerBytes = new Uint8Array(await file.slice(0, 32).arrayBuffer());
  const validation = validateImageUpload({
    claimedMimeType: file.type,
    headerBytes,
    sizeBytes: file.size,
    context: "chat"
  });
  if (!validation.valid) {
    return { ok: false, message: uploadValidationMessage(validation.reason) };
  }

  const { data: asset, error: assetError } = await admin
    .from("media_assets")
    .insert({
      owner_id: userId,
      // Placeholder; replaced with the real key below once the id is known.
      storage_key: `pending/${userId}/${Date.now()}`,
      content_type: validation.mimeType as MediaContentType,
      size_bytes: file.size,
      context_type: "chat",
      intended_conversation_id: conversationId,
      processing_status: "pending"
    })
    .select("id")
    .single();
  if (assetError || !asset) return { ok: false, message: "Couldn't prepare the upload." };

  // The path is DERIVED server-side from owner + context + asset id. The
  // uploader never supplies it, so it cannot write outside its own namespace
  // or collide with another conversation's media.
  const key = storageKeyFor({ ownerId: userId, context: "chat", mediaId: asset.id, kind: validation.kind });
  const removeFailedUpload = async (paths: string[] = []) => {
    if (paths.length > 0) await admin.storage.from("media").remove(paths);
    await admin.from("media_assets").delete().eq("id", asset.id).eq("owner_id", userId);
  };

  // Strip EXIF (GPS!) and build thumb/feed variants BEFORE anything reaches
  // storage — the stored original is already the metadata-free re-encode.
  let processed;
  try {
    const { processImageUpload } = await import("@/lib/media/processing");
    processed = await processImageUpload(Buffer.from(await file.arrayBuffer()), validation.kind);
  } catch {
    await removeFailedUpload();
    return { ok: false, message: "That image couldn't be processed. Try a different photo." };
  }

  const { toStorageArrayBuffer, variantStorageKey } = await import("@/lib/media/processing");
  const { error: uploadError } = await admin.storage
    .from("media")
    .upload(key, toStorageArrayBuffer(processed.original.buffer), {
      contentType: validation.mimeType,
      upsert: false
    });
  if (uploadError) {
    await removeFailedUpload();
    return { ok: false, message: "Couldn't upload that photo. Try again." };
  }

  // Variants are best-effort: signMediaForAsset falls back to the (already
  // stripped) original if a variant upload failed.
  const variantRows = [
    { variant: "thumb" as const, key: variantStorageKey(key, "thumb"), image: processed.variants.thumb },
    { variant: "feed" as const, key: variantStorageKey(key, "feed"), image: processed.variants.feed }
  ];
  await Promise.all(
    variantRows.map(async ({ variant, key: variantKey, image }) => {
      const { error } = await admin.storage.from("media").upload(variantKey, toStorageArrayBuffer(image.buffer), {
        contentType: validation.mimeType,
        upsert: false
      });
      if (error) return;
      await admin.from("media_variants").insert({
        media_asset_id: asset.id,
        variant_type: variant,
        storage_key: variantKey,
        width: image.width,
        height: image.height,
        size_bytes: image.buffer.byteLength
      });
    })
  );

  // Storage can acknowledge an upload even when a runtime has transformed its
  // request body. Verify the persisted signature before exposing the asset.
  const { data: storedOriginal, error: verifyError } = await admin.storage.from("media").download(key);
  const storedKind = storedOriginal
    ? sniffImageKind(new Uint8Array(await storedOriginal.slice(0, 12).arrayBuffer()))
    : null;
  if (verifyError || storedKind !== validation.kind) {
    await removeFailedUpload([key, ...variantRows.map((row) => row.key)]);
    return { ok: false, message: "That photo was not stored correctly. Please try again." };
  }

  const { error: readyError } = await admin
    .from("media_assets")
    .update({
      storage_key: key,
      processing_status: "ready",
      width: processed.original.width,
      height: processed.original.height,
      size_bytes: processed.original.buffer.byteLength,
      updated_at: new Date().toISOString()
    })
    .eq("id", asset.id)
    .eq("owner_id", userId);
  if (readyError) {
    await removeFailedUpload([key, ...variantRows.map((row) => row.key)]);
    return { ok: false, message: "Couldn't finish processing that photo. Try again." };
  }

  // A signed preview so the composer can show the real thumbnail before send,
  // rather than holding the original File in memory.
  const previewUrl = await signMediaForAsset(admin, asset.id, "thumb");

  return { ok: true, message: "Photo ready.", mediaId: asset.id, previewUrl };
}

/**
 * Discard an attachment the sender chose not to send.
 *
 * Without this, cancelling a photo would leave a ready `media_assets` row and
 * its stored objects behind forever — an orphan nobody can see and nobody
 * cleans up. Owner-scoped and only for unsent chat assets, so it can never
 * delete media already attached to a message.
 */
export async function discardMessageAttachmentAction(mediaId: string): Promise<AttachmentUploadState> {
  const missing = missingEnvState();
  if (missing) return missing;
  const userId = await getAuthedUserId();
  if (!userId || !uuidSchema.safeParse(mediaId).success) return { ok: false, message: "Nothing to discard." };

  const admin = createSupabaseAdminClient();
  const { data: attached } = await admin
    .from("messages")
    .select("id")
    .eq("media_id", mediaId)
    .limit(1)
    .maybeSingle();
  // Already sent: the message owns it now, and deleting it would blank a
  // message someone has already received.
  if (attached) return { ok: true, message: "Already sent." };

  const { data: asset } = await admin
    .from("media_assets")
    .select("storage_key")
    .eq("id", mediaId)
    .eq("owner_id", userId)
    .eq("context_type", "chat")
    .maybeSingle();
  if (!asset) return { ok: true, message: "Nothing to discard." };

  const { variantStorageKey } = await import("@/lib/media/processing");
  await admin.storage
    .from("media")
    .remove([asset.storage_key, variantStorageKey(asset.storage_key, "thumb"), variantStorageKey(asset.storage_key, "feed")]);
  await admin.from("media_assets").delete().eq("id", mediaId).eq("owner_id", userId);
  return { ok: true, message: "Attachment removed." };
}
