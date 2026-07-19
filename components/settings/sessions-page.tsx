"use client";

import { Laptop, Loader2 } from "lucide-react";
import { useState, useTransition } from "react";
import { logoutAction } from "@/app/(auth)/actions";
import { revokeOtherSessionsAction } from "@/app/(app)/settings-actions";
import { Button } from "@/components/ui/button";
import { SettingsSubHeader } from "@/components/settings/settings-sub-header";

export function SessionsPage({ deviceLabel, signedInAt }: { deviceLabel: string; signedInAt: string | null }) {
  const [feedback, setFeedback] = useState("");
  const [isPending, startTransition] = useTransition();
  return (
    <div className="mr-auto max-w-[640px] space-y-6 pt-6">
      <SettingsSubHeader title="Sessions" description="Review this session or log out other active sessions." />
      <section className="rounded-xl border border-border/70" aria-labelledby="current-session-title">
        <div className="flex items-center gap-3 px-4 py-4">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-secondary text-muted-foreground">
            <Laptop className="h-4 w-4" aria-hidden="true" />
          </span>
          <div className="min-w-0 flex-1">
            <p id="current-session-title" className="truncate text-sm font-medium">{deviceLabel}</p>
            <p className="text-xs text-muted-foreground">
              {signedInAt ? `Signed in ${new Date(signedInAt).toLocaleString()}` : "Current browser session"}
            </p>
          </div>
          <span className="text-xs font-medium text-emerald-600 dark:text-emerald-400">Active now</span>
        </div>
      </section>
      {feedback ? <p className="text-sm text-muted-foreground" role="status">{feedback}</p> : null}
      <div className="space-y-3">
        <Button type="button" variant="outline" className="w-full" disabled={isPending} onClick={() => startTransition(async () => {
          const result = await revokeOtherSessionsAction();
          setFeedback(result.message);
        })}>
          {isPending ? <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" /> : null}
          Log out all other sessions
        </Button>
        <form action={logoutAction}>
          <Button type="submit" variant="danger" className="w-full">Log out of this account</Button>
        </form>
      </div>
    </div>
  );
}
