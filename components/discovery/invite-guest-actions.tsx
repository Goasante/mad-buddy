"use client";

import Link from "next/link";
import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { setPendingInviteCookie } from "@/lib/discovery/pending-invite";

/**
 * Shown on the invite landing page to a logged-out visitor. It remembers the
 * invite (so it survives account creation) and points new people at sign up and
 * returning people at log in. After they finish, the connect prompt on the
 * dashboard offers to connect them with the inviter.
 */
export function InviteGuestActions({ token, inviterName }: { token: string; inviterName: string }) {
  useEffect(() => {
    setPendingInviteCookie(token);
  }, [token]);

  return (
    <div className="space-y-3">
      <Button asChild className="w-full">
        <Link href="/signup">Create an account to connect</Link>
      </Button>
      <Button asChild variant="outline" className="w-full">
        <Link href={`/login?next=${encodeURIComponent(`/invite/${token}`)}`}>I already have an account</Link>
      </Button>
      <p className="text-xs text-muted-foreground">
        New to Mad Buddy? Sign up and we’ll help you connect with {inviterName} right after.
      </p>
    </div>
  );
}
