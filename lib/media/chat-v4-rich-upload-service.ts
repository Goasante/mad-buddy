import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { CHAT_UPLOAD_INTENT_TTL_MS } from "@/lib/media/constants";
import {
  MAX_UPLOAD_BYTES,
  VIDEO_MIME_BY_KIND,
  kindForVideoMimeType,
  sniffVideoKind,
  type VideoKind
} from "@/lib/media/validation";
import { canSendMessage } from "@/lib/messaging/service";
import type { createSupabaseAdminClient } from "@/lib/supabase/admin";

type Admin = ReturnType<typeof createSupabaseAdminClient>;
export type ChatV4RichMediaKind = "video" | "file";

type DocumentKind = "pdf" | "txt" | "doc" | "docx" | "xls" | "xlsx" | "ppt" | "pptx";

const DOCUMENT_MIME_BY_KIND: Record<DocumentKind, string> = {
  pdf: "application/pdf",
  txt: "text/plain",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ppt: "application/vnd.ms-powerpoint",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation"
};

const DOCUMENT_KIND_BY_MIME = new Map<string, DocumentKind>(
  Object.entries(DOCUMENT_MIME_BY_KIND).map(([kind, mime]) => [mime, kind as DocumentKind])
);

const MAX_RICH_CHAT_MEDIA_BYTES = MAX_UPLOAD_BYTES.chat;

export type ChatV4RichUploadIntent = {
  mediaId: string;
  path: string;
  token: string;
  signedUrl: string;
  expiresAt: string;
  contentType: string;
  fileName: string;
  mediaKind: ChatV4RichMediaKind;
};

export type ChatV4RichUploadResult =
  | { ok: true; intent: ChatV4RichUploadIntent }
  | { ok: false; message: string };

export type ChatV4RichFinalizeResult =
  | {
      ok: true;
      mediaId: string;
      mediaKind: ChatV4RichMediaKind;
      contentType: string;
      fileName: string;
      sizeBytes: number;
    }
  | { ok: false; message: string };

function untyped(admin: Admin) {
  return admin as unknown as SupabaseClient;
}

function extension(name: string) {
  const value = name.split(".").pop()?.toLowerCase() ?? "";
  return value.replace(/[^a-z0-9]/g, "");
}

export function sanitizeChatFileName(value: string, fallback: string) {
  const leaf = value.replace(/\\/g, "/").split("/").pop() ?? "";
  const stripped = leaf.replace(/[\u0000-\u001f\u007f]/g, "").trim();
  return (stripped || fallback).slice(0, 180);
}

function videoKindFromInput(contentType: string, fileName: string): VideoKind | null {
  const byMime = kindForVideoMimeType(contentType);
  if (byMime) return byMime;
  const ext = extension(fileName);
  if (ext === "mp4" || ext === "m4v") return "mp4";
  if (ext === "webm") return "webm";
  if (ext === "mov") return "mov";
  return null;
}

function documentKindFromInput(contentType: string, fileName: string): DocumentKind | null {
  const byMime = DOCUMENT_KIND_BY_MIME.get(contentType);
  if (byMime) return byMime;
  const ext = extension(fileName) as DocumentKind;
  return Object.prototype.hasOwnProperty.call(DOCUMENT_MIME_BY_KIND, ext) ? ext : null;
}

function startsWith(bytes: Uint8Array, signature: readonly number[]) {
  return signature.every((byte, index) => bytes[index] === byte);
}

function isOle(bytes: Uint8Array) {
  return startsWith(bytes, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
}

function isZip(bytes: Uint8Array) {
  return startsWith(bytes, [0x50, 0x4b, 0x03, 0x04]) || startsWith(bytes, [0x50, 0x4b, 0x05, 0x06]);
}

function validUtf8Text(bytes: Uint8Array) {
  if (bytes.some((byte) => byte === 0)) return false;
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return true;
  } catch {
    return false;
  }
}

