"use client";

import { useState, useTransition } from "react";
import { Mail, Plus, Trash2 } from "lucide-react";
import { createEmailAliasAction, deleteEmailAliasAction } from "@/app/(admin)/admin/communications/alias-actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { MadBuddyEmailAlias } from "@/lib/email/cloudflare-aliases";

export function AdminEmailAliases({
  aliases,
  configured
}: {
  aliases: MadBuddyEmailAlias[];
  configured: boolean;
}) {
  const [localPart, setLocalPart] = useState("");
  const [feedback, setFeedback] = useState("");
  const [pending, startTransition] = useTransition();

  function createAlias() {
    setFeedback("");
    startTransition(async () => {
      const result = await createEmailAliasAction({ localPart });
      setFeedback(result.message);
      if (result.ok) setLocalPart("");
    });
  }

  function removeAlias(alias: MadBuddyEmailAlias) {
    if (!window.confirm(`Remove ${alias.address}? Mail sent to this address will stop forwarding.`)) return;
    setFeedback("");
    startTransition(async () => {
      const result = await deleteEmailAliasAction({ ruleId: alias.id, address: alias.address });
      setFeedback(result.message);
    });
  }

  return (
    <div className="space-y-4">
      {!configured ? (
        <div className="rounded-xl border border-amber-500/20 bg-amber-500/[0.06] p-3 text-sm text-amber-100">
          Alias management is built, but the Cloudflare server credentials still need to be added before this panel can create or remove addresses.
        </div>
      ) : null}

      <div className="flex flex-col gap-2 sm:flex-row">
        <div className="flex min-w-0 flex-1 items-center rounded-md border border-input bg-background">
          <Input
            value={localPart}
            onChange={(event) => setLocalPart(event.target.value.toLowerCase())}
            placeholder="press"
            maxLength={64}
            disabled={!configured || pending}
            className="border-0 shadow-none focus-visible:ring-0"
            aria-label="New email alias"
          />
          <span className="shrink-0 pr-3 text-sm text-muted-foreground">@mad-buddy.com</span>
        </div>
        <Button
          type="button"
          onClick={createAlias}
          disabled={!configured || pending || localPart.trim().length === 0}
        >
          <Plus className="h-4 w-4" aria-hidden="true" />
          Create alias
        </Button>
      </div>

      {feedback ? <p className="text-xs text-muted-foreground" role="status">{feedback}</p> : null}

      <div className="overflow-hidden rounded-xl border border-border/70">
        {aliases.length === 0 ? (
          <div className="flex items-center gap-3 p-4 text-sm text-muted-foreground">
            <Mail className="h-4 w-4" aria-hidden="true" />
            {configured ? "No Cloudflare aliases were returned." : "Aliases will appear here after Cloudflare is connected."}
          </div>
        ) : (
          <div className="divide-y divide-border/70">
            {aliases.map((alias) => (
              <div key={alias.id} className="flex items-center justify-between gap-4 px-4 py-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{alias.address}</p>
                  <p className="mt-0.5 text-[11px] text-muted-foreground">
                    {alias.enabled ? "Forwarding enabled" : "Forwarding disabled"}
                  </p>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={pending}
                  onClick={() => removeAlias(alias)}
                  aria-label={`Remove ${alias.address}`}
                >
                  <Trash2 className="h-4 w-4" aria-hidden="true" />
                  <span className="hidden sm:inline">Remove</span>
                </Button>
              </div>
            ))}
          </div>
        )}
      </div>

      <p className="text-[11px] leading-5 text-muted-foreground">
        These are forwarding aliases, not separate inboxes. New aliases forward to the verified destination configured for Mad Buddy Email Routing.
      </p>
    </div>
  );
}
