export const VERIFICATION_BUCKET = "verification-evidence";
export const VERIFICATION_MAX_FILE_BYTES = 10 * 1024 * 1024;
export const VERIFICATION_MIN_ACCOUNT_AGE_DAYS = 30;

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

/** The waiting period applies to applications, never to an Admin grant. */
export function verificationApplicationEligibility(input: {
  createdAt: string;
  profilePhotoUrl: string | null;
  nowMs?: number;
}): string | null {
  const joinedAt = Date.parse(input.createdAt);
  const eligibleAt = joinedAt + VERIFICATION_MIN_ACCOUNT_AGE_DAYS * 24 * 60 * 60 * 1000;
  const now = input.nowMs ?? Date.now();
  if (!Number.isFinite(joinedAt) || !Number.isFinite(now)) return "Your account age could not be confirmed. Try again later.";
  if (now < eligibleAt) {
    return `You can apply for verification from ${new Intl.DateTimeFormat("en", { dateStyle: "medium", timeZone: "UTC" }).format(new Date(eligibleAt))}, after 30 days on Mad Buddy.`;
  }
  if (!input.profilePhotoUrl?.trim()) {
    return "Add a clear photo of your face to your profile before applying for verification.";
  }
  return null;
}