function validateDocumentBytes(bytes: Uint8Array, kind: DocumentKind) {
  if (kind === "pdf") return startsWith(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d]);
  if (kind === "txt") return validUtf8Text(bytes);
  if (kind === "doc" || kind === "xls" || kind === "ppt") return isOle(bytes);
  if (!isZip(bytes)) return false;

  // OOXML files are ZIP containers. Verify the family inside the container so
  // a renamed ZIP cannot become a Word/Excel/PowerPoint message merely by
  // changing its browser-reported MIME type.
  const container = Buffer.from(bytes).toString("latin1");
  if (kind === "docx") return container.includes("word/");
  if (kind === "xlsx") return container.includes("xl/");
  return container.includes("ppt/");
}

function removeResultMessage(kind: ChatV4RichMediaKind) {
  return kind === "video" ? "That video could not be verified. Try another one." : "That document could not be verified. Try another one.";
}

export async function createChatV4RichUploadIntent(
  admin: Admin,
  userId: string,
  input: {
    conversationId: string;
    contentType: string;
    sizeBytes: number;
    mediaKind: ChatV4RichMediaKind;
    fileName: string;
  }
): Promise<ChatV4RichUploadResult> {
  const permission = await canSendMessage(admin, userId, input.conversationId);
  if (!permission.allowed) return { ok: false, message: "That conversation isn't available." };
  if (!Number.isSafeInteger(input.sizeBytes) || input.sizeBytes <= 0) {
    return { ok: false, message: input.mediaKind === "video" ? "Choose a video first." : "Choose a document first." };
  }
  if (input.sizeBytes > MAX_RICH_CHAT_MEDIA_BYTES) {
    return { ok: false, message: "Use a file smaller than 15 MB." };
  }

  const videoKind = input.mediaKind === "video" ? videoKindFromInput(input.contentType, input.fileName) : null;
  const documentKind = input.mediaKind === "file" ? documentKindFromInput(input.contentType, input.fileName) : null;
  if (input.mediaKind === "video" && !videoKind) {
    return { ok: false, message: "Upload an MP4, WebM, or MOV video." };
  }
  if (input.mediaKind === "file" && !documentKind) {
    return { ok: false, message: "Upload a PDF, text, Word, Excel, or PowerPoint document." };
  }

  const resolvedExtension = videoKind ?? documentKind!;
  const contentType = videoKind ? VIDEO_MIME_BY_KIND[videoKind] : DOCUMENT_MIME_BY_KIND[documentKind!];
  const fileName = sanitizeChatFileName(
    input.fileName,
    input.mediaKind === "video" ? `video.${resolvedExtension}` : `document.${resolvedExtension}`
  );
  const mediaId = crypto.randomUUID();
  // Owner id remains the first segment because the media bucket's historical
  // ownership convention and cleanup tooling rely on that shape.
  const path = `${userId}/chat/${mediaId}.${resolvedExtension}`;
  const expiresAt = new Date(Date.now() + CHAT_UPLOAD_INTENT_TTL_MS).toISOString();
  const client = untyped(admin);
  const { error: assetError } = await client.from("media_assets").insert({
    id: mediaId,
    owner_id: userId,
    storage_key: path,
    content_type: contentType,
    size_bytes: input.sizeBytes,
    context_type: "chat",
    intended_conversation_id: input.conversationId,
    intended_media_kind: input.mediaKind,
    original_file_name: fileName,
    upload_expires_at: expiresAt,
    processing_status: "pending"
  });
  if (assetError) return { ok: false, message: "Couldn't prepare that upload." };

  const { data, error } = await admin.storage.from("media").createSignedUploadUrl(path, { upsert: false });
  if (error || !data) {
    await client.from("media_assets").delete().eq("id", mediaId).eq("owner_id", userId);
    return { ok: false, message: "Couldn't prepare that upload." };
  }

  return {
    ok: true,
    intent: {
      mediaId,
      path: data.path,
      token: data.token,
      signedUrl: data.signedUrl,
      expiresAt,
      contentType,
      fileName,
      mediaKind: input.mediaKind
    }
  };
}

