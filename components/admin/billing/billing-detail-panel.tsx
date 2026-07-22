"use client";

import { Gift, RefreshCw, ShieldCheck, X } from "lucide-react";
import { useState, useTransition } from "react";
import {
  changeSubscriptionPlanAction,
  grantEntitlementOverrideAction,
  reconcileSubscriptionAction,
  revokeEntitlementOverrideAction,
  setCancelAtPeriodEndAction
} from "@/app/(admin)/admin/billing/actions";
import { AdminSection, formatAdminDate } from "@/components/admin/admin-ui";
import { PlanBadge, SubscriptionStatusBadge } from "@/components/admin/billing/billing-badges";
import { AppSelect, type AppSelectOption } from "@/components/ui/app-dropdown";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { UserAvatar } from "@/components/ui/user-avatar";
import { changeTypeLabel, maskPaystackReference, OVERRIDEABLE_ENTITLEMENTS, planLabel, SUBSCRIPTION_PLANS } from "@/lib/admin/billing-admin";
import { cn } from "@/lib/utils";

export type BillingDetailData = {
  userId: string;
  canManage: boolean;
  canManagePlan: boolean;
  user: { name: string; username: string | null; avatarUrl: string | null };
  subscription: {
    plan: string;
    effectivePlan: string;
    status: string;
    provider: string;
    currentPeriodStart: string | null;
    currentPeriodEnd: string | null;
    graceEndsAt: string | null;
    trialEndsAt: string | null;
    cancelAtPeriodEnd: boolean;
    subscriptionCode: string | null;
    customerCode: string | null;
    updatedAt: string;
  };
  changes: { id: string; changeType: string; fromPlan: string; toPlan: string; status: string; effectiveAt: string | null; requestedAt: string; reason: string | null }[];
  overrides: { id: string; key: string; label: string; value: number | boolean | null; reason: string | null; endsAt: string | null }[];
};

type Feedback = { ok: boolean; text: string } | null;

export function BillingDetailPanel({ data }: { data: BillingDetailData }) {
  const [feedback, setFeedback] = useState<Feedback>(null);
  const sub = data.subscription;

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border/70 pb-4">
        <div className="flex items-center gap-3">
          <UserAvatar src={data.user.avatarUrl} name={data.user.name} size="sm" />
          <div className="min-w-0">
            <h1 className="truncate text-lg font-semibold">{data.user.name}</h1>
            {data.user.username ? <p className="truncate text-xs text-muted-foreground">@{data.user.username}</p> : null}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <PlanBadge plan={sub.plan} />
          <SubscriptionStatusBadge status={sub.status} />
        </div>
      </header>

      {feedback ? (
        <div className={cn("rounded-xl border p-3 text-sm", feedback.ok ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-200" : "border-amber-500/30 bg-amber-500/10 text-amber-100")} role="status">
          {feedback.text}
        </div>
      ) : null}

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px] lg:items-start">
        <div className="order-2 space-y-5 lg:order-1">
          {data.canManagePlan ? <ChangePlanControls data={data} onFeedback={setFeedback} /> : null}
          {data.canManage ? <ManageControls data={data} onFeedback={setFeedback} /> : null}

          <AdminSection title="Change history" description="Plan and lifecycle changes for this account.">
            {data.changes.length === 0 ? (
              <p className="px-1 text-xs text-muted-foreground">No recorded changes.</p>
            ) : (
              <div className="grid gap-2">
                {data.changes.map((change) => (
                  <Card key={change.id} className="p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-sm font-medium">
                        {changeTypeLabel(change.changeType)}
                        {change.fromPlan !== change.toPlan ? ` · ${planLabel(change.fromPlan)} → ${planLabel(change.toPlan)}` : ""}
                      </p>
                      <span className="text-xs text-muted-foreground">{change.status}</span>
                    </div>
                    {change.reason ? <p className="mt-1 text-xs text-muted-foreground">{change.reason}</p> : null}
                    <p className="mt-1 text-[11px] text-muted-foreground">
                      Requested {formatAdminDate(change.requestedAt, true)}{change.effectiveAt ? ` · effective ${formatAdminDate(change.effectiveAt)}` : ""}
                    </p>
                  </Card>
                ))}
              </div>
            )}
          </AdminSection>
        </div>

        <div className="order-1 space-y-4 lg:order-2">
          <Card className="space-y-2 p-4 text-sm">
            <MetaRow label="Effective plan" value={planLabel(sub.effectivePlan)} />
            <MetaRow label="Provider" value={sub.provider} />
            <MetaRow label="Period start" value={formatAdminDate(sub.currentPeriodStart)} />
            <MetaRow label="Period end" value={formatAdminDate(sub.currentPeriodEnd)} />
            {sub.trialEndsAt ? <MetaRow label="Trial ends" value={formatAdminDate(sub.trialEndsAt)} /> : null}
            {sub.graceEndsAt ? <MetaRow label="Grace ends" value={formatAdminDate(sub.graceEndsAt)} /> : null}
            <MetaRow label="Cancels at period end" value={sub.cancelAtPeriodEnd ? "Yes" : "No"} />
            {/* Reference hints only — never the authorization/payment credential. */}
            <MetaRow label="Paystack subscription" value={maskPaystackReference(sub.subscriptionCode)} />
            <MetaRow label="Paystack customer" value={maskPaystackReference(sub.customerCode)} />
          </Card>

          <ActiveOverrides overrides={data.overrides} userId={data.userId} canManage={data.canManage} onFeedback={setFeedback} />
        </div>
      </div>
    </div>
  );
}

function MetaRow({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="min-w-0 truncate text-right text-sm">{value ?? "—"}</span>
    </div>
  );
}

