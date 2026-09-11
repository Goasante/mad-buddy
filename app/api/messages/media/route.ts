import { NextResponse } from "next/server";
import { z } from "zod";

import { guardAction } from "@/lib/admin/enforcement";
import { resolveApiUser } from "@/lib/api/auth";
import { preflightResponse, withCors } from "@/lib/api/cors";
import { resolveUserEntitlements } from "@/lib/billing/service";
import {
  MAX_VOICE_NOTE_BYTES,
  MAX_VOICE_NOTE_DURATION_MS,
  normalizeVoiceAudioMime
} from "@/lib/media/audio-inspection";
import { createChatUploadIntent, finalizeChatUpload } from "@/lib/media/chat-upload-service";
import {
  createChatV4RichUploadIntent,
  finalizeChatV4RichUpload
} from "@/lib/media/chat-v4-rich-upload-service";
import { getMessageVoicePlayback } from "@/lib/media/voice-playback-service";
import { getRichMediaMessage } from "@/lib/messaging/rich-media-service";
import { consumeRateLimit, rateLimitMessage } from "@/lib/security/rate-limit";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

const uuid = z.string().uuid();
const mediaKind = z.enum(["image", "video", "file"]);

const intentSchema = z.object({
  operation: z.literal("intent"),
  conversationId: uuid,
  mediaKind,
  contentType: z.string().trim().min(1).max(160),
  sizeBytes: z.number().int().positive().max(15 * 1024 * 1024),
  fileName: z.string().trim().min(1).max(255).optional()
});

const finalizeSchema = z.object({
  operation: z.literal("finalize"),
  conversationId: uuid,
  mediaKind,
  mediaId: uuid
});

const viewSchema = z.object({
  operation: z.literal("view"),
  conversationId: uuid,
  messageId: uuid
});

const voiceIntentSchema = z.object({
  operation: z.literal("voice_intent"),
  conversationId: uuid,
  contentType: z
    .string()
    .trim()
    .min(1)
    .max(160)
    .refine((value) => normalizeVoiceAudioMime(value) !== null),
  sizeBytes: z.number().int().positive().max(MAX_VOICE_NOTE_BYTES)
});

const voiceFinalizeSchema = z.object({
  operation: z.literal("voice_finalize"),
  conversationId: uuid,
  mediaId: uuid,
  waveform: z.unknown().optional(),
  clientDurationMs: z.number().finite().positive().max(MAX_VOICE_NOTE_DURATION_MS).optional()
});

const voiceViewSchema = z.object({
  operation: z.literal("voice_view"),
  conversationId: uuid,
  messageId: uuid
});

const requestSchema = z.discriminatedUnion("operation", [
  intentSchema,
  finalizeSchema,
  viewSchema,
  voiceIntentSchema,
  voiceFinalizeSchema,
  voiceViewSchema
]);

function json(request: Request, payload: unknown, status = 200) {
  return withCors(NextResponse.json(payload, { status }), request);
}

export function OPTIONS(request: Request) {
  return preflightResponse(request);
}

async function authorizeUpload(admin: ReturnType<typeof createSupabaseAdminClient>, userId: string) {
  const rateLimit = await consumeRateLimit({ action: "media.upload", userId });
  if (!rateLimit.allowed) {
    return { ok: false as const, message: rateLimitMessage(rateLimit.resetAt), status: 429 };
  }
  const guard = await guardAction(admin, { userId, surface: "messaging", control: "media_uploads" });
  if (!guard.allowed) return { ok: false as const, message: guard.message, status: 403 };
  return { ok: true as const };
}

/**
 * Independent transport for the media lifecycle used by the chat composer.
 *
 * Raw bytes still travel directly from the phone to private Supabase Storage.
 * This route owns the latency-sensitive control steps around that transfer --
 * intent, finalize/verification, and short-lived playback projection -- so a
 * slow React Server Action queue cannot hold a photo, video, document or voice
 * note behind presence/draft work.
 *
 * Authorization and validation remain server-owned. The JSON lane only changes
 * transport; it does not make media public or weaken conversation, entitlement,
 * moderation, retention, file-type or size checks.
 */
