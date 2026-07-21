"use client";

import { UserPlus, X } from "lucide-react";
import { useEffect, useRef, useState, useTransition } from "react";
import { acceptInviteAction, resolveInviteAction, type InvitePreview } from "@/app/(app)/invite-actions";
import { Button } from "@/components/ui/button";
import { UserAvatar } from "@/components/ui/user-avatar";
import { clearPendingInviteCookie, readPendingInviteCookie } from "@/lib/discovery/pending-invite";

/**
 * After a new account finishes signing up, if they arrived from an invite we
 * offer to connect them with the inviter. The invite token is re-validated
 * server-side; a stale, expired, or self-invite simply shows nothing. Connecting
 * sends the inviter a request (consent still runs both ways), matching the
 * normal invite-accept behaviour.
 */
export function PendingInvitePrompt() {
  // The token lives in a ref, not state, so reading the cookie in the effect
  // doesn't trigger a synchronous re-render; only the resolved preview renders.
  const tokenRef = useRef<string | null>(null);
  const [preview, setPreview] = useState<InvitePreview | null>(null);
  const [outcome, setOutcome] = useState<string | null>(null);
  const [pending, start] = useTransition();

  useEffect(() => {
    const stored = readPendingInviteCookie();
    if (!stored) return;
    tokenRef.current = stored;
    resolveInviteAction(stored)
      .then((result) => {
        if (result && result.valid) setPreview(result);
        else clearPendingInviteCookie(); // stale/invalid → forget it silently
      })
      .catch(() => {});
  }, []);

  if (!preview) return null;

  function connect() {
    const token = tokenRef.current;
    if (!token) return;
    start(async () => {
      const result = await acceptInviteAction(token);
      setOutcome(result.message);
      clearPendingInviteCookie();
    });
  }

  function dismiss() {
    clearPendingInviteCookie();
    setPreview(null);
  }

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-primary/25 bg-primary/[0.06] p-4">
      <UserAvatar src={preview.inviterAvatarUrl} name={preview.inviterName} size="sm" />
      <div className="min-w-0 flex-1">
        {outcome ? (
          <p className="text-sm font-medium" role="status">{outcome}</p>
        ) : (
          <>
            <p className="text-sm font-semibold">
              <span className="text-primary">{preview.inviterName}</span> invited you to Mad Buddy
            </p>
            <p className="mt-0.5 text-xs text-muted-foreground">Connect to send them a request.</p>
          </>
        )}
      </div>
      {outcome ? null : (
        <div className="flex shrink-0 items-center gap-2">
          <Button type="button" size="sm" onClick={connect} disabled={pending}>
            <UserPlus className="h-4 w-4" aria-hidden="true" />
            Connect
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={dismiss} disabled={pending} aria-label="Dismiss invite">
            <X className="h-4 w-4" aria-hidden="true" />
          </Button>
        </div>
      )}
    </div>
  );
}
