"use client";

import { CheckCircle2, LoaderCircle, RotateCcw, XCircle } from "lucide-react";
import { useState, useTransition } from "react";
import { reviewLinkrPassReversalAction } from "@/app/(admin)/admin/support/linkr-reversal-actions";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

export function LinkrReversalReview({
  ticketId,
  targetName,
  targetUsername,
  passExpiresAt,
  reviewed
}: {
  ticketId: string;
  targetName: string;
  targetUsername: string | null;
  passExpiresAt: string | null;
  reviewed: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [feedback, setFeedback] = useState("");
  const [isReviewed, setIsReviewed] = useState(reviewed);

  function review(decision: "approve" | "reject") {
    setFeedback("");
    startTransition(async () => {
      const result = await reviewLinkrPassReversalAction({ ticketId, decision });
      setFeedback(result.message);
      if (result.ok) setIsReviewed(true);
    });
  }

  return (
    <Card className="border-[#E88C2B]/25 bg-[#E88C2B]/[0.05] p-4 sm:p-5">
      <div className="flex items-start gap-3">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-[#E88C2B]/15 text-[#E88C2B]">
          <RotateCcw className="h-5 w-5" aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">Linkr rewind request</p>
          <p className="mt-1 text-sm leading-6 text-muted-foreground">
            The user has used their self-service rewinds and is asking to restore a profile they skipped. Approval only removes the canonical temporary Linkr pass; it never creates a connection, a Muddy friendship, or reveals whether the other person clicked.
          </p>
          <div className="mt-3 rounded-xl border border-border/70 bg-card/70 px-3 py-2.5 text-sm">
            <p className="font-medium">{targetName}</p>
            {targetUsername ? <p className="text-xs text-muted-foreground">@{targetUsername}</p> : null}
            <p className="mt-1 text-xs text-muted-foreground">
              {passExpiresAt
                ? `Current pass expires ${new Date(passExpiresAt).toLocaleString()}`
                : "The pass is no longer active."}
            </p>
          </div>

          {!isReviewed ? (
            <div className="mt-4 flex flex-wrap gap-2">
              <Button type="button" size="sm" disabled={pending} onClick={() => review("approve")}>
                {pending ? <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" /> : <CheckCircle2 className="h-4 w-4" aria-hidden="true" />}
                Approve rewind
              </Button>
              <Button type="button" size="sm" variant="outline" disabled={pending} onClick={() => review("reject")}>
                <XCircle className="h-4 w-4" aria-hidden="true" />
                Reject
              </Button>
            </div>
          ) : (
            <p className="mt-3 text-xs font-medium text-muted-foreground">This rewind request has already been reviewed.</p>
          )}

          {feedback ? <p className="mt-3 text-xs text-muted-foreground" role="status">{feedback}</p> : null}
        </div>
      </div>
    </Card>
  );
}
