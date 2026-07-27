"use client";

import Link from "next/link";
import type { Route } from "next";
import { useRouter } from "next/navigation";
import { Check, ChevronRight, Inbox, Loader2, UserPlus, Users2, X } from "lucide-react";
import { useMemo, useState, useTransition } from "react";
import { respondToGroupInvitationAction } from "@/app/(app)/group-actions";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { GroupInvitation } from "@/lib/groups/types";

function monogram(name: string) {
  const trimmed = name.trim();
  return trimmed ? trimmed[0]!.toUpperCase() : "#";
}

export function InvitesPageContent({ initialInvitations }: { initialInvitations: GroupInvitation[] }) {
  const router = useRouter();
  const [invitations, setInvitations] = useState(initialInvitations);
  const [feedback, setFeedback] = useState<{ message: string; ok: boolean } | null>(null);
  const [pending, setPending] = useState<{ id: string; accept: boolean } | null>(null);
  const [, startTransition] = useTransition();

  const count = invitations.length;
  const heading = useMemo(
    () => (count === 0 ? "You're all caught up" : `${count} pending invitation${count === 1 ? "" : "s"}`),
    [count]
  );

  function respond(invitation: GroupInvitation, accept: boolean) {
    if (pending) return; // One response at a time keeps the state unambiguous.
    setPending({ id: invitation.id, accept });
    setFeedback(null);
    startTransition(async () => {
      const result = await respondToGroupInvitationAction({ groupId: invitation.id, accept });
      setPending(null);
      setFeedback({ message: result.message, ok: result.ok });
      if (!result.ok) return;
      setInvitations((current) => current.filter((item) => item.id !== invitation.id));
      if (accept && result.groupId) {
        router.push(`/groups/${result.groupId}`);
      } else {
        router.refresh();
      }
    });
  }

  return (
    <div className="mx-auto max-w-[820px] space-y-6 pt-6">
      <header className="flex flex-col gap-1">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Invites</h1>
          {count > 0 ? (
            <span className="grid h-6 min-w-6 place-items-center rounded-full bg-primary px-2 text-xs font-semibold text-primary-foreground">
              {count}
            </span>
          ) : null}
        </div>
        <p className="text-sm text-muted-foreground">{heading}</p>
      </header>

      {/* Quick hub to the sibling invite surfaces. */}
      <div className="grid gap-3 sm:grid-cols-2">
        <HubLink
          href="/friends?tab=requests"
          icon={UserPlus}
          title="Muddy requests"
          description="People who want to connect with you"
        />
        <HubLink
          href="/invite"
          icon={Users2}
          title="Invite a Muddy"
          description="Share your code or link a friend"
        />
      </div>

      {feedback ? (
        <p
          className={cn(
            "rounded-xl border px-4 py-3 text-sm",
            feedback.ok
              ? "border-emerald-300/25 bg-emerald-300/10 text-emerald-800 dark:text-emerald-100"
              : "border-amber-300/25 bg-amber-300/10 text-amber-800 dark:text-amber-100"
          )}
          role="status"
          aria-live="polite"
        >
          {feedback.message}
        </p>
      ) : null}

      <section aria-labelledby="group-invites-title" className="space-y-3">
        <h2 id="group-invites-title" className="text-sm font-semibold text-muted-foreground">
          Group invitations
        </h2>

        {count > 0 ? (
          <ul className="space-y-3">
            {invitations.map((invitation) => {
              const busy = pending?.id === invitation.id;
              const disabled = pending !== null;
              return (
                <li
                  key={invitation.id}
                  className="safe-motion flex flex-col gap-4 rounded-2xl border border-border/70 bg-card p-4 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md motion-reduce:hover:translate-y-0 sm:flex-row sm:items-center sm:p-5"
                >
                  <span
                    className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-[linear-gradient(135deg,hsl(var(--primary)/0.95),hsl(24_90%_42%))] text-lg font-bold text-white shadow-inner"
                    aria-hidden="true"
                  >
                    {monogram(invitation.name)}
                  </span>

                  <div className="min-w-0 flex-1">
                    <h3 className="truncate text-base font-semibold">{invitation.name}</h3>
                    {invitation.description ? (
                      <p className="mt-0.5 line-clamp-1 text-sm text-muted-foreground">{invitation.description}</p>
                    ) : null}
                    <p className="mt-1 text-xs text-muted-foreground">
                      <span className="font-medium text-foreground/80">{invitation.invitedByName}</span> invited you
                      {" · "}
                      {invitation.memberCount} {invitation.memberCount === 1 ? "member" : "members"}
                    </p>
                  </div>

                  <div className="flex shrink-0 gap-2">
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={disabled}
                      onClick={() => respond(invitation, false)}
                      aria-label={`Decline invitation to ${invitation.name}`}
                    >
                      {busy && !pending?.accept ? (
                        <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />
                      ) : (
                        <X className="h-4 w-4" aria-hidden="true" />
                      )}
                      Decline
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      disabled={disabled}
                      onClick={() => respond(invitation, true)}
                      aria-label={`Join ${invitation.name}`}
                    >
                      {busy && pending?.accept ? (
                        <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />
                      ) : (
                        <Check className="h-4 w-4" aria-hidden="true" />
                      )}
                      Join
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        ) : (
          <div className="flex flex-col items-center rounded-2xl border border-dashed border-border/70 bg-card/40 px-6 py-12 text-center">
            <span className="grid h-14 w-14 place-items-center rounded-full bg-secondary/70 text-muted-foreground">
              <Inbox className="h-6 w-6" aria-hidden="true" />
            </span>
            <p className="mt-4 text-base font-semibold">No group invitations</p>
            <p className="mt-1 max-w-sm text-sm text-muted-foreground">
              Invitations from approved Muddies will show up here. Start a circle of your own in the meantime.
            </p>
            <Button asChild type="button" className="mt-5">
              <Link href="/invite">
                <UserPlus className="h-4 w-4" aria-hidden="true" />
                Invite a Muddy
              </Link>
            </Button>
          </div>
        )}
      </section>
    </div>
  );
}

function HubLink({
  href,
  icon: Icon,
  title,
  description
}: {
  href: Route;
  icon: typeof UserPlus;
  title: string;
  description: string;
}) {
  return (
    <Link
      href={href}
      className="focus-ring safe-motion group flex items-center gap-3 rounded-2xl border border-border/70 bg-card p-4 shadow-sm transition hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-md motion-reduce:hover:translate-y-0"
    >
      <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-primary/10 text-primary">
        <Icon className="h-5 w-5" aria-hidden="true" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold">{title}</span>
        <span className="block truncate text-xs text-muted-foreground">{description}</span>
      </span>
      <ChevronRight
        className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5 motion-reduce:transition-none"
        aria-hidden="true"
      />
    </Link>
  );
}
