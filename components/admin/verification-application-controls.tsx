"use client";

import { ExternalLink, Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { openVerificationEvidenceAction, reviewVerificationRequestAction } from "@/app/(admin)/admin/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { UserAvatar } from "@/components/ui/user-avatar";
import type { VerificationApplicationEntry } from "@/lib/trust/verification-review";

export function VerificationApplicationControls({ application }: { application: VerificationApplicationEntry }) {
  const router = useRouter();
  const [note, setNote] = useState("");
  const [feedback, setFeedback] = useState("");
  const [preview, setPreview] = useState<{ id: string; url: string } | null>(null);
  const [profileMatchConfirmed, setProfileMatchConfirmed] = useState(false);
  const [pending, startTransition] = useTransition();

  function decide(decision: "under_review" | "more_information_required" | "verified" | "declined") {
    startTransition(async () => {
      const result = await reviewVerificationRequestAction({ requestId: application.requestId, decision, note: note.trim() || undefined, profileMatchConfirmed: decision === "verified" && profileMatchConfirmed, reviewedProfilePhotoUrl: decision === "verified" ? application.avatarUrl : undefined });
      setFeedback(result.message);
      if (result.ok) {
        setNote("");
        // Server revalidation invalidates the route, while refresh replaces
        // the already-mounted admin view so an approval is visible now.
        router.refresh();
      }
    });
  }

  function openEvidence(item: VerificationApplicationEntry["evidence"][number]) {
    const isImage = item.contentType.startsWith("image/");
    // Open synchronously so browser popup blockers recognise the user's click.
    // Sever the opener immediately before navigating to the short-lived URL.
    const popup = isImage ? null : window.open("about:blank", "_blank");
    if (popup) popup.opener = null;
    startTransition(async () => {
      const result = await openVerificationEvidenceAction({
        requestId: application.requestId,
        evidenceId: item.id,
        reason: "Identity verification review"
      });
      setFeedback(result.message);
      if (result.ok && result.url) {
        if (isImage) setPreview({ id: item.id, url: result.url });
        else if (popup) popup.location.href = result.url;
        else window.open(result.url, "_blank", "noopener,noreferrer");
      } else {
        popup?.close();
      }
    });
  }

  return (
    <div className="mt-3 space-y-3 border-t border-border/60 pt-3">
      <div className="grid gap-4 rounded-xl border border-border/70 p-3 sm:grid-cols-2">
        <div className="space-y-2">
          <p className="text-xs font-semibold">Current profile</p>
          <UserAvatar src={application.avatarUrl} name={application.displayName} size="profile" />
          <p className="text-sm font-semibold">{application.displayName} · @{application.username}</p>
          {application.profileBio ? <p className="text-xs text-muted-foreground">{application.profileBio}</p> : null}
          {!application.avatarUrl ? <p className="text-xs text-destructive">No profile photo. Ask the applicant to add a clear face photo.</p> : null}
        </div>
        <div className="space-y-2">
          <p className="text-xs font-semibold">Private identity evidence</p>
          {preview ? (
            // Signed evidence links expire after five minutes and are only fetched after an audited reviewer action.
            // eslint-disable-next-line @next/next/no-img-element
            <img key={preview.id} src={preview.url} alt={`Identity evidence: ${application.evidence.find((item) => item.id === preview.id)?.kind.replaceAll("_", " ") ?? "document"}`} className="max-h-72 w-full rounded-lg border border-border/70 bg-secondary/30 object-contain" />
          ) : <p className="text-xs text-muted-foreground">Open the ID and selfie to compare them with the current profile photo.</p>}
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        {application.evidence.map((item) => (
          <Button key={item.id} type="button" size="sm" variant="outline" disabled={pending} onClick={() => openEvidence(item)}>
            <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
            {item.kind.replaceAll("_", " ")}{preview?.id === item.id ? " (shown)" : ""}
          </Button>
        ))}
      </div>
      <label className="flex items-start gap-2 text-xs leading-relaxed">
        <input type="checkbox" className="mt-0.5 accent-primary" checked={profileMatchConfirmed} onChange={(event) => setProfileMatchConfirmed(event.target.checked)} disabled={pending || !application.avatarUrl} />
        I compared the current profile photo, ID and selfie, and they show the same person.
      </label>
      <Input value={note} onChange={(event) => setNote(event.target.value)} maxLength={1000} placeholder="User-facing review note when needed" disabled={pending} />
      <div className="flex flex-wrap gap-2">
        {application.status !== "under_review" ? <Button type="button" size="sm" variant="outline" disabled={pending} onClick={() => decide("under_review")}>Start review</Button> : null}
        <Button type="button" size="sm" disabled={pending || !profileMatchConfirmed || !application.avatarUrl} onClick={() => decide("verified")}>Verify</Button>
        <Button type="button" size="sm" variant="outline" disabled={pending || note.trim().length < 3} onClick={() => decide("more_information_required")}>Request information</Button>
        <Button type="button" size="sm" variant="danger" disabled={pending || note.trim().length < 3} onClick={() => decide("declined")}>Decline</Button>
      </div>
      {pending ? <p className="flex items-center gap-2 text-xs text-muted-foreground"><Loader2 className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" /> Saving…</p> : null}
      {feedback ? <p className="text-xs text-muted-foreground" role="status">{feedback}</p> : null}
    </div>
  );
}
