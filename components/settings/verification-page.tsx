"use client";

import { BadgeCheck, FileCheck2, Loader2, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import {
  createVerificationEvidenceUploadAction,
  finalizeVerificationEvidenceAction,
  submitVerificationRequestAction
} from "@/app/(app)/settings/verification-actions";
import { SettingsSubHeader } from "@/components/settings/settings-sub-header";
import { AppSelect } from "@/components/ui/app-dropdown";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import {
  VERIFICATION_BUCKET,
  type VerificationDocumentType,
  type VerificationEvidenceKind,
  type VerificationRequestView
} from "@/lib/trust/verification-application-model";

const DOCUMENT_OPTIONS = [
  { value: "national_id" as const, label: "National ID" },
  { value: "passport" as const, label: "Passport" },
  { value: "drivers_licence" as const, label: "Driver's licence" },
  { value: "voter_id" as const, label: "Voter ID" }
];

const STATUS_LABELS: Record<string, string> = {
  draft: "Not submitted",
  pending: "Waiting for review",
  under_review: "Under review",
  more_information_required: "More information required",
  verified: "Verified",
  declined: "Declined",
  revoked: "Verification revoked",
  cancelled: "Cancelled"
};

type FileSelection = Partial<Record<VerificationEvidenceKind, File>>;

export function VerificationPage({
  request,
  eligibilityMessage,
  isVerifiedAccount
}: {
  request: VerificationRequestView | null;
  eligibilityMessage: string | null;
  isVerifiedAccount: boolean;
}) {
  const router = useRouter();
  const [legalName, setLegalName] = useState(request?.legalName ?? "");
  const [documentType, setDocumentType] = useState<VerificationDocumentType>(request?.documentType ?? "national_id");
  const [files, setFiles] = useState<FileSelection>({});
  const [feedback, setFeedback] = useState("");
  const [isPending, startTransition] = useTransition();
  const locked = isVerifiedAccount || (request ? ["pending", "under_review", "verified"].includes(request.status) : false);

  async function upload(kind: VerificationEvidenceKind, file: File) {
    const created = await createVerificationEvidenceUploadAction({
      legalName,
      documentType,
      countryCode: "GH",
      evidenceKind: kind,
      contentType: file.type,
      sizeBytes: file.size,
      fileName: file.name
    });
    if (!created.ok) throw new Error(created.message);
    const supabase = createSupabaseBrowserClient();
    const uploaded = await supabase.storage
      .from(VERIFICATION_BUCKET)
      .uploadToSignedUrl(created.intent.path, created.intent.token, file, { contentType: file.type, upsert: false });
    if (uploaded.error) throw new Error("The file could not be uploaded.");
    const finalized = await finalizeVerificationEvidenceAction({ evidenceId: created.intent.evidenceId });
    if (!finalized.ok) throw new Error(finalized.message);
    return created.intent.requestId;
  }

  function submit() {
    if (eligibilityMessage || locked) return;
    if (legalName.trim().length < 2) {
      setFeedback("Enter your full legal name.");
      return;
    }
    const existing = new Set(request?.evidenceKinds ?? []);
    if (!files.document_front && !existing.has("document_front")) {
      setFeedback("Choose the front of your ID.");
      return;
    }
    if (!files.selfie && !existing.has("selfie")) {
      setFeedback("Choose a clear selfie.");
      return;
    }

    startTransition(async () => {
      setFeedback("Uploading your evidence…");
      try {
        let requestId = request?.id ?? null;
        for (const kind of ["document_front", "document_back", "selfie"] as const) {
          const file = files[kind];
          if (file) requestId = await upload(kind, file);
        }
        if (!requestId) throw new Error("Add your evidence before submitting.");
        const result = await submitVerificationRequestAction({ requestId });
        setFeedback(result.message);
        if (result.ok) router.refresh();
      } catch (error) {
        setFeedback(error instanceof Error ? error.message : "The request could not be submitted.");
      }
    });
  }

  return (
    <div className="mr-auto max-w-[680px] space-y-6 pt-6">
      <SettingsSubHeader title="Account verification" description="Confirm your identity with Mad Buddy. This is separate from Trusted Member and paid Access." />

      {isVerifiedAccount && request?.status !== "verified" ? (
        <Card className="flex items-start gap-3 p-4">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-[#F97316]/10 text-[#EA580C]"><BadgeCheck className="h-5 w-5" aria-hidden="true" /></span>
          <div><p className="text-sm font-semibold">Verified</p><p className="mt-1 text-sm text-muted-foreground">Your Verified Account sign is active.</p></div>
        </Card>
      ) : request ? (
        <Card className="flex items-start gap-3 p-4">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-[#F97316]/10 text-[#EA580C]">
            {request.status === "verified" ? <BadgeCheck className="h-5 w-5" aria-hidden="true" /> : <FileCheck2 className="h-5 w-5" aria-hidden="true" />}
          </span>
          <div className="min-w-0">
            <p className="text-sm font-semibold">{STATUS_LABELS[request.status] ?? request.status}</p>
            {request.userMessage ? <p className="mt-1 text-sm text-muted-foreground">{request.userMessage}</p> : null}
            {request.submittedAt ? <p className="mt-1 text-xs text-muted-foreground">Submitted {new Date(request.submittedAt).toLocaleString()}</p> : null}
          </div>
        </Card>
      ) : null}

      {eligibilityMessage ? (
        <Card className="border-amber-500/30 bg-amber-500/10 p-4 text-sm">{eligibilityMessage} <Link href="/profile" className="font-semibold underline underline-offset-2">View your profile</Link></Card>
      ) : null}

      {!locked ? (
        <Card className="space-y-5 p-4 sm:p-5">
          <div className="flex items-start gap-3 rounded-xl bg-secondary/35 p-3">
            <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-[#E88C2B]" aria-hidden="true" />
            <p className="text-xs leading-5 text-muted-foreground">Your account must be at least 30 days old and your profile must show a clear photo of your face. Reviewers compare that photo with your selfie and ID. If they do not match, the application may be declined. Your documents remain private and are scheduled for deletion after the retention period.</p>
          </div>

          <label className="block space-y-1.5 text-sm font-medium">
            Full legal name
            <Input value={legalName} maxLength={120} disabled={Boolean(eligibilityMessage) || isPending} onChange={(event) => setLegalName(event.target.value)} />
          </label>

          <AppSelect
            label="Identification type"
            value={documentType}
            options={DOCUMENT_OPTIONS}
            disabled={Boolean(eligibilityMessage) || isPending}
            onChange={setDocumentType}
          />

          <EvidenceInput label="Front of ID" required kind="document_front" file={files.document_front} existing={request?.evidenceKinds.includes("document_front") ?? false} disabled={Boolean(eligibilityMessage) || isPending} onChange={(file) => setFiles((current) => ({ ...current, document_front: file }))} />
          <EvidenceInput label="Back of ID" kind="document_back" file={files.document_back} existing={request?.evidenceKinds.includes("document_back") ?? false} disabled={Boolean(eligibilityMessage) || isPending} onChange={(file) => setFiles((current) => ({ ...current, document_back: file }))} />
          <EvidenceInput label="Clear selfie" required kind="selfie" file={files.selfie} existing={request?.evidenceKinds.includes("selfie") ?? false} disabled={Boolean(eligibilityMessage) || isPending} onChange={(file) => setFiles((current) => ({ ...current, selfie: file }))} />

          {feedback ? <p className="text-sm text-muted-foreground" role="status">{feedback}</p> : null}
          <Button type="button" className="w-full" disabled={Boolean(eligibilityMessage) || isPending} onClick={submit}>
            {isPending ? <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" /> : null}
            Submit for verification
          </Button>
        </Card>
      ) : null}
    </div>
  );
}

function EvidenceInput({
  label,
  required = false,
  kind,
  file,
  existing,
  disabled,
  onChange
}: {
  label: string;
  required?: boolean;
  kind: VerificationEvidenceKind;
  file?: File;
  existing: boolean;
  disabled: boolean;
  onChange: (file: File | undefined) => void;
}) {
  return (
    <label className="block space-y-1.5 text-sm font-medium" htmlFor={`verification-${kind}`}>
      {label}{required ? " *" : ""}
      <Input
        id={`verification-${kind}`}
        type="file"
        accept="image/jpeg,image/png,image/webp,application/pdf"
        disabled={disabled}
        onChange={(event) => onChange(event.target.files?.[0])}
      />
      <span className="block text-xs font-normal text-muted-foreground">
        {file ? file.name : existing ? "Already uploaded. Choose another file to replace it." : "JPG, PNG, WebP or PDF. Maximum 10 MB."}
      </span>
    </label>
  );
}