export async function POST(request: Request) {
  const auth = await resolveApiUser(request);
  if (!auth) return json(request, { ok: false, message: "Authentication required." }, 401);

  const body = await request.json().catch(() => null);
  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) return json(request, { ok: false, message: "Check that attachment and try again." }, 400);

  const admin = createSupabaseAdminClient();
  const userId = auth.user.id;

  if (parsed.data.operation === "voice_view") {
    const playback = await getMessageVoicePlayback(admin, userId, parsed.data);
    // A null playback is an authoritative unavailable/expired/access answer,
    // distinct from a transport failure in the browser client.
    return json(request, { ok: true, playback });
  }

  if (parsed.data.operation === "view") {
    const media = await getRichMediaMessage(admin, userId, parsed.data);
    return json(request, { ok: true, media });
  }

  if (parsed.data.operation === "voice_intent") {
    const upload = await authorizeUpload(admin, userId);
    if (!upload.ok) return json(request, { ok: false, message: upload.message }, upload.status);

    const entitlements = await resolveUserEntitlements(admin, userId);
    if (!entitlements.voice_notes) {
      return json(request, { ok: false, message: "Voice messages aren't available for this account." }, 403);
    }

    const result = await createChatUploadIntent(admin, userId, {
      conversationId: parsed.data.conversationId,
      contentType: parsed.data.contentType,
      sizeBytes: parsed.data.sizeBytes,
      mediaKind: "voice_note"
    });
    return json(request, result, result.ok ? 200 : 400);
  }

  if (parsed.data.operation === "voice_finalize") {
    const guard = await guardAction(admin, { userId, surface: "messaging", control: "media_uploads" });
    if (!guard.allowed) return json(request, { ok: false, message: guard.message }, 403);

    const result = await finalizeChatUpload(admin, userId, {
      conversationId: parsed.data.conversationId,
      mediaId: parsed.data.mediaId,
      expectedMediaKind: "voice_note",
      waveform: parsed.data.waveform,
      clientDurationMs: parsed.data.clientDurationMs
    });
    return result.ok
      ? json(request, {
          ok: true,
          message: "Voice message prepared.",
          mediaId: result.mediaId,
          durationMs: result.durationMs ?? undefined
        })
      : json(request, result, 400);
  }

  if (parsed.data.operation === "intent") {
    if (parsed.data.mediaKind === "image") {
      const upload = await authorizeUpload(admin, userId);
      if (!upload.ok) return json(request, { ok: false, message: upload.message }, upload.status);

      const result = await createChatUploadIntent(admin, userId, {
        conversationId: parsed.data.conversationId,
        contentType: parsed.data.contentType,
        sizeBytes: parsed.data.sizeBytes,
        mediaKind: "image"
      });
      return json(request, result, result.ok ? 200 : 400);
    }

    const result = await createChatV4RichUploadIntent(admin, userId, {
      conversationId: parsed.data.conversationId,
      contentType: parsed.data.contentType,
      sizeBytes: parsed.data.sizeBytes,
      mediaKind: parsed.data.mediaKind,
      fileName: parsed.data.fileName ?? (parsed.data.mediaKind === "video" ? "video" : "document")
    });
    return json(request, result, result.ok ? 200 : 400);
  }

  if (parsed.data.mediaKind === "image") {
    const guard = await guardAction(admin, { userId, surface: "messaging", control: "media_uploads" });
    if (!guard.allowed) return json(request, { ok: false, message: guard.message }, 403);

    const result = await finalizeChatUpload(admin, userId, {
      conversationId: parsed.data.conversationId,
      mediaId: parsed.data.mediaId,
      expectedMediaKind: "image"
    });
    return json(request, result, result.ok ? 200 : 400);
  }

  const result = await finalizeChatV4RichUpload(admin, userId, {
    conversationId: parsed.data.conversationId,
    mediaId: parsed.data.mediaId,
    expectedMediaKind: parsed.data.mediaKind
  });
  return json(request, result, result.ok ? 200 : 400);
}
