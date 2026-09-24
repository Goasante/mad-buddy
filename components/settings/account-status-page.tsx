"use client";

import { Loader2, ShieldAlert, ShieldCheck } from "lucide-react";
import { useState, useTransition } from "react";

import { submitRestrictionAppealAction } from "@/app/(app)/settings/account-status-actions";
import { SettingsSubHeader } from "@/components/settings/settings-sub-header";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

export type AccountRestrictionView = {
  id: string;
  type: string;
  startsAt: string;
  endsAt: string | null;
  appealable: boolean;
  appealStatus: string | null;
  appealDecision: string | null;
};

export function AccountStatusPage({ restrictions }: { restrictions: AccountRestrictionView[] }) {
  return (
    <div className="mr-auto max-w-[680px] space-y-6 pt-6">
      <SettingsSubHeader title="Account status" description="Review account restrictions, their duration, and any appeal." />
      {restrictions.length === 0 ? (
        <Card className="flex items-start gap-3 p-5">
          <ShieldCheck className="h-5 w-5 shrink-0 text-emerald-600" aria-hidden="true" />
          <div><p className="text-sm font-semibold">No active restrictions</p><p className="mt-1 text-sm text-muted-foreground">Your account is in good standing.</p></div>
        </Card>
      ) : restrictions.map((restriction) => <RestrictionCard key={restriction.id} restriction={restriction} />)}
    </div>
  );
}

function RestrictionCard({ restriction }: { restriction: AccountRestrictionView }) {
  const [reason, setReason] = useState("");
  const [feedback, setFeedback] = useState("");
  const [pending, startTransition] = useTransition();
  return (
    <Card className="space-y-3 p-5">
      <div className="flex items-start gap-3">
        <ShieldAlert className="h-5 w-5 shrink-0 text-amber-600" aria-hidden="true" />
        <div>
          <p className="text-sm font-semibold capitalize">{restriction.type.replaceAll("_", " ")}</p>
          <p className="mt-1 text-xs text-muted-foreground">Started {new Date(restriction.startsAt).toLocaleString()}{restriction.endsAt ? ` · Ends ${new Date(restriction.endsAt).toLocaleString()}` : ""}</p>
          {restriction.appealStatus ? <p className="mt-1 text-xs font-medium">Appeal: {restriction.appealDecision ?? restriction.appealStatus.replaceAll("_", " ")}</p> : null}
        </div>
      </div>
      {restriction.appealable && !restriction.appealStatus ? (
        <>
          <textarea value={reason} onChange={(event) => setReason(event.target.value)} rows={4} maxLength={2000} placeholder="Explain why this decision should be reviewed" className="focus-ring w-full resize-y rounded-xl border border-border bg-background px-3 py-2 text-sm outline-none" />
          <Button type="button" size="sm" disabled={pending || reason.trim().length < 10} onClick={() => startTransition(async () => {
            const result = await submitRestrictionAppealAction({ restrictionId: restriction.id, reason });
            setFeedback(result.message);
          })}>
            {pending ? <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" /> : null} Submit appeal
          </Button>
        </>
      ) : null}
      {feedback ? <p className="text-sm text-muted-foreground" role="status">{feedback}</p> : null}
    </Card>
  );
}
