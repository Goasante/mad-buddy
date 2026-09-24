"use client";

import { ExternalLink, Loader2 } from "lucide-react";
import { useState, useTransition } from "react";

import { openVerificationEvidenceAction, reviewVerificationRequestAction } from "@/app/(admin)/admin/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { VerificationApplicationEntry } from "@/lib/trust/verification-review";

export function VerificationApplicationControls({ application }: { application: VerificationApplicationEntry }) {
  const [note, setNote] = useState("");
  const [feedback, setFeedback] = useState("");
  const [pending, startTransition] = useTransition();

  function decide(decision: "under_review" | "more_information_required" | "verified" | "declined") {
    startTransition(async () => {
      const result = await reviewVerificationRequestAction({ requestId: application.requestId, decision, note: note.trim() || undefined });
      setFeedback(result.message);
      if (result.ok) setNote("");
    });
  }

  function openEvidence(evidenceId: string) {
    // Open synchronously so browser popup blockers recognise the user's click.
    // Sever the opener immediately before navigating to the short-lived URL.
    const popup = window.open("about:blank", "_blank");
    if (popup) popup.opener = null;
    startTransition(async () => {
      const result = await openVerificationEvidenceAction({
        requestId: application.requestId,
        evidenceId,
        reason: "Identity verification review"
      });
      setFeedback(result.message);
      if (result.ok && result.url) {
        if (popup) popup.location.href = result.url;
        else window.open(result.url, "_blank", "noopener,noreferrer");
      } else {
        popup?.close();
      }
    });
  }

  return (
    <div className="mt-3 space-y-3 border-t border-border/60 pt-3">
      <div className="flex flex-wrap gap-2">
        {application.evidence.map((item) => (
          <Button key={item.id} type="button" size="sm" variant="outline" disabled={pending} onClick={() => openEvidence(item.id)}>
            <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
            {item.kind.replaceAll("_", " ")}
          </Button>
        ))}
      </div>
      <Input value={note} onChange={(event) => setNote(event.target.value)} maxLength={1000} placeholder="User-facing review note when needed" disabled={pending} />
      <div className="flex flex-wrap gap-2">
        {application.status !== "under_review" ? <Button type="button" size="sm" variant="outline" disabled={pending} onClick={() => decide("under_review")}>Start review</Button> : null}
        <Button type="button" size="sm" disabled={pending} onClick={() => decide("verified")}>Verify</Button>
        <Button type="button" size="sm" variant="outline" disabled={pending || note.trim().length < 3} onClick={() => decide("more_information_required")}>Request information</Button>
        <Button type="button" size="sm" variant="danger" disabled={pending || note.trim().length < 3} onClick={() => decide("declined")}>Decline</Button>
      </div>
      {pending ? <p className="flex items-center gap-2 text-xs text-muted-foreground"><Loader2 className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" /> Saving…</p> : null}
      {feedback ? <p className="text-xs text-muted-foreground" role="status">{feedback}</p> : null}
    </div>
  );
}
