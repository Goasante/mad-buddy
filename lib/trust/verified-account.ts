export type VerificationStatus = "pending" | "verified" | "failed" | "expired" | "revoked";

export type VerificationRow = {
  status: VerificationStatus;
};

export function hasVerifiedAccountStatus(rows: readonly VerificationRow[] | null | undefined): boolean {
  return (rows ?? []).some((row) => row.status === "verified");
}
