import { NextResponse } from "next/server";
import { z } from "zod";

import { guardAction } from "@/lib/admin/enforcement";
import { resolveApiUser } from "@/lib/api/auth";
import { preflightResponse, withCors } from "@/lib/api/cors";
import { createChatUploadIntent, finalizeChatUpload } from "@/lib/media/chat-upload-service";
import {
  createChatV4RichUploadIntent,
  finalizeChatV4RichUpload
} from "@/lib/media/chat-v4-rich-upload-service";
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

const requestSchema = z.discriminatedUnion("operation", [intentSchema, finalizeSchema, viewSchema]);

function json(request: Request, payload: unknown, status = 200) {
  return withCors(NextResponse.json(payload, { status }), request);
}

export function OPTIONS(request: Request) {
  return preflightResponse(request);
}

/**
 * Independent transport for the media lifecycle used by the chat composer.
 *
 * The bytes already upload directly from the phone to private Supabase
 * Storage. What used to remain on the React Server Action lane were the
 * latency-sensitive control steps around that upload and the URL projection
 * after send. Keeping those in the same action transport as presence, drafts
 * and other chat mutations meant a slow media operation could make the
 * composer or a video/document bubble look frozen even though Storage was
 * progressing normally.
 *
 * This route keeps the exact server-side authorization and validation services
 * while giving media its own ordinary JSON request lane, matching the text-send
 * fast path in /api/messages/send.
 */
export async function POST(request: Request) {
  const auth = await resolveApiUser(request);
  if (!auth) return json(request, { ok: false, message: "Authentication required." }, 401);

  const body = await request.json().catch(() => null);
  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) return json(request, { ok: false, message: "Check that attachment and try again." }, 400);

  const admin = createSupabaseAdminClient();
  const userId = auth.user.id;

  if (parsed.data.operation === "view") {
    const media = await getRichMediaMessage(admin, userId, parsed.data);
    return json(request, { ok: true, media });
  }

  if (parsed.data.operation === "intent") {
    if (parsed.data.mediaKind === "image") {
      // Preserve the existing image-upload protection contract exactly.
      const rateLimit = await consumeRateLimit({ action: "media.upload", userId });
      if (!rateLimit.allowed) {
        return json(request, { ok: false, message: rateLimitMessage(rateLimit.resetAt) }, 429);
      }
      const guard = await guardAction(admin, { userId, surface: "messaging", control: "media_uploads" });
      if (!guard.allowed) return json(request, { ok: false, message: guard.message }, 403);

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
