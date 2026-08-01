"use client";

import { useActionState } from "react";
import { correctBuddyScoreAction, type BuddyScoreAdminState } from "@/app/(admin)/admin/buddy-score/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const initialState: BuddyScoreAdminState = { ok: false, message: "" };

export function BuddyScoreCorrectionForm() {
  const [state, action, pending] = useActionState(correctBuddyScoreAction, initialState);
  return <form action={action} className="grid gap-4 rounded-2xl border border-border/70 bg-card/45 p-5 lg:grid-cols-[minmax(220px,1fr)_140px_minmax(260px,1.4fr)_auto] lg:items-end">
    <label className="grid gap-2 text-sm font-medium">User ID<Input name="userId" required placeholder="User UUID" autoComplete="off" /></label>
    <label className="grid gap-2 text-sm font-medium">Points<Input name="points" required type="number" min={-500} max={200} step={1} placeholder="+ or -" /></label>
    <label className="grid gap-2 text-sm font-medium">Reason<Input name="reason" required minLength={8} maxLength={300} placeholder="Why this correction is necessary" /></label>
    <Button type="submit" disabled={pending}>{pending ? "Recording..." : "Add correction"}</Button>
    {state.message ? <p className={state.ok ? "text-sm text-emerald-400 lg:col-span-4" : "text-sm text-red-400 lg:col-span-4"} role="status">{state.message}</p> : null}
  </form>;
}
