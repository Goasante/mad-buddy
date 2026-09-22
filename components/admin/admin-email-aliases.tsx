"use client";

import { useMemo, useState, useTransition } from "react";
import { AlertTriangle, Mail, Plus, Trash2 } from "lucide-react";
import { createEmailAliasAction, deleteEmailAliasAction } from "@/app/(admin)/admin/communications/alias-actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { MadBuddyEmailAlias } from "@/lib/email/cloudflare-aliases";

type AliasConfigStatus = {
  configured: boolean;
  hasToken: boolean;
  hasZoneId: boolean;
  hasForwardTo: boolean;
};

export function AdminEmailAliases({
  aliases,
  configStatus,
  connectionError
}: {
  aliases: MadBuddyEmailAlias[];
  configStatus: AliasConfigStatus;
  connectionError: boolean;
}) {
  const [localPart, setLocalPart] = useState("");
  const [feedback, setFeedback] = useState("");
  const [pending, startTransition] = useTransition();

  const missingVariables = useMemo(() => {
    const missing: string[] = [];
    if (!configStatus.hasToken) missing.push("CLOUDFLARE_EMAIL_ROUTING_API_TOKEN");
    if (!configStatus.hasZoneId) missing.push("CLOUDFLARE_ZONE_ID");
    if (!configStatus.hasForwardTo) missing.push("CLOUDFLARE_EMAIL_FORWARD_TO");
    return missing;
  }, [configStatus]);

  const usable = configStatus.configured && !connectionError;

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
      {!configStatus.configured ? (
        <div className="rounded-xl border border-amber-500/20 bg-amber-500/[0.06] p-3 text-sm text-amber-100">
          <div className="flex items-start gap-2">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <div>
              <p className="font-medium">Cloudflare server setup is incomplete.</p>
              <p className="mt-1 text-xs leading-5 text-amber-100/80">
                Missing in this deployment: {missingVariables.join(", ") || "unknown configuration"}. Add the missing variable in Vercel Production and redeploy.
              </p>
            </div>
          </div>
        </div>
      ) : connectionError ? (
        <div className="rounded-xl border border-red-500/20 bg-red-500/[0.06] p-3 text-sm text-red-100">
          <div className="flex items-start gap-2">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <div>
              <p className="font-medium">The Cloudflare credentials are present, but the connection was rejected.</p>
              <p className="mt-1 text-xs leading-5 text-red-100/80">
                Check that the API token can edit Email Routing rules for mad-buddy.com, the Zone ID belongs to mad-buddy.com, and the forwarding destination is verified in Cloudflare Email Routing.
              </p>
            </div>
          </div>
        </div>
      ) : null}

      <div className="flex flex-col gap-2 sm:flex-row">
        <div className="flex min-w-0 flex-1 items-center rounded-md border border-input bg-background">
          <Input
            value={localPart}
            onChange={(event) => setLocalPart(event.target.value.toLowerCase())}
            placeholder="press"
            maxLength={64}
            disabled={!usable || pending}
            className="border-0 shadow-none focus-visible:ring-0"
            aria-label="New email alias"
          />
          <span className="shrink-0 pr-3 text-sm text-muted-foreground">@mad-buddy.com</span>
        </div>
        <Button
          type="button"
          onClick={createAlias}
          disabled={!usable || pending || localPart.trim().length === 0}
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
            {usable ? "No Cloudflare aliases were returned." : "Alias controls will unlock after the Cloudflare connection passes."}
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
