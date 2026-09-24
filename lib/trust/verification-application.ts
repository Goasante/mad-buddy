import "server-only";

import crypto from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

import { sniffImageKind } from "@/lib/media/validation";
import type { Database } from "@/lib/supabase/database.types";
import {
  VERIFICATION_BUCKET,
  VERIFICATION_MAX_FILE_BYTES,
  type VerificationDocumentType,
  type VerificationEvidenceKind,
  type VerificationRequestView
} from "@/lib/trust/verification-application-model";

export {
  VERIFICATION_BUCKET,
  VERIFICATION_DOCUMENT_TYPES,
  VERIFICATION_EVIDENCE_KINDS,
  VERIFICATION_MAX_FILE_BYTES,
  VERIFICATION_REQUEST_STATUSES,
  verificationRestrictionReason
} from "@/lib/trust/verification-application-model";
export type {
  VerificationDocumentType,
  VerificationEvidenceKind,
  VerificationRequestStatus,
  VerificationRequestView
} from "@/lib/trust/verification-application-model";

type Admin = SupabaseClient<Database>;

const CONTENT_TYPE_EXTENSIONS: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "application/pdf": "pdf"
};

export async function loadLatestVerificationRequest(admin: Admin, userId: string): Promise<VerificationRequestView | null> {
  const client = admin;
  const { data: request } = await client
    .from("verification_requests")
    .select("id, legal_name, document_type, country_code, status, submitted_at, reviewed_at, user_message")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!request) return null;

  const { data: evidence } = await client
    .from("verification_evidence")
    .select("evidence_kind")
    .eq("request_id", request.id)
    .is("deleted_at", null);

  return {
    id: request.id,
    legalName: request.legal_name,
    documentType: request.document_type,
    countryCode: request.country_code,
    status: request.status,
    submittedAt: request.submitted_at,
    reviewedAt: request.reviewed_at,
    userMessage: request.user_message,
    evidenceKinds: (evidence ?? []).map((row: { evidence_kind: VerificationEvidenceKind }) => row.evidence_kind)
  };
}

export type VerificationUploadIntent = {
  evidenceId: string;
  requestId: string;
  path: string;
  token: string;
  signedUrl: string;
};

