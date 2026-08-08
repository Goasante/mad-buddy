"use client";

import { Loader2, ShieldCheck } from "lucide-react";
import { useState, useTransition } from "react";

import { applyForTrustedMemberAction } from "@/app/(app)/trusted-member-actions";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { trustedMemberStatusMessage, type TrustedMemberStatus } from "@/lib/trust/trusted-member";

/**
 * Applying to be a Trusted Member, on your own profile.
 *
 * The card is honest in both directions: someone who cannot apply is told
 * exactly what is missing rather than shown a disabled button with no
 * explanation, and someone who has applied is told where they stand without
 * being given the reviewer's reasoning.
 *
 * It never uses the word "Verified". The badge recognises standing, not
 * identity, and copy that blurred the two would undo the reason it is named
 * the way it is.
 */

export function TrustedMemberApplyCard({
  standing,
  trustedSince
}: {
  standing?: {
    eligible: boolean;
    premiumDays: number;
    journeysComplete: number;
    missing: string[];
    status: TrustedMemberStatus | null;
    canApply: boolean;
  } | null;
  trustedSince?: string | null;
}) {
  const [note, setNote] = useState("");
  const [open, setOpen] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [isPending, startTransition] = useTransition();

  // No standing means the server could not read it — most often a signed-out
  // render. Nothing useful to say, so nothing is shown.
  if (!standing) return null;

  function submit() {
    startTransition(async () => {
      const result = await applyForTrustedMemberAction({ note: note.trim() || undefined });
      setFeedback(result.message);
      if (result.ok) {
        setOpen(false);
        setNote("");
      }
    });
  }

  // Already a Trusted Member: a quiet confirmation, not a call to action.
  if (trustedSince) {
    return (
      <div className="trusted-apply trusted-apply-held">
        <ShieldCheck className="h-5 w-5 shrink-0" aria-hidden="true" />
        <div className="min-w-0">
          <p className="trusted-apply-title">You&rsquo;re a Trusted Member</p>
          <p className="trusted-apply-copy">
            Recognised for your time here and everything you&rsquo;ve completed.
          </p>
        </div>
      </div>
    );
  }

  const statusMessage = trustedMemberStatusMessage(standing.status);

  return (
    <div className="trusted-apply">
      <div className="flex items-start gap-3">
        <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <p className="trusted-apply-title">Trusted Member</p>
          <p className="trusted-apply-copy">
            {/* States what the badge is FOR, so nobody reads it as a tick
                confirming who they are. */}
            A mark for long-standing members who have completed everything. It
            recognises your standing here — it isn&rsquo;t an identity check.
          </p>

          {/* Where they stand. A pending or decided application takes
              precedence over the eligibility list: they have already asked. */}
          {statusMessage ? (
            <p className="trusted-apply-status">{statusMessage}</p>
          ) : standing.missing.length > 0 ? (
            <p className="trusted-apply-status">
              {/* Exactly what is missing, rather than a disabled button that
                  explains nothing. */}
              Still needed: {standing.missing.join(" and ")}.
            </p>
          ) : null}
        </div>
      </div>

      {standing.canApply ? (
        open ? (
          <div className="mt-3 flex flex-col gap-2">
            <Textarea
              value={note}
              onChange={(event) => setNote(event.target.value)}
              maxLength={500}
              rows={3}
              placeholder="Anything you'd like the team to know? (optional)"
              aria-label="Application note"
            />
            <div className="flex gap-2">
              <Button type="button" size="sm" onClick={submit} disabled={isPending}>
                {isPending ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" aria-hidden="true" />
                ) : null}
                Send application
              </Button>
              <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)} disabled={isPending}>
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <Button type="button" size="sm" variant="outline" className="mt-3" onClick={() => setOpen(true)}>
            Apply
          </Button>
        )
      ) : null}

      {feedback ? <p className="trusted-apply-status">{feedback}</p> : null}
    </div>
  );
}
