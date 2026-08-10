"use client";

import { Loader2 } from "lucide-react";
import { useState, useTransition } from "react";

import { decideAccountVerificationAction } from "@/app/(admin)/admin/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { VerificationStatus } from "@/lib/trust/verified-account";

/**
 * Verify, revoke or fail one account.
 *
 * Two steps, not one. A single-tap Verify on a queue of rows is one mis-tap
 * away from putting an identity badge on an account nobody reviewed -- and the
 * badge is the one signal in the product that claims Mad Buddy itself checked
 * something.
 *
 * The evidence field appears only for approval, and is required there. Staff
 * need to know WHY an account carries the badge; revoking and failing are
 * corrections and speak for themselves. It takes a short label ("passport,
 * matched selfie"), never the evidence itself -- documents must not live on a
 * row any reviewer can browse.
 */

type Pending = "verified" | "revoked" | "failed" | null;

export function VerificationControls({
  userId,
  status
}: {
  userId: string;
  /** The current record, or null when this account has never been reviewed. */
  status: VerificationStatus | null;
}) {
  const [pending, setPending] = useState<Pending>(null);
  const [evidenceLabel, setEvidenceLabel] = useState("");
  const [feedback, setFeedback] = useState("");
  const [isPending, startTransition] = useTransition();

  const isVerified = status === "verified";

  function submit(decision: Exclude<Pending, null>) {
    startTransition(async () => {
      const result = await decideAccountVerificationAction({
        userId,
        decision,
        evidenceLabel: decision === "verified" ? evidenceLabel.trim() : undefined
      });
      setFeedback(result.message);
      if (result.ok) {
        setPending(null);
        setEvidenceLabel("");
      }
    });
  }

  if (pending) {
    return (
      <div className="flex flex-col gap-2">
        {pending === "verified" ? (
          <Input
            value={evidenceLabel}
            onChange={(event) => setEvidenceLabel(event.target.value)}
            maxLength={120}
            placeholder="What was checked? e.g. passport, matched selfie"
            aria-label="What was checked"
            className="h-9 text-sm"
          />
        ) : null}

        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            size="sm"
            variant={pending === "verified" ? "primary" : "danger"}
            disabled={isPending || (pending === "verified" && evidenceLabel.trim().length < 3)}
            onClick={() => submit(pending)}
          >
            {isPending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" aria-hidden="true" />
            ) : null}
            Confirm {pending === "verified" ? "verify" : pending}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={isPending}
            onClick={() => {
              setPending(null);
              setEvidenceLabel("");
            }}
          >
            Cancel
          </Button>
        </div>

        {feedback ? <p className="text-xs text-muted-foreground">{feedback}</p> : null}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-2">
        {/* Verify is offered unless this account already holds it -- a repeat
            approval would only rewrite the same row. */}
        {isVerified ? null : (
          <Button type="button" size="sm" onClick={() => setPending("verified")}>
            Verify
          </Button>
        )}
        {isVerified ? (
          <Button type="button" size="sm" variant="danger" onClick={() => setPending("revoked")}>
            Revoke
          </Button>
        ) : null}
        <Button type="button" size="sm" variant="outline" onClick={() => setPending("failed")}>
          Mark failed
        </Button>
      </div>

      {feedback ? <p className="text-xs text-muted-foreground">{feedback}</p> : null}
    </div>
  );
}
