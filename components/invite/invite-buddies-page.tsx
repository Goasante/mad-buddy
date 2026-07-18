"use client";

import Link from "next/link";
import { Copy, QrCode, RefreshCcw, ScanLine, ShieldCheck, UserPlus, X } from "lucide-react";
import { useEffect, useState, useTransition } from "react";
import { toDataURL } from "qrcode";
import {
  createInviteAction,
  getPersonalQrAction,
  revokeInviteAction,
  type PersonalQr
} from "@/app/(app)/invite-actions";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

type ActiveInvite = { id: string; url: string; token: string };

export function InviteBuddiesPage({ initialQr = null }: { initialQr?: PersonalQr | null }) {
  const [invite, setInvite] = useState<ActiveInvite | null>(null);
  const [qr, setQr] = useState<PersonalQr | null>(initialQr);
  const [copied, setCopied] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [qrImage, setQrImage] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  // Rendered locally from the opaque token, nothing personal is encoded.
  useEffect(() => {
    if (!qr?.token) {
      setQrImage(null);
      return;
    }
    let cancelled = false;
    void toDataURL(qr.token, { margin: 1, width: 220 }).then((url) => {
      if (!cancelled) setQrImage(url);
    });
    return () => {
      cancelled = true;
    };
  }, [qr?.token]);

  const fullUrl = invite ? `${typeof window !== "undefined" ? window.location.origin : ""}${invite.url}` : "";

  function createLink() {
    startTransition(async () => {
      const result = await createInviteAction({ inviteType: "personal", maxUses: 1 });
      setFeedback(result.message);
      if (result.ok && result.url && result.token && result.inviteId) {
        setInvite({ id: result.inviteId, url: result.url, token: result.token });
        setCopied(false);
      }
    });
  }

  function revoke() {
    if (!invite) return;
    startTransition(async () => {
      const result = await revokeInviteAction(invite.id);
      setFeedback(result.message);
      if (result.ok) {
        setInvite(null);
        setCopied(false);
      }
    });
  }

  function copyLink() {
    if (!fullUrl || typeof navigator === "undefined") return;
    void navigator.clipboard.writeText(fullUrl);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
  }

  function refreshQr() {
    startTransition(async () => {
      const next = await getPersonalQrAction();
      setQr(next);
    });
  }

  return (
    <div className="mx-auto max-w-[640px] space-y-6 pt-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Invite a Muddy</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Invite someone you already know. They&apos;ll still choose to accept.
        </p>
      </header>

      {feedback ? (
        <div className="rounded-[1rem] border border-orange-400/20 bg-orange-400/10 p-3 text-sm text-orange-800 dark:text-orange-50" role="status">
          {feedback}
        </div>
      ) : null}

      <Card className="p-5">
        <h2 className="flex items-center gap-2 text-base font-semibold">
          <UserPlus className="h-4 w-4 text-primary" aria-hidden="true" />
          Personal invite link
        </h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Single use, expires in 7 days, and you can revoke it any time.
        </p>

        {invite ? (
          <>
            <div className="mt-4 flex gap-2">
              <Input readOnly value={fullUrl} aria-label="Invite link" className="flex-1" />
              <Button type="button" onClick={copyLink}>
                <Copy className="h-4 w-4" aria-hidden="true" />
                {copied ? "Copied" : "Copy"}
              </Button>
            </div>
            <div className="mt-3 flex items-center gap-2">
              <Button type="button" variant="outline" size="sm" onClick={createLink} disabled={isPending}>
                <RefreshCcw className="h-4 w-4" aria-hidden="true" />
                New link
              </Button>
              <Button type="button" variant="ghost" size="sm" onClick={revoke} disabled={isPending}>
                <X className="h-4 w-4" aria-hidden="true" />
                Revoke
              </Button>
            </div>
            <p className="mt-3 text-xs text-muted-foreground">
              Save this link now, for your security we only store a fingerprint of it, so it can&apos;t be shown again.
            </p>
          </>
        ) : (
          <Button type="button" className="mt-4" onClick={createLink} disabled={isPending}>
            <UserPlus className="h-4 w-4" aria-hidden="true" />
            Create invite link
          </Button>
        )}
      </Card>

      <Card className="p-5">
        <h2 className="flex items-center gap-2 text-base font-semibold">
          <QrCode className="h-4 w-4 text-primary" aria-hidden="true" />
          Your personal QR
        </h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Show this in person. It refreshes every few minutes, so a screenshot stops working.
        </p>

        {qr ? (
          <div className="mt-4 space-y-3">
            <div className="grid place-items-center rounded-xl border border-border/70 bg-white p-4">
              {/* The token itself is opaque and carries no personal data. */}
              {qrImage ? (
                // eslint-disable-next-line @next/next/no-img-element -- local data URL, not a remote asset
                <img src={qrImage} alt="Your personal QR code" width={220} height={220} />
              ) : (
                <p className="break-all text-center font-mono text-[10px] text-muted-foreground">{qr.token}</p>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <span className="text-sm">
                Or use code <span className="font-mono font-semibold">{qr.shortCode}</span>
              </span>
              <Button type="button" variant="outline" size="sm" onClick={refreshQr} disabled={isPending}>
                <RefreshCcw className={cn("h-4 w-4", isPending && "animate-spin motion-reduce:animate-none")} aria-hidden="true" />
                Refresh
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">Refreshes in about {qr.rotatesInSeconds}s.</p>
          </div>
        ) : (
          <p className="mt-4 text-sm text-muted-foreground">Your QR isn&apos;t available right now.</p>
        )}

        <Button asChild type="button" variant="outline" className="mt-4">
          <Link href="/scan">
            <ScanLine className="h-4 w-4" aria-hidden="true" />
            Scan someone&apos;s code
          </Link>
        </Button>
      </Card>

      <div className="flex items-start gap-3 rounded-xl border border-border/70 bg-card/50 p-4">
        <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-primary" aria-hidden="true" />
        <div>
          <p className="text-sm font-semibold">Scanning never adds someone automatically</p>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            A scan or an invite link creates a request. You both still choose. Nothing about your location is shared.
          </p>
        </div>
      </div>
    </div>
  );
}
