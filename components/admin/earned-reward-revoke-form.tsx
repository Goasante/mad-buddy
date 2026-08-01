"use client";

import { useActionState } from "react";
import { revokeEarnedRewardAction, type BuddyScoreAdminState } from "@/app/(admin)/admin/buddy-score/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const initialState: BuddyScoreAdminState = { ok: false, message: "" };

export function EarnedRewardRevokeForm({ rewardId }: { rewardId: string }) {
  const [state, action, pending] = useActionState(revokeEarnedRewardAction, initialState);
  return (
    <form action={action} className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center">
      <input type="hidden" name="rewardId" value={rewardId} />
      <Input name="reason" required minLength={8} maxLength={300} placeholder="Revocation reason" aria-label="Earned access revocation reason" className="h-9 min-w-48" />
      <Button type="submit" size="sm" variant="danger" disabled={pending}>{pending ? "Revoking..." : "Revoke"}</Button>
      {state.message ? <span className={state.ok ? "text-xs text-emerald-400 sm:basis-full" : "text-xs text-red-400 sm:basis-full"} role="status">{state.message}</span> : null}
    </form>
  );
}
