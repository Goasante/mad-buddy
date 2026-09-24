import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const read = (file: string) => fs.readFileSync(path.join(root, file), "utf8");

const migration = read("supabase/migrations/20260923231117_verification_moderation_lifecycle.sql");
const userPage = read("components/settings/verification-page.tsx");
const userActions = read("app/(app)/settings/verification-actions.ts");
const adminPage = read("app/(admin)/admin/verifications/page.tsx");
const adminActions = read("app/(admin)/admin/actions.ts");
const applicationControls = read("components/admin/verification-application-controls.tsx");
const correctionControls = read("components/admin/verification-controls.tsx");

describe("identity verification application lifecycle", () => {
  it("keeps evidence in a private, bounded bucket with no browser table access", () => {
    expect(migration).toContain("'verification-evidence'");
    expect(migration).toContain("false,");
    expect(migration).toContain("10485760");
    expect(migration).toContain("revoke all on public.verification_requests, public.verification_evidence from anon, authenticated");
    expect(migration).toContain("to service_role");
    expect(migration).not.toContain('public = true');
  });

  it("requires email, onboarding and a restriction-free account", () => {
    expect(userActions).toContain("email_confirmed_at");
    expect(userActions).toContain("is_onboarded");
    expect(userActions).toContain("activeRestrictions");
  });

  it("enforces account age and face-photo eligibility on the server", () => {
    expect(userActions).toContain("verificationApplicationEligibility");
    expect(read("app/(app)/settings/verification/page.tsx")).toContain("verificationApplicationEligibility");
    expect(userPage).toContain("Reviewers compare that photo with your selfie and ID");
  });

  it("requires an ID front and selfie before submission", () => {
    expect(userPage).toContain('files.document_front');
    expect(userPage).toContain('files.selfie');
    expect(userActions).toContain("submitVerificationRequest");
  });

  it("gives admin a real application queue and audits every evidence open", () => {
    expect(adminPage).toContain("loadVerificationApplications");
    expect(adminPage).toContain("VerificationApplicationControls");
    expect(adminActions).toContain("recordSensitiveAccess");
    expect(adminActions).toContain('category: "verification_document"');
    expect(adminActions).toContain("Open and review the ID and selfie before verifying this account.");
    expect(adminActions).toContain("caseReference: evidence.id");
    expect(adminActions).toContain("createSignedUrl(evidence.storage_path, 300)");
  });

  it("requires a current profile photo and explicit human face-match confirmation before approval", () => {
    expect(applicationControls).toContain("I compared the current profile photo, ID and selfie");
    expect(applicationControls).toContain("openVerificationEvidenceAction");
    expect(adminActions).toContain('profileMatchConfirmed === true');
    expect(adminActions).toContain('profile?.avatar_url?.trim()');
    expect(adminActions).toContain('profilePhotoMatched: true');
  });

  it("allows only owners and admins to grant verification with an audited reason", () => {
    expect(adminActions).toContain('access.role !== "owner" && access.role !== "admin"');
    expect(adminActions).toContain('action: "account_verification_admin_grant"');
    expect(adminActions).toContain('reason: parsed.data.reason');
    expect(correctionControls).toContain("grantAccountVerificationAction");
  });

  it("notifies users and writes the verified account result separately", () => {
    expect(userActions).toContain("notifyVerificationReviewers");
    expect(userActions).toContain('permission: "admin.verification.review"');
    expect(adminActions).toContain("decideAccountVerification(admin");
    expect(adminActions).toContain('title: "Account verified"');
    expect(adminActions).toContain('title: "Verification needs more information"');
  });

  it("shows an approved badge immediately in the admin identity row", () => {
    expect(applicationControls).toContain("router.refresh()");
    expect(correctionControls).toContain("router.refresh()");
    expect(adminPage).toContain('<VerifiedAccountMark isVerifiedAccount={entry.status === "verified"} compact />');
    expect(adminPage).toContain('<VerifiedAccountMark isVerifiedAccount={result.status === "verified"} compact />');
  });

  it("schedules evidence deletion after the retention period", () => {
    expect(migration).toContain("now() + interval '90 days'");
    expect(read("lib/jobs/rules.ts")).toContain('"verification.cleanup_evidence"');
    expect(read("lib/jobs/handlers.ts")).toContain("handleVerificationEvidenceCleanup");
  });
});
