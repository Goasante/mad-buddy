"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { acceptInviteAction } from "@/app/(app)/invite-actions";
import { Button } from "@/components/ui/button";

/**
 * Accepts a personal invite. If the visitor isn't logged in, the action tells
 * them to log in and we send them to /login with a return path, so the invite
 * survives account creation (spec §21, §29).
 */
export function AcceptInviteButton({ token, inviterName }: { token: string; inviterName: string }) {
  const router = useRouter();
  const [message, setMessage] = useState("");
  const [done, setDone] = useState(false);
  const [isPending, startTransition] = useTransition();

  function accept() {
    startTransition(async () => {
      const result = await acceptInviteAction(token);
      setMessage(result.message);
      if (result.ok) {
        setDone(true);
        return;
      }
      if (/log in/i.test(result.message)) {
        router.push(`/login?next=${encodeURIComponent(`/invite/${token}`)}`);
      }
    });
  }

  if (done) {
    return (
      <p className="text-sm font-medium text-primary" role="status">
        {message}
      </p>
    );
  }

  return (
    <div className="space-y-2">
      <Button type="button" onClick={accept} disabled={isPending} className="w-full">
        Connect with {inviterName}
      </Button>
      {message ? (
        <p className="text-xs text-muted-foreground" role="status">
          {message}
        </p>
      ) : null}
    </div>
  );
}