function ChangePlanControls({ data, onFeedback }: { data: BillingDetailData; onFeedback: (f: Feedback) => void }) {
  const [pending, start] = useTransition();
  const [plan, setPlan] = useState<string | null>(data.subscription.plan);
  const [reason, setReason] = useState("");
  const planOptions: AppSelectOption[] = SUBSCRIPTION_PLANS.map((value) => ({ value, label: planLabel(value) }));
  const changed = plan !== null && plan !== data.subscription.plan;

  function apply() {
    if (!plan || !changed) return;
    start(async () => {
      const result = await changeSubscriptionPlanAction({ userId: data.userId, plan, reason: reason.trim() });
      onFeedback({ ok: result.ok, text: result.message });
      if (result.ok) setReason("");
    });
  }

  return (
    <AdminSection title="Plan" description="Upgrade or downgrade this account's plan. Applies immediately and is recorded in the audit log.">
      <Card className="space-y-3 p-4">
        <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-start">
          <AppSelect value={plan} options={planOptions} placeholder="Choose a plan" onChange={setPlan} />
          <Input value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Reason (recorded)" maxLength={200} aria-label="Reason for the plan change" />
          <Button type="button" size="sm" onClick={apply} disabled={pending || !changed || reason.trim().length < 3}>Apply</Button>
        </div>
        <p className="text-[11px] text-muted-foreground">
          Current plan: {planLabel(data.subscription.plan)}. A manual change doesn&rsquo;t touch Paystack — use it for comps, corrections, or support grants.
        </p>
      </Card>
    </AdminSection>
  );
}

function ManageControls({ data, onFeedback }: { data: BillingDetailData; onFeedback: (f: Feedback) => void }) {
  const [pending, start] = useTransition();
  const sub = data.subscription;
  const [entitlement, setEntitlement] = useState<string | null>(null);
  const [grantReason, setGrantReason] = useState("");

  const entitlementOptions: AppSelectOption[] = OVERRIDEABLE_ENTITLEMENTS.map((entry) => ({ value: entry.key, label: entry.label }));

  function reconcile() {
    start(async () => {
      const result = await reconcileSubscriptionAction({ userId: data.userId });
      onFeedback({ ok: result.ok, text: result.message });
    });
  }

  function toggleCancel(cancel: boolean) {
    start(async () => {
      const result = await setCancelAtPeriodEndAction({ userId: data.userId, cancel });
      onFeedback({ ok: result.ok, text: result.message });
    });
  }

  function grant() {
    if (!entitlement) return;
    start(async () => {
      const result = await grantEntitlementOverrideAction({ userId: data.userId, entitlementKey: entitlement, reason: grantReason.trim() });
      onFeedback({ ok: result.ok, text: result.message });
      if (result.ok) {
        setEntitlement(null);
        setGrantReason("");
      }
    });
  }

  return (
    <AdminSection title="Manage" description="Reconcile against Paystack, grant a feature, or change the renewal.">
      <Card className="space-y-4 p-4">
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" size="sm" onClick={reconcile} disabled={pending}>
            <RefreshCw className={cn("h-4 w-4", pending && "animate-spin")} aria-hidden="true" /> Reconcile with Paystack
          </Button>
          {sub.plan !== "free" ? (
            sub.cancelAtPeriodEnd ? (
              <Button type="button" variant="outline" size="sm" onClick={() => toggleCancel(false)} disabled={pending}>
                <ShieldCheck className="h-4 w-4" aria-hidden="true" /> Reactivate
              </Button>
            ) : (
              <Button type="button" variant="outline" size="sm" onClick={() => toggleCancel(true)} disabled={pending}>
                <X className="h-4 w-4" aria-hidden="true" /> Cancel at period end
              </Button>
            )
          ) : null}
        </div>

        <div className="border-t border-border/60 pt-3">
          <p className="mb-2 inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
            <Gift className="h-3.5 w-3.5" aria-hidden="true" /> Grant a premium feature (comp)
          </p>
          <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-start">
            <AppSelect value={entitlement} options={entitlementOptions} placeholder="Choose a feature" searchable onChange={(value) => setEntitlement(value)} />
            <Input value={grantReason} onChange={(event) => setGrantReason(event.target.value)} placeholder="Reason (recorded)" maxLength={200} aria-label="Reason for the grant" />
            <Button type="button" size="sm" onClick={grant} disabled={pending || !entitlement || grantReason.trim().length < 3}>Grant</Button>
          </div>
        </div>
      </Card>
    </AdminSection>
  );
}

function ActiveOverrides({
  overrides,
  userId,
  canManage,
  onFeedback
}: {
  overrides: BillingDetailData["overrides"];
  userId: string;
  canManage: boolean;
  onFeedback: (f: Feedback) => void;
}) {
  const [pending, start] = useTransition();

  function revoke(overrideId: string) {
    start(async () => {
      const result = await revokeEntitlementOverrideAction({ overrideId, userId });
      onFeedback({ ok: result.ok, text: result.message });
    });
  }

  return (
    <Card className="p-4">
      <p className="text-sm font-semibold">Active entitlement overrides</p>
      {overrides.length === 0 ? (
        <p className="mt-2 text-xs text-muted-foreground">No active overrides.</p>
      ) : (
        <ul className="mt-3 space-y-2">
          {overrides.map((override) => (
            <li key={override.id} className="rounded-lg border border-border/60 p-2.5">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-sm font-medium">{override.label}</p>
                  {override.reason ? <p className="text-xs text-muted-foreground">{override.reason}</p> : null}
                  <p className="text-[11px] text-muted-foreground">{override.endsAt ? `Until ${formatAdminDate(override.endsAt)}` : "No expiry"}</p>
                </div>
                {canManage ? (
                  <Button type="button" variant="ghost" size="sm" onClick={() => revoke(override.id)} disabled={pending}>Revoke</Button>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
