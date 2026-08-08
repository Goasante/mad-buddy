"use client";

import { useState, useTransition } from "react";
import { Loader2 } from "lucide-react";

import { decideTrustedMemberAction } from "@/app/(admin)/admin/actions";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import type { TrustedMemberStatus } from "@/lib/trust/trusted-member";

/**
 * Approve, decline or revoke one application.
 *
 * The note field appears only for the decisions that require it. Showing an
 * always-present box would suggest an approval also wants an explanation, and
 * the asymmetry is deliberate: staff need to know why somebody was turned
 * down, especially before a second application, while an approval speaks for
 * itself.
 *
 * The reviewer picks the decision first, then confirms. A single-tap approve
 * on a queue of rows is one mis-tap away from granting standing nobody
 * reviewed.
 */

type Pending = "approved" | "declined" | "revoked" | null;

export function TrustedMemberControls({
  applicationId,
  status,
  hasBadge
}: {
  applicationId: string;
  status: TrustedMemberStatus;
  /** Whether this account currently holds the badge, whatever the row says. */
  hasBadge: boolean;
}) {
  const [pending, setPending] = useState<Pending>(null);
  const [note, setNote] = useState("");
  const [feedback, setFeedback] = useState("");
  const [isPending, startTransition] = useTransition();

  function submit(decision: Exclude<Pending, null>) {
    startTransition(async () => {
      const result = await decideTrustedMemberAction({
        applicationId,
        decision,
        reviewNote: note.trim() || undefined
      });
      setFeedback(result.message);
      if (result.ok) {
        setPending(null);
        setNote("");
      }
    });
  }

  // A decision needs confirming, and declines and revocations need a note
  // before the confirm button does anything.
  if (pending) {
    const needsNote = pending !== "approved";
    const ready = !needsNote || note.trim().length >= 3;

    return (
      <div className="flex w-full flex-col gap-2">
        <p className="text-xs font-medium capitalize">{pending}?</p>
        {needsNote ? (
          <Textarea
            value={note}
            onChange={(event) => setNote(event.target.value)}
            maxLength={500}
            rows={2}
            placeholder="Why? Staff only — the applicant never sees this."
            aria-label="Review note"
          />
        ) : null}
        <div className="flex gap-2">
          <Button
            type="button"
            size="sm"
            onClick={() => submit(pending)}
            disabled={isPending || !ready}
          >
            {isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" aria-hidden="true" /> : null}
            Confirm
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={() => setPending(null)} disabled={isPending}>
            Cancel
          </Button>
        </div>
        {feedback ? <p className="text-xs text-muted-foreground">{feedback}</p> : null}
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {/* A pending application can go either way. */}
      {status === "pending" ? (
        <>
          <Button type="button" size="sm" onClick={() => setPending("approved")} disabled={isPending}>
            Approve
          </Button>
          <Button type="button" size="sm" variant="outline" onClick={() => setPending("declined")} disabled={isPending}>
            Decline
          </Button>
        </>
      ) : null}

      {/* Revoking is offered whenever the badge is actually held, not merely
          when the row says approved — those can diverge if a badge was
          removed by another route, and the control should follow the truth. */}
      {hasBadge ? (
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="border-red-400/40 text-red-500"
          onClick={() => setPending("revoked")}
          disabled={isPending}
        >
          Revoke
        </Button>
      ) : null}

      {/* A decided application with no badge has nothing left to do here; the
          applicant may re-apply, which returns it to pending. */}
      {status !== "pending" && !hasBadge ? (
        <p className="text-xs text-muted-foreground">No action available.</p>
      ) : null}

      {feedback ? <p className="w-full text-xs text-muted-foreground">{feedback}</p> : null}
    </div>
  );
}
