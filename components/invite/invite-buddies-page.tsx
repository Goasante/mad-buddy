"use client";

import { Copy, MessageCircle, Send, Share2, UserPlus } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PreviewNotice } from "@/components/ui/preview-notice";

const shareChannels = [
  { label: "WhatsApp", icon: MessageCircle },
  { label: "Instagram", icon: Share2 },
  { label: "Messenger", icon: Send },
  { label: "More", icon: Share2 }
];

export function InviteBuddiesPage() {
  const [copied, setCopied] = useState(false);
  const inviteLink = "madbuddy.app/invite/am123";

  function copyLink() {
    if (typeof navigator !== "undefined" && navigator.clipboard) {
      void navigator.clipboard.writeText(`https://${inviteLink}`);
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="mx-auto max-w-[640px] space-y-8 pt-6">
      <PreviewNotice />
      <div className="rounded-2xl border border-border/70 bg-card/50 p-6 text-center">
        <span className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-primary/10 text-primary">
          <UserPlus className="h-7 w-7" aria-hidden="true" />
        </span>
        <h1 className="mt-4 text-xl font-semibold tracking-tight">Invite your buddies, make more memories.</h1>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          The more, the merrier. Invite your friends to join Mad Buddy and start connecting.
        </p>
      </div>

      <section>
        <p className="mb-2 text-sm font-medium">Share your invite link</p>
        <div className="flex gap-2">
          <Input readOnly value={inviteLink} aria-label="Invite link" />
          <Button type="button" onClick={copyLink}>
            <Copy className="h-4 w-4" aria-hidden="true" />
            {copied ? "Copied" : "Copy Link"}
          </Button>
        </div>
      </section>

      <section>
        <p className="mb-2 text-sm font-medium">Or invite via</p>
        <div className="grid grid-cols-4 gap-3">
          {shareChannels.map((channel) => (
            <button
              key={channel.label}
              type="button"
              className="focus-ring safe-motion flex flex-col items-center gap-2 rounded-xl border border-border/70 p-3 text-xs font-medium text-muted-foreground hover:bg-secondary"
            >
              <channel.icon className="h-5 w-5" aria-hidden="true" />
              {channel.label}
            </button>
          ))}
        </div>
      </section>

      <section className="rounded-xl border border-border/70 bg-card/50 p-4">
        <p className="text-sm font-medium">Your Invites</p>
        <div className="mt-3 grid grid-cols-3 divide-x divide-border/70 text-center">
          <div>
            <p className="text-lg font-semibold">23</p>
            <p className="text-[11px] text-muted-foreground">Invited</p>
          </div>
          <div>
            <p className="text-lg font-semibold">17</p>
            <p className="text-[11px] text-muted-foreground">Joined</p>
          </div>
          <div>
            <p className="text-lg font-semibold">73%</p>
            <p className="text-[11px] text-muted-foreground">Conversion</p>
          </div>
        </div>
      </section>
    </div>
  );
}
