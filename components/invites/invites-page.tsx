"use client";

import Link from "next/link";
import { Users2 } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { GlowAvatar } from "@/components/glow/glow-avatar";
import { cn } from "@/lib/utils";

type InviteTab = "received" | "sent" | "connections";

type CircleInvite = {
  id: string;
  circleName: string;
  invitedBy: string;
  members: number;
  mutual: number;
};

const seedInvites: CircleInvite[] = [
  { id: "inv-1", circleName: "Legon Entrepreneurs", invitedBy: "Kojo Mensah", members: 12, mutual: 2 },
  { id: "inv-2", circleName: "Photography Ghana", invitedBy: "Efua Yeboah", members: 36, mutual: 5 },
  { id: "inv-3", circleName: "Law School '24", invitedBy: "Ama Serwaa", members: 28, mutual: 8 }
];

const inviteTabs: Array<{ id: InviteTab; label: string }> = [
  { id: "received", label: "Received" },
  { id: "sent", label: "Sent" },
  { id: "connections", label: "Connections" }
];

export function InvitesPageContent() {
  const [invites, setInvites] = useState<CircleInvite[]>(seedInvites);
  const [tab, setTab] = useState<InviteTab>("received");

  function respond(id: string) {
    setInvites((current) => current.filter((invite) => invite.id !== id));
  }

  return (
    <div className="mx-auto max-w-[900px] space-y-6 pt-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Invites</h1>
        <p className="mt-2 text-sm text-muted-foreground">Manage incoming invites and connection requests.</p>
      </div>

      <div className="flex gap-1 border-b border-border/70">
        {inviteTabs.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => setTab(item.id)}
            className={cn(
              "focus-ring safe-motion border-b-2 px-4 py-3 text-sm font-medium",
              tab === item.id ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"
            )}
          >
            {item.label}
            {item.id === "received" && invites.length > 0 ? (
              <span className="ml-1.5 rounded-full bg-primary px-1.5 py-0.5 text-[10px] font-bold text-primary-foreground">{invites.length}</span>
            ) : null}
          </button>
        ))}
      </div>

      {tab === "received" ? (
        invites.length > 0 ? (
          <section>
            <h2 className="mb-3 flex items-center justify-between text-sm font-semibold text-muted-foreground">Circle Invites</h2>
            <div className="space-y-2">
              {invites.map((invite) => (
                <div key={invite.id} className="flex items-center gap-3 rounded-xl border border-border/70 bg-card/50 p-4">
                  <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-primary/10 text-primary">
                    <Users2 className="h-5 w-5" aria-hidden="true" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold">{invite.circleName}</p>
                    <p className="text-xs text-muted-foreground">
                      Invited by {invite.invitedBy} · {invite.members} members · {invite.mutual} mutual
                    </p>
                  </div>
                  <div className="flex shrink-0 gap-2">
                    <Button type="button" size="sm" onClick={() => respond(invite.id)}>
                      Accept
                    </Button>
                    <Button type="button" size="sm" variant="outline" onClick={() => respond(invite.id)}>
                      Ignore
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </section>
        ) : (
          <EmptyState icon={Users2} className="!shadow-none" title="No circle invites" description="Invites to join circles will appear here." />
        )
      ) : null}

      {tab === "sent" ? (
        <EmptyState icon={Users2} className="!shadow-none" title="No sent invites" description="Circle invites you've sent will appear here." />
      ) : null}

      {tab === "connections" ? (
        <div className="rounded-xl border border-border/70 bg-card/50 p-5 text-center">
          <GlowAvatar name="Muddy requests" size="md" className="mx-auto" />
          <p className="mt-3 text-sm font-semibold">Connection requests live on the Muddies page</p>
          <p className="mt-1 text-xs text-muted-foreground">Accept, decline, or manage friend requests there.</p>
          <Button type="button" size="sm" className="mt-4" asChild>
            <Link href="/friends?tab=requests">Go to Requests</Link>
          </Button>
        </div>
      ) : null}
    </div>
  );
}
