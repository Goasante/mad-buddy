"use client";

import { fetchWithTimeout } from "@/lib/network/resilience";

type MediaKind = "image" | "video" | "file";

type IntentPayload = {
  ok: boolean;
  message: string;
  intent?: {
    mediaId: string;
    path: string;
    token: string;
    signedUrl: string;
    expiresAt: string;
    contentType?: string;
    fileName?: string;
    mediaKind?: "video" | "file";
  };
};

type FinalizePayload = {
  ok: boolean;
  message: string;
  mediaId?: string;
  previewUrl?: string | null;
  mediaKind?: "video" | "file";
  contentType?: string;
  fileName?: string;
  sizeBytes?: number;
};

async function postMedia<T>(body: unknown, timeoutMs: number): Promise<T> {
  const response = await fetchWithTimeout(
    "/api/messages/media",
    {
      method: "POST",
      credentials: "same-origin",
      cache: "no-store",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json"
      },
      body: JSON.stringify(body)
    },
    timeoutMs,
    "chat media"
  );

  const payload = await response.json().catch(() => null) as T | null;
  if (payload) return payload;
  throw new Error("The attachment service returned an invalid response.");
}

/** The old Server Action return shape, preserved for the picker. */
export async function createImageUploadIntentViaApi(input: {
  conversationId: string;
  contentType: string;
  sizeBytes: number;
}) {
  const payload = await postMedia<IntentPayload>(
    { operation: "intent", mediaKind: "image", ...input },
    12_000
  );
  if (!payload.ok || !payload.intent) return { ok: false as const, message: payload.message };
  return {
    ok: true as const,
    message: payload.message,
    mediaId: payload.intent.mediaId,
    path: payload.intent.path,
    token: payload.intent.token,
    signedUrl: payload.intent.signedUrl,
    expiresAt: payload.intent.expiresAt
  };
}

export async function finalizeImageUploadViaApi(input: {
  conversationId: string;
  mediaId: string;
}) {
  return postMedia<FinalizePayload>(
    { operation: "finalize", mediaKind: "image", ...input },
    30_000
  );
}

export async function createRichMediaUploadIntentViaApi(input: {
  conversationId: string;
  contentType: string;
  sizeBytes: number;
  mediaKind: "video" | "file";
  fileName: string;
}) {
  return postMedia<IntentPayload>(
    { operation: "intent", ...input },
    12_000
  );
}

export async function finalizeRichMediaUploadViaApi(input: {
  conversationId: string;
  mediaId: string;
  expectedMediaKind: "video" | "file";
}) {
  const mediaKind: MediaKind = input.expectedMediaKind;
  return postMedia<FinalizePayload>(
    {
      operation: "finalize",
      conversationId: input.conversationId,
      mediaId: input.mediaId,
      mediaKind
    },
    30_000
  );
}
