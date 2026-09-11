"use client";

import type { RichMediaMessageView } from "@/lib/messaging/rich-media-v4-types";
import { fetchWithTimeout } from "@/lib/network/resilience";

type MediaKind = "image" | "video" | "file";

type UploadIntent = {
  mediaId: string;
  path: string;
  token: string;
  signedUrl: string;
  expiresAt: string;
  contentType?: string;
  fileName?: string;
  mediaKind?: "video" | "file";
};

type IntentPayload = {
  ok: boolean;
  message?: string;
  intent?: UploadIntent;
};

type FinalizePayload = {
  ok: boolean;
  message?: string;
  mediaId?: string;
  previewUrl?: string | null;
  mediaKind?: "video" | "file";
  contentType?: string;
  fileName?: string;
  sizeBytes?: number;
};

async function postMedia<T>(body: unknown, timeoutMs: number): Promise<T | null> {
  try {
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

    return await response.json().catch(() => null) as T | null;
  } catch {
    // The caller owns retry/fallback UI. Returning null/failed keeps mobile
    // network interruption out of an unhandled promise state.
    return null;
  }
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
  if (!payload?.ok || !payload.intent) {
    return { ok: false as const, message: payload?.message ?? "Couldn't prepare that photo. Try again." };
  }
  return {
    ok: true as const,
    message: payload.message ?? "Upload ready.",
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
  const payload = await postMedia<FinalizePayload>(
    { operation: "finalize", mediaKind: "image", ...input },
    45_000
  );
  return payload ?? { ok: false, message: "Couldn't finish that photo. Try again." };
}

export async function createRichMediaUploadIntentViaApi(input: {
  conversationId: string;
  contentType: string;
  sizeBytes: number;
  mediaKind: "video" | "file";
  fileName: string;
}) {
  const payload = await postMedia<IntentPayload>(
    { operation: "intent", ...input },
    12_000
  );
  if (!payload?.ok || !payload.intent) {
    return { ok: false as const, message: payload?.message ?? "Couldn't prepare that attachment. Try again." };
  }
  return { ok: true as const, message: payload.message ?? "Upload ready.", intent: payload.intent };
}

export async function finalizeRichMediaUploadViaApi(input: {
  conversationId: string;
  mediaId: string;
  expectedMediaKind: "video" | "file";
}) {
  const mediaKind: MediaKind = input.expectedMediaKind;
  const payload = await postMedia<FinalizePayload>(
    {
      operation: "finalize",
      conversationId: input.conversationId,
      mediaId: input.mediaId,
      mediaKind
    },
    45_000
  );
  return payload ?? { ok: false, message: "Couldn't finish that attachment. Try again." };
}

/**
 * V4 video/document bubble transport. Null means the message is inaccessible,
 * expired, removed, or the request was interrupted; no Server Action queue is
 * involved in minting the short-lived playback URL.
 */
export async function getRichMediaMessageViaApi(input: {
  conversationId: string;
  messageId: string;
}): Promise<RichMediaMessageView | null> {
  const payload = await postMedia<{ ok: boolean; media: RichMediaMessageView | null }>(
    { operation: "view", ...input },
    15_000
  );
  return payload?.ok ? payload.media : null;
}