export async function createVerificationUploadIntent(
  admin: Admin,
  input: {
    userId: string;
    legalName: string;
    documentType: VerificationDocumentType;
    countryCode: string;
    evidenceKind: VerificationEvidenceKind;
    contentType: string;
    sizeBytes: number;
    fileName: string;
  }
): Promise<{ ok: true; intent: VerificationUploadIntent } | { ok: false; message: string }> {
  const extension = CONTENT_TYPE_EXTENSIONS[input.contentType];
  if (!extension) return { ok: false, message: "Upload a JPG, PNG, WebP or PDF file." };
  if (!Number.isSafeInteger(input.sizeBytes) || input.sizeBytes < 1 || input.sizeBytes > VERIFICATION_MAX_FILE_BYTES) {
    return { ok: false, message: "Use a file smaller than 10 MB." };
  }

  const client = admin;
  const { data: existing } = await client
    .from("verification_requests")
    .select("id, status")
    .eq("user_id", input.userId)
    .in("status", ["draft", "more_information_required"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  let requestId = existing?.id as string | undefined;
  if (requestId) {
    const { error } = await client
      .from("verification_requests")
      .update({
        legal_name: input.legalName,
        document_type: input.documentType,
        country_code: input.countryCode,
        status: "draft",
        user_message: null,
        updated_at: new Date().toISOString()
      })
      .eq("id", requestId)
      .eq("user_id", input.userId);
    if (error) return { ok: false, message: "The verification request could not be prepared." };
  } else {
    const { data: created, error } = await client
      .from("verification_requests")
      .insert({
        user_id: input.userId,
        legal_name: input.legalName,
        document_type: input.documentType,
        country_code: input.countryCode,
        status: "draft"
      })
      .select("id")
      .single();
    if (error || !created) return { ok: false, message: "The verification request could not be prepared." };
    requestId = created.id;
  }

  const old = await client
    .from("verification_evidence")
    .select("id, storage_path")
    .eq("request_id", requestId)
    .eq("evidence_kind", input.evidenceKind)
    .maybeSingle();
  if (old.data?.storage_path) {
    await admin.storage.from(VERIFICATION_BUCKET).remove([old.data.storage_path]);
    await client.from("verification_evidence").delete().eq("id", old.data.id).eq("user_id", input.userId);
  }

  const evidenceId = crypto.randomUUID();
  const path = `${input.userId}/${requestId}/${evidenceId}.${extension}`;
  const safeName = input.fileName.replace(/[^a-zA-Z0-9._ -]/g, "").slice(0, 180) || `evidence.${extension}`;
  const { error: evidenceError } = await client.from("verification_evidence").insert({
    id: evidenceId,
    request_id: requestId,
    user_id: input.userId,
    evidence_kind: input.evidenceKind,
    storage_path: path,
    content_type: input.contentType,
    size_bytes: input.sizeBytes,
    original_file_name: safeName
  });
  if (evidenceError) return { ok: false, message: "The evidence upload could not be prepared." };

  const { data, error } = await admin.storage.from(VERIFICATION_BUCKET).createSignedUploadUrl(path, { upsert: false });
  if (error || !data) {
    await client.from("verification_evidence").delete().eq("id", evidenceId).eq("user_id", input.userId);
    return { ok: false, message: "The evidence upload could not be prepared." };
  }

  const finalRequestId = requestId;
  if (!finalRequestId) return { ok: false, message: "The verification request could not be prepared." };
  return { ok: true, intent: { evidenceId, requestId: finalRequestId, path: data.path, token: data.token, signedUrl: data.signedUrl } };
}

function isExpectedFile(bytes: Uint8Array, contentType: string): boolean {
  if (contentType === "application/pdf") {
    return bytes.length >= 5 && String.fromCharCode(...bytes.slice(0, 5)) === "%PDF-";
  }
  const kind = sniffImageKind(bytes);
  return (
    (contentType === "image/jpeg" && kind === "jpg") ||
    (contentType === "image/png" && kind === "png") ||
    (contentType === "image/webp" && kind === "webp")
  );
}

export async function finalizeVerificationEvidence(
  admin: Admin,
  input: { userId: string; evidenceId: string }
): Promise<{ ok: boolean; message: string }> {
  const client = admin;
  const { data: evidence } = await client
    .from("verification_evidence")
    .select("id, user_id, storage_path, content_type, size_bytes")
    .eq("id", input.evidenceId)
    .eq("user_id", input.userId)
    .is("deleted_at", null)
    .maybeSingle();
  if (!evidence) return { ok: false, message: "That evidence upload is unavailable." };

  const { data: file, error } = await admin.storage.from(VERIFICATION_BUCKET).download(evidence.storage_path);
  if (error || !file || file.size !== Number(evidence.size_bytes)) {
    await admin.storage.from(VERIFICATION_BUCKET).remove([evidence.storage_path]);
    await client.from("verification_evidence").delete().eq("id", evidence.id);
    return { ok: false, message: "The uploaded file could not be verified. Upload it again." };
  }
  const bytes = new Uint8Array(await file.slice(0, 32).arrayBuffer());
  if (!isExpectedFile(bytes, evidence.content_type)) {
    await admin.storage.from(VERIFICATION_BUCKET).remove([evidence.storage_path]);
    await client.from("verification_evidence").delete().eq("id", evidence.id);
    return { ok: false, message: "The file contents do not match the selected file type." };
  }
  const { error: validatedError } = await client
    .from("verification_evidence")
    .update({ validated_at: new Date().toISOString() })
    .eq("id", evidence.id)
    .eq("user_id", input.userId);
  if (validatedError) return { ok: false, message: "The uploaded file could not be finalised." };
  return { ok: true, message: "Evidence uploaded." };
}

export async function submitVerificationRequest(
  admin: Admin,
  input: { userId: string; requestId: string }
): Promise<{ ok: boolean; message: string }> {
  const client = admin;
  const { data: request } = await client
    .from("verification_requests")
    .select("id, status")
    .eq("id", input.requestId)
    .eq("user_id", input.userId)
    .maybeSingle();
  if (!request || request.status !== "draft") return { ok: false, message: "That request cannot be submitted." };

  const { data: evidence } = await client
    .from("verification_evidence")
    .select("evidence_kind")
    .eq("request_id", input.requestId)
    .eq("user_id", input.userId)
    .is("deleted_at", null)
    .not("validated_at", "is", null);
  const kinds = new Set((evidence ?? []).map((row: { evidence_kind: string }) => row.evidence_kind));
  if (!kinds.has("document_front") || !kinds.has("selfie")) {
    return { ok: false, message: "Upload the front of your ID and a selfie before submitting." };
  }

  const now = new Date().toISOString();
  const { error } = await client
    .from("verification_requests")
    .update({ status: "pending", submitted_at: now, user_message: null, updated_at: now })
    .eq("id", input.requestId)
    .eq("user_id", input.userId)
    .eq("status", "draft");
  return error
    ? { ok: false, message: "The verification request could not be submitted." }
    : { ok: true, message: "Verification request submitted for review." };
}
