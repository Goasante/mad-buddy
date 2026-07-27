"use client";

import Link from "next/link";
import type { Route } from "next";
import { useRouter } from "next/navigation";
import { Check, ChevronRight, Loader2, UsersRound, X } from "lucide-react";
import { useState, useTransition } from "react";
import { respondToGroupInvitationAction } from "@/app/(app)/group-actions";
import { Button } from "@/components/ui/button";
import { FeatureIcon } from "@/components/ui/feature-icon";
import { cn } from "@/lib/utils";
import type { GroupInvitation } from "@/lib/groups/types";

function monogram(name: string) {
  const trimmed = name.trim();
  return trimmed ? trimmed[0]!.toUpperCase() : "#";
}

export function InvitesPageContent({
  initialInvitations,
  muddyRequestCount = 0
}: {
  initialInvitations: GroupInvitation[];
  muddyRequestCount?: number;
}) {
  const router = useRouter();
  const [invitations, setInvitations] = useState(initialInvitations);
  const [feedback, setFeedback] = useState<{ message: string; ok: boolean } | null>(null);
  const [pending, setPending] = useState<{ id: string; accept: boolean } | null>(null);
  const [, startTransition] = useTransition();

  const groupCount = invitations.length;
  const hasPending = groupCount > 0 || muddyRequestCount > 0;

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
    <div className="mx-auto max-w-[720px] space-y-5 pt-5 sm:pt-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Invites</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {hasPending ? "You have people waiting to connect." : "Nothing waiting for you right now."}
        </p>
      </header>

      {/* Primary actions. "Invite a Muddy" is the growth action, so it carries
          the subtle primary emphasis; "Muddy requests" stays neutral with a
          live count when there are pending requests. */}
      <div className="grid gap-3 sm:grid-cols-2">
        <ActionCard
          href="/friends?tab=requests"
          title="Muddy requests"
          description="People who want to connect"
          badge={muddyRequestCount > 0 ? muddyRequestCount : undefined}
          icon={<UsersRound className="h-5 w-5" aria-hidden="true" />}
        />
        <ActionCard
          href="/invite"
          title="Invite a Muddy"
          description="Share your invite link or QR code"
          emphasis
          icon={<FeatureIcon feature="invites" size={20} active className="text-primary" />}
        />
      </div>

      {feedback ? (
        <p
          className={cn(
            "rounded-xl border px-4 py-2.5 text-sm",
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
        <h2 id="group-invites-title" className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Group invitations
        </h2>

        {groupCount > 0 ? (
          <ul className="space-y-2.5">
            {invitations.map((invitation) => {
              const busy = pending?.id === invitation.id;
              const disabled = pending !== null;
              return (
                <li
                  key={invitation.id}
                  className="safe-motion flex flex-col gap-3 rounded-2xl border border-border/70 bg-card p-3.5 shadow-sm transition hover:border-border sm:flex-row sm:items-center sm:gap-4"
                >
                  <span
                    className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-primary/10 text-base font-bold text-primary"
                    aria-hidden="true"
                  >
                    {monogram(invitation.name)}
                  </span>

                  <div className="min-w-0 flex-1">
                    <h3 className="truncate text-sm font-semibold">{invitation.name}</h3>
                    {invitation.description ? (
                      <p className="mt-0.5 line-clamp-1 text-xs text-muted-foreground">{invitation.description}</p>
                    ) : null}
                    <p className="mt-0.5 text-xs text-muted-foreground">
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
          <div className="flex flex-col items-center rounded-2xl border border-border/70 bg-card/40 px-6 py-8 text-center">
            <span className="grid h-12 w-12 place-items-center rounded-full bg-secondary/70 text-muted-foreground">
              <FeatureIcon feature="invites" size={22} />
            </span>
            <p className="mt-3 text-sm font-semibold">No group invitations yet</p>
            <p className="mt-1 max-w-[16rem] text-xs leading-5 text-muted-foreground">
              When a Muddy invites you to a group, you&apos;ll find it here.
            </p>
          </div>
        )}
      </section>
    </div>
  );
}

function ActionCard({
  href,
  title,
  description,
  icon,
  badge,
  emphasis = false
}: {
  href: Route;
  title: string;
  description: string;
  icon: React.ReactNode;
  badge?: number;
  emphasis?: boolean;
}) {
  return (
    <Link
      href={href}
      className={cn(
        "focus-ring safe-motion group flex min-h-[64px] items-center gap-3 rounded-2xl border p-3.5 shadow-sm transition active:scale-[0.99] motion-reduce:active:scale-100",
        emphasis
          ? "border-primary/30 bg-primary/[0.06] hover:border-primary/50 hover:bg-primary/[0.09]"
          : "border-border/70 bg-card hover:border-border hover:bg-secondary/40"
      )}
    >
      <span
        className={cn(
          "grid h-10 w-10 shrink-0 place-items-center rounded-xl",
          emphasis ? "bg-primary/15 text-primary" : "bg-secondary text-foreground/70"
        )}
      >
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span className="truncate text-sm font-semibold">{title}</span>
          {badge !== undefined ? (
            <span className="grid h-5 min-w-5 place-items-center rounded-full bg-primary px-1.5 text-xs font-semibold text-primary-foreground">
              {badge}
            </span>
          ) : null}
        </span>
        <span className="mt-0.5 block truncate text-xs text-muted-foreground">{description}</span>
      </span>
      <ChevronRight
        className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5 motion-reduce:transition-none"
        aria-hidden="true"
      />
    </Link>
  );
}
