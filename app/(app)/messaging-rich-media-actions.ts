"use server";

import { z } from "zod";

import {
  createChatV4RichUploadIntent,
  finalizeChatV4RichUpload
} from "@/lib/media/chat-v4-rich-upload-service";
import { getRichMediaMessage } from "@/lib/messaging/rich-media-service";
import type { RichMediaMessageView } from "@/lib/messaging/rich-media-v4-types";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getSupabaseServerEnv } from "@/lib/supabase/env";
import {
  getAuthoritativeMessagingUserId,
  getMessagingIdentityId
} from "@/lib/messaging/action-auth";

const uuid = z.string().uuid();
const richKind = z.enum(["video", "file"]);
const createIntentSchema = z.object({
  conversationId: uuid,
  contentType: z.string().trim().min(1).max(160),
  sizeBytes: z.number().int().positive().max(15 * 1024 * 1024),
  mediaKind: richKind,
  fileName: z.string().trim().min(1).max(255)
});
const finalizeSchema = z.object({
  conversationId: uuid,
  mediaId: uuid,
  expectedMediaKind: richKind
});
const playbackSchema = z.object({ conversationId: uuid, messageId: uuid });

function configured() {
  const env = getSupabaseServerEnv();
  return Boolean(env.url && env.serviceRoleKey);
}

export async function createChatRichMediaUploadIntentAction(input: unknown) {
  if (!configured()) return { ok: false as const, message: "Chats are not configured." };
  const parsed = createIntentSchema.safeParse(input);
  if (!parsed.success) return { ok: false as const, message: "Check that attachment and try again." };
  const userId = await getAuthoritativeMessagingUserId();
  if (!userId) return { ok: false as const, message: "Log in first." };
  return createChatV4RichUploadIntent(createSupabaseAdminClient(), userId, parsed.data);
}

export async function finalizeChatRichMediaUploadAction(input: unknown) {
  if (!configured()) return { ok: false as const, message: "Chats are not configured." };
  const parsed = finalizeSchema.safeParse(input);
  if (!parsed.success) return { ok: false as const, message: "That upload isn't available." };
  const userId = await getAuthoritativeMessagingUserId();
  if (!userId) return { ok: false as const, message: "Log in first." };
  return finalizeChatV4RichUpload(createSupabaseAdminClient(), userId, parsed.data);
}

/**
 * Legacy Server Action transport kept for non-V4 callers and tests. The
 * projection itself lives in a transport-neutral server service so the V4
 * bubble can use the independent JSON media lane without duplicating any
 * access, block, retention or signing rule.
 */
export async function getRichMediaMessageAction(input: unknown): Promise<RichMediaMessageView | null> {
  if (!configured()) return null;
  const parsed = playbackSchema.safeParse(input);
  if (!parsed.success) return null;
  const viewerId = await getMessagingIdentityId();
  if (!viewerId) return null;
  return getRichMediaMessage(createSupabaseAdminClient(), viewerId, parsed.data);
}
