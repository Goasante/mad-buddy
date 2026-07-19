"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Inbox, Loader2, Users2 } from "lucide-react";
import { useState, useTransition } from "react";
import { respondToGroupInvitationAction } from "@/app/(app)/group-actions";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import type { GroupInvitation } from "@/lib/groups/types";

export function InvitesPageContent({ initialInvitations }: { initialInvitations: GroupInvitation[] }) {
  const router = useRouter();
  const [invitations, setInvitations] = useState(initialInvitations);
  const [feedback, setFeedback] = useState("");
  const [isPending, startTransition] = useTransition();
  function respond(invitation: GroupInvitation, accept: boolean) {
    startTransition(async () => {
      const result = await respondToGroupInvitationAction({ groupId: invitation.id, accept });
      setFeedback(result.message);
      if (!result.ok) return;
      setInvitations((current) => current.filter((item) => item.id !== invitation.id));
      router.refresh();
      if (accept && result.groupId) router.push(`/groups/${result.groupId}`);
    });
  }
  return (
    <div className="mx-auto max-w-[900px] space-y-6 pt-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Invites</h1>
        <p className="mt-2 text-sm text-muted-foreground">Review group invitations and Muddy requests.</p>
      </header>
      {feedback ? <p className="rounded-xl bg-secondary/60 px-4 py-3 text-sm" role="status">{feedback}</p> : null}
      <section aria-labelledby="group-invites-title">
        <div className="mb-3 flex items-center justify-between gap-4">
          <h2 id="group-invites-title" className="text-sm font-semibold">Group invitations</h2>
          <Button asChild type="button" variant="ghost" size="sm"><Link href="/friends?tab=requests">Muddy requests</Link></Button>
        </div>
        {invitations.length > 0 ? (
          <div className="space-y-3">
            {invitations.map((invitation) => (
              <article key={invitation.id} className="flex flex-col gap-4 rounded-2xl border border-border/70 bg-card/50 p-4 sm:flex-row sm:items-center">
                <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-primary/10 text-primary"><Users2 className="h-5 w-5" aria-hidden="true" /></span>
                <div className="min-w-0 flex-1">
                  <h3 className="truncate text-sm font-semibold">{invitation.name}</h3>
                  <p className="mt-1 text-xs text-muted-foreground">{invitation.invitedByName} invited you · {invitation.memberCount} {invitation.memberCount === 1 ? "member" : "members"}</p>
                </div>
                <div className="flex gap-2">
                  <Button type="button" size="sm" variant="outline" disabled={isPending} onClick={() => respond(invitation, false)}>Decline</Button>
                  <Button type="button" size="sm" disabled={isPending} onClick={() => respond(invitation, true)}>{isPending ? <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" /> : null}Join</Button>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <EmptyState icon={Inbox} className="!min-h-0 !shadow-none p-6" title="No group invitations" description="Invitations from approved Muddies will appear here." />
        )}
      </section>
    </div>
  );
}
