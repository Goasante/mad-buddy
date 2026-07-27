"use client";

import { useActionState } from "react";
import {
  grantTrialAction,
  revokeTrialAction,
  updateTrialConfigAction,
  type TrialAdminActionState
} from "@/app/(admin)/admin/revenue/trials/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const initial: TrialAdminActionState = { ok: false, message: "" };

export function TrialConfigForm(props: {
  enabled: boolean;
  plan: "buddy_plus" | "buddy_pro";
  durationDays: number;
  audience: "all_eligible" | "owner_grant_only";
  minimumAccountAgeDays: number;
  requiresCompletedOnboarding: boolean;
  campaignSource: string | null;
}) {
  const [state, action, pending] = useActionState(updateTrialConfigAction, initial);
  return (
    <form action={action} className="grid gap-4 md:grid-cols-2">
      <Field label="Availability">
        <select name="enabled" defaultValue={String(props.enabled)} className="input-shell h-11 w-full px-3">
          <option value="false">Disabled</option>
          <option value="true">Enabled</option>
        </select>
      </Field>
      <Field label="Eligible plan">
        <select name="plan" defaultValue={props.plan} className="input-shell h-11 w-full px-3">
          <option value="buddy_plus">Buddy Plus</option>
          <option value="buddy_pro">Buddy Pro</option>
        </select>
      </Field>
      <Field label="Duration in days">
        <Input name="durationDays" type="number" min={1} max={60} defaultValue={props.durationDays} />
      </Field>
      <Field label="Audience">
        <select name="audience" defaultValue={props.audience} className="input-shell h-11 w-full px-3">
          <option value="all_eligible">All eligible accounts</option>
          <option value="owner_grant_only">Owner grants only</option>
        </select>
      </Field>
      <Field label="Minimum account age in days">
        <Input name="minimumAccountAgeDays" type="number" min={0} max={3650} defaultValue={props.minimumAccountAgeDays} />
      </Field>
      <Field label="Require completed onboarding">
        <select
          name="requiresCompletedOnboarding"
          defaultValue={String(props.requiresCompletedOnboarding)}
          className="input-shell h-11 w-full px-3"
        >
          <option value="true">Yes</option>
          <option value="false">No</option>
        </select>
      </Field>
      <Field label="Campaign or source">
        <Input name="campaignSource" maxLength={80} defaultValue={props.campaignSource ?? ""} placeholder="Optional" />
      </Field>
      <Field label="Change reason">
        <Input name="reason" minLength={3} maxLength={500} required placeholder="Required for the audit trail" />
      </Field>
      <ActionFooter pending={pending} state={state} label="Save trial controls" />
    </form>
  );
}

export function TrialGrantForm() {
  const [state, action, pending] = useActionState(grantTrialAction, initial);
  return (
    <form action={action} className="grid gap-4 md:grid-cols-3">
      <Field label="User ID or username">
        <Input name="account" required placeholder="@username or UUID" />
      </Field>
      <Field label="Plan">
        <select name="plan" defaultValue="buddy_plus" className="input-shell h-11 w-full px-3">
          <option value="buddy_plus">Buddy Plus</option>
          <option value="buddy_pro">Buddy Pro</option>
        </select>
      </Field>
      <Field label="Override reason">
        <Input name="reason" required minLength={3} maxLength={500} />
      </Field>
      <ActionFooter pending={pending} state={state} label="Grant trial" />
    </form>
  );
}

export function TrialRevokeForm({ trialId }: { trialId: string }) {
  const [state, action, pending] = useActionState(revokeTrialAction, initial);
  return (
    <form action={action} className="flex flex-wrap items-end gap-2">
      <input type="hidden" name="trialId" value={trialId} />
      <Field label="Revocation reason">
        <Input name="reason" required minLength={3} maxLength={500} className="w-56" />
      </Field>
      <Button type="submit" variant="danger" disabled={pending}>
        {pending ? "Revoking..." : "Revoke"}
      </Button>
      {state.message ? <span className="text-xs text-muted-foreground" role="status">{state.message}</span> : null}
    </form>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="grid gap-1.5 text-sm font-medium">{label}{children}</label>;
}

function ActionFooter({
  pending,
  state,
  label
}: {
  pending: boolean;
  state: TrialAdminActionState;
  label: string;
}) {
  return (
    <div className="flex items-center gap-3 md:col-span-full">
      <Button type="submit" disabled={pending}>{pending ? "Saving..." : label}</Button>
      {state.message ? (
        <p className={state.ok ? "text-sm text-emerald-500" : "text-sm text-destructive"} role="status">{state.message}</p>
      ) : null}
    </div>
  );
}
