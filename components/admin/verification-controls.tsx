"use client";

import { Loader2 } from "lucide-react";
import { useState, useTransition } from "react";

import { decideAccountVerificationAction } from "@/app/(admin)/admin/actions";
import { Button } from "@/components/ui/button";
import type { VerificationStatus } from "@/lib/trust/verified-account";

/**
 * Correct or revoke an existing verification result. New approvals only occur
 * in the application queue after validated evidence has been reviewed.
 */

type Pending = "revoked" | "failed" | null;

export function VerificationControls({
  userId,
  status
}: {
  userId: string;
  /** The current record, or null when this account has never been reviewed. */
  status: VerificationStatus | null;
}) {
  const [pending, setPending] = useState<Pending>(null);
  const [feedback, setFeedback] = useState("");
  const [isPending, startTransition] = useTransition();

  const isVerified = status === "verified";

  function submit(decision: Exclude<Pending, null>) {
    startTransition(async () => {
      const result = await decideAccountVerificationAction({
        userId,
        decision,
        evidenceLabel: undefined
      });
      setFeedback(result.message);
      if (result.ok) {
        setPending(null);
      }
    });
  }

  if (pending) {
    return (
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            size="sm"
            variant="danger"
            disabled={isPending}
            onClick={() => submit(pending)}
          >
            {isPending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" aria-hidden="true" />
            ) : null}
            Confirm {pending}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={isPending}
            onClick={() => {
              setPending(null);
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
        {isVerified ? (
          <Button type="button" size="sm" variant="danger" onClick={() => setPending("revoked")}>
            Revoke
          </Button>
        ) : null}
        {!isVerified && status === "pending" ? <Button type="button" size="sm" variant="outline" onClick={() => setPending("failed")}>Mark failed</Button> : null}
      </div>

      {feedback ? <p className="text-xs text-muted-foreground">{feedback}</p> : null}
    </div>
  );
}