export async function finalizeChatV4RichUpload(
  admin: Admin,
  userId: string,
  input: { conversationId: string; mediaId: string; expectedMediaKind: ChatV4RichMediaKind }
): Promise<ChatV4RichFinalizeResult> {
  const permission = await canSendMessage(admin, userId, input.conversationId);
  if (!permission.allowed) return { ok: false, message: "That conversation isn't available." };
  const client = untyped(admin);
  const { data: asset } = await client
    .from("media_assets")
    .select("id, owner_id, storage_key, content_type, size_bytes, processing_status, moderation_status, intended_conversation_id, intended_media_kind, original_file_name, upload_expires_at, deleted_at")
    .eq("id", input.mediaId)
    .eq("owner_id", userId)
    .eq("context_type", "chat")
    .maybeSingle();

  if (!asset || asset.intended_conversation_id !== input.conversationId || asset.intended_media_kind !== input.expectedMediaKind) {
    return { ok: false, message: "That upload isn't available." };
  }
  if (asset.processing_status === "ready") {
    return {
      ok: true,
      mediaId: String(asset.id),
      mediaKind: input.expectedMediaKind,
      contentType: String(asset.content_type),
      fileName: String(asset.original_file_name ?? (input.expectedMediaKind === "video" ? "Video" : "Document")),
      sizeBytes: Number(asset.size_bytes ?? 0)
    };
  }
  if (asset.processing_status !== "pending" || asset.deleted_at || asset.moderation_status !== "active") {
    return { ok: false, message: "That upload cannot be finalized." };
  }
  if (asset.upload_expires_at && Date.parse(String(asset.upload_expires_at)) < Date.now()) {
    return { ok: false, message: "That upload expired. Prepare it again." };
  }

  const { data: claimed } = await client
    .from("media_assets")
    .update({ processing_status: "processing", updated_at: new Date().toISOString() })
    .eq("id", asset.id)
    .eq("owner_id", userId)
    .eq("processing_status", "pending")
    .select("id")
    .maybeSingle();
  if (!claimed) return { ok: false, message: "That upload is already being processed." };

  const removeFailedUpload = async () => {
    await admin.storage.from("media").remove([String(asset.storage_key)]);
    await client.from("media_assets").delete().eq("id", asset.id).eq("owner_id", userId);
  };

  const { data: raw, error: downloadError } = await admin.storage.from("media").download(String(asset.storage_key));
  if (downloadError || !raw || raw.size <= 0 || raw.size > MAX_RICH_CHAT_MEDIA_BYTES) {
    await removeFailedUpload();
    return { ok: false, message: removeResultMessage(input.expectedMediaKind) };
  }
  const bytes = new Uint8Array(await raw.arrayBuffer());
  let contentType = String(asset.content_type);

  if (input.expectedMediaKind === "video") {
    const actualKind = sniffVideoKind(bytes.slice(0, 32));
    const claimedKind = videoKindFromInput(contentType, String(asset.original_file_name ?? ""));
    if (!actualKind || !claimedKind || actualKind !== claimedKind) {
      await removeFailedUpload();
      return { ok: false, message: "That file doesn't look like a supported MP4, WebM, or MOV video." };
    }
    contentType = VIDEO_MIME_BY_KIND[actualKind];
  } else {
    const kind = documentKindFromInput(contentType, String(asset.original_file_name ?? ""));
    if (!kind || !validateDocumentBytes(bytes, kind)) {
      await removeFailedUpload();
      return { ok: false, message: "That file doesn't match the selected document type." };
    }
    contentType = DOCUMENT_MIME_BY_KIND[kind];
  }

  const { error: readyError } = await client
    .from("media_assets")
    .update({
      content_type: contentType,
      size_bytes: raw.size,
      processing_status: "ready",
      upload_expires_at: null,
      updated_at: new Date().toISOString()
    })
    .eq("id", asset.id)
    .eq("owner_id", userId)
    .eq("processing_status", "processing");
  if (readyError) {
    await removeFailedUpload();
    return { ok: false, message: "Couldn't finish processing that attachment. Try again." };
  }

  return {
    ok: true,
    mediaId: String(asset.id),
    mediaKind: input.expectedMediaKind,
    contentType,
    fileName: String(asset.original_file_name ?? (input.expectedMediaKind === "video" ? "Video" : "Document")),
    sizeBytes: raw.size
  };
}
