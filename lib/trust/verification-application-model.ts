export const VERIFICATION_BUCKET = "verification-evidence";
export const VERIFICATION_MAX_FILE_BYTES = 10 * 1024 * 1024;

export const VERIFICATION_DOCUMENT_TYPES = [
  "passport",
  "national_id",
  "drivers_licence",
  "voter_id"
] as const;
export type VerificationDocumentType = (typeof VERIFICATION_DOCUMENT_TYPES)[number];

export const VERIFICATION_EVIDENCE_KINDS = ["document_front", "document_back", "selfie"] as const;
export type VerificationEvidenceKind = (typeof VERIFICATION_EVIDENCE_KINDS)[number];

export const VERIFICATION_REQUEST_STATUSES = [
  "draft",
  "pending",
  "under_review",
  "more_information_required",
  "verified",
  "declined",
  "revoked",
  "cancelled"
] as const;
export type VerificationRequestStatus = (typeof VERIFICATION_REQUEST_STATUSES)[number];

export type VerificationRequestView = {
  id: string;
  legalName: string;
  documentType: VerificationDocumentType;
  countryCode: string;
  status: VerificationRequestStatus;
  submittedAt: string | null;
  reviewedAt: string | null;
  userMessage: string | null;
  evidenceKinds: VerificationEvidenceKind[];
};

export function verificationRestrictionReason(restrictions: readonly string[]): string | null {
  if (restrictions.some((value) => value === "suspended_temporary" || value === "suspended_permanent")) {
    return "Resolve your account suspension before applying for verification.";
  }
  if (restrictions.length > 0) {
    return "Resolve the active restriction on your account before applying for verification.";
  }
  return null;
}
