import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/lib/supabase/database.types";
import type { VerificationDocumentType, VerificationEvidenceKind, VerificationRequestStatus } from "@/lib/trust/verification-application";

type VerificationAdmin = SupabaseClient<Database>;
type VerificationProfile = Pick<Database["public"]["Tables"]["profiles"]["Row"], "user_id" | "full_name" | "username" | "avatar_url" | "bio">;
type VerificationEvidence = Pick<Database["public"]["Tables"]["verification_evidence"]["Row"], "id" | "request_id" | "evidence_kind" | "original_file_name" | "content_type">;

export type VerificationApplicationEntry = {
  requestId: string;
  userId: string;
  displayName: string;
  username: string;
  avatarUrl: string | null;
  profileBio: string | null;
  legalName: string;
  documentType: VerificationDocumentType;
  countryCode: string;
  status: VerificationRequestStatus;
  submittedAt: string | null;
  userMessage: string | null;
  evidence: Array<{ id: string; kind: VerificationEvidenceKind; fileName: string | null; contentType: string }>;
};

export async function loadVerificationApplications(admin: VerificationAdmin): Promise<VerificationApplicationEntry[]> {
  const { data: requests } = await admin
    .from("verification_requests")
    .select("id, user_id, legal_name, document_type, country_code, status, submitted_at, user_message")
    .in("status", ["pending", "under_review", "more_information_required"])
    .order("submitted_at", { ascending: true, nullsFirst: false })
    .limit(100);
  if (!requests?.length) return [];

  const requestIds = requests.map((row: { id: string }) => row.id);
  const userIds = [...new Set(requests.map((row: { user_id: string }) => row.user_id))];
  const [{ data: profiles }, { data: evidence }] = await Promise.all([
    admin.from("profiles").select("user_id, full_name, username, avatar_url, bio").in("user_id", userIds),
    admin.from("verification_evidence").select("id, request_id, evidence_kind, original_file_name, content_type").in("request_id", requestIds).is("deleted_at", null).not("validated_at", "is", null)
  ]);
  const profileById = new Map((profiles ?? []).map((row) => [row.user_id, row as VerificationProfile]));

  return requests.map((row) => {
    const profile = profileById.get(row.user_id);
    return {
      requestId: row.id,
      userId: row.user_id,
      displayName: profile?.full_name?.trim() || "A Muddy",
      username: profile?.username || "muddy",
      avatarUrl: profile?.avatar_url ?? null,
      profileBio: profile?.bio ?? null,
      legalName: row.legal_name,
      documentType: row.document_type,
      countryCode: row.country_code,
      status: row.status,
      submittedAt: row.submitted_at,
      userMessage: row.user_message,
      evidence: (evidence ?? []).filter((item) => item.request_id === row.id).map((item) => {
        const typed = item as VerificationEvidence;
        return { id: typed.id, kind: typed.evidence_kind, fileName: typed.original_file_name, contentType: typed.content_type };
      })
    };
  });
}
