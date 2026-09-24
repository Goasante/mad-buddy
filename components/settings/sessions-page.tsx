"use client";

import { Laptop, Loader2, Smartphone } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { revokeOtherSessionsAction } from "@/app/(app)/settings-actions";
import { useSecureLogout } from "@/components/auth/use-secure-logout";
import { SettingsSubHeader } from "@/components/settings/settings-sub-header";
import { Button } from "@/components/ui/button";

export type AccountSessionView = {
  id: string;
  label: string;
  createdAt: string;
  lastSeenAt: string;
  expiresAt: string | null;
  current: boolean;
};

function sessionActivityLabel(session: AccountSessionView) {
  if (session.current) return "Active now";
  const value = new Date(session.lastSeenAt);
  return Number.isNaN(value.getTime()) ? "Previously active" : `Last active ${value.toLocaleString()}`;
}

export function SessionsPage({ sessions }: { sessions: AccountSessionView[] }) {
  const [feedback, setFeedback] = useState("");
  const [isPending, startTransition] = useTransition();
  const { logout, isPending: logoutPending } = useSecureLogout();
  const router = useRouter();
  const otherSessionCount = sessions.filter((session) => !session.current).length;

  return (
    <div className="mr-auto max-w-[640px] space-y-6 pt-6">
      <SettingsSubHeader title="Sessions" description="Review every device signed in to your account." />
      <section className="overflow-hidden rounded-xl border border-border/70" aria-labelledby="active-sessions-title">
        <h2 id="active-sessions-title" className="sr-only">Active sessions</h2>
        {sessions.length === 0 ? (
          <p className="px-4 py-5 text-sm text-muted-foreground">No active sessions could be loaded.</p>
        ) : (
          sessions.map((session, index) => {
            const Icon = /Android|iPhone|iPad/i.test(session.label) ? Smartphone : Laptop;
            return (
              <div key={session.id} className={`flex items-start gap-3 px-4 py-4 ${index > 0 ? "border-t border-border/70" : ""}`}>
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-secondary text-muted-foreground">
                  <Icon className="h-4 w-4" aria-hidden="true" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{session.label}{session.current ? " · This device" : ""}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">{sessionActivityLabel(session)}</p>
                  <p className="mt-0.5 text-[11px] text-muted-foreground">Signed in {new Date(session.createdAt).toLocaleString()}</p>
                </div>
                {session.current ? <span className="shrink-0 text-xs font-medium text-emerald-600 dark:text-emerald-400">Current</span> : null}
              </div>
            );
          })
        )}
      </section>
      {feedback ? <p className="text-sm text-muted-foreground" role="status">{feedback}</p> : null}
      <div className="space-y-3">
        <Button
          type="button"
          variant="outline"
          className="w-full"
          disabled={isPending || otherSessionCount === 0}
          onClick={() => startTransition(async () => {
            const result = await revokeOtherSessionsAction();
            setFeedback(result.message);
            if (result.ok) router.refresh();
          })}
        >
          {isPending ? <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" /> : null}
          {otherSessionCount > 0 ? `Log out ${otherSessionCount === 1 ? "other session" : `all ${otherSessionCount} other sessions`}` : "No other sessions"}
        </Button>
        <Button type="button" variant="danger" className="w-full" disabled={logoutPending} onClick={logout}>
          {logoutPending ? <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" /> : null}
          Log out of this account
        </Button>
      </div>
    </div>
  );
}
