"use client";

import { Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { decideAccountVerificationAction, grantAccountVerificationAction } from "@/app/(admin)/admin/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { VerificationStatus } from "@/lib/trust/verified-account";

/**
 * Correct or revoke a result; owners and admins may make an explicit grant.
 */

type Pending = "revoked" | "failed" | "grant" | null;

export function VerificationControls({
  userId,
  status,
  allowDiscretionaryGrant = false
}: {
  userId: string;
  /** The current record, or null when this account has never been reviewed. */
  status: VerificationStatus | null;
  allowDiscretionaryGrant?: boolean;
}) {
  const router = useRouter();
  const [pending, setPending] = useState<Pending>(null);
  const [feedback, setFeedback] = useState("");
  const [reason, setReason] = useState("");
  const [isPending, startTransition] = useTransition();

  const isVerified = status === "verified";

  function submit(decision: Exclude<Pending, null>) {
    startTransition(async () => {
      const result = decision === "grant"
        ? await grantAccountVerificationAction({ userId, reason: reason.trim() })
        : await decideAccountVerificationAction({ userId, decision });
      setFeedback(result.message);
      if (result.ok) {
        setPending(null);
        setReason("");
        router.refresh();
      }
    });
  }

  if (pending) {
    return (
      <div className="flex flex-col gap-2">
        {pending === "grant" ? (
          <Input value={reason} onChange={(event) => setReason(event.target.value)} maxLength={300} placeholder="Reason for discretionary grant (required)" aria-label="Reason for discretionary grant" disabled={isPending} />
        ) : null}
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            size="sm"
            variant="danger"
            disabled={isPending || (pending === "grant" && reason.trim().length < 3)}
            onClick={() => submit(pending)}
          >
            {isPending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" aria-hidden="true" />
            ) : null}
            {pending === "grant" ? "Confirm grant" : `Confirm ${pending}`}
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
        {!isVerified && allowDiscretionaryGrant ? <Button type="button" size="sm" variant="outline" onClick={() => setPending("grant")}>Grant verification</Button> : null}
      </div>

      {feedback ? <p className="text-xs text-muted-foreground">{feedback}</p> : null}
    </div>
  );
}
