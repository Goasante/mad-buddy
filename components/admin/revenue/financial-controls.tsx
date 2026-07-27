"use client";

import { cloneElement, useState, useTransition, type ReactElement } from "react";
import {
  runFinancialMaintenanceAction,
  saveProviderCostAction,
  updateBusinessAlertRulesAction
} from "@/app/(admin)/admin/revenue/actions";
import { AppSwitch } from "@/components/ui/app-switch";
import { Button } from "@/components/ui/button";

type AlertRule = {
  ruleKey: "mrr_drop" | "cancellation_spike" | "payment_failure_spike" | "recovery_rate_drop" | "infrastructure_cost_spike";
  enabled: boolean;
  thresholdPercent: number;
};

const labels: Record<AlertRule["ruleKey"], string> = {
  mrr_drop: "MRR drop",
  cancellation_spike: "Cancellation spike",
  payment_failure_spike: "Payment failure spike",
  recovery_rate_drop: "Recovery-rate drop",
  infrastructure_cost_spike: "Infrastructure-cost spike"
};

export function FinancialControls({ initialRules }: { initialRules: AlertRule[] }) {
  const [pending, startTransition] = useTransition();
  const [feedback, setFeedback] = useState("");
  const [rules, setRules] = useState(initialRules);
  const [provider, setProvider] = useState("Supabase");
  const [billingPeriod, setBillingPeriod] = useState(new Date().toISOString().slice(0, 7));
  const [currency, setCurrency] = useState("GHS");
  const [amount, setAmount] = useState("");
  const [category, setCategory] = useState<"database" | "hosting" | "email" | "sms" | "media_storage" | "push" | "api" | "other">("database");
  const [source, setSource] = useState<"manual" | "invoice" | "api">("invoice");
  const [notes, setNotes] = useState("");
  const [reason, setReason] = useState("");

  function saveCost() {
    startTransition(async () => {
      const result = await saveProviderCostAction({ provider, billingPeriod, currency, amount, category, source, notes, reason });
      setFeedback(result.message);
      if (result.ok) {
        setAmount("");
        setNotes("");
        setReason("");
      }
    });
  }

  function saveRules() {
    startTransition(async () => {
      const result = await updateBusinessAlertRulesAction({ rules, reason });
      setFeedback(result.message);
      if (result.ok) setReason("");
    });
  }

  function run(action: "snapshot" | "fees") {
    startTransition(async () => {
      const result = await runFinancialMaintenanceAction({ action, reason });
      setFeedback(result.message);
      if (result.ok) setReason("");
    });
  }

  return (
    <div className="grid gap-5 xl:grid-cols-2">
      <section className="rounded-2xl border border-border/70 bg-card p-4">
        <h3 className="text-sm font-semibold">Record provider cost</h3>
        <p className="mt-1 text-xs leading-5 text-muted-foreground">Enter a trusted invoice or provider total. Values stay separated by currency.</p>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <Field label="Provider"><input value={provider} onChange={(event) => setProvider(event.target.value)} maxLength={64} /></Field>
          <Field label="Billing month"><input type="month" value={billingPeriod} onChange={(event) => setBillingPeriod(event.target.value)} /></Field>
          <Field label="Currency"><input value={currency} onChange={(event) => setCurrency(event.target.value.toUpperCase())} maxLength={3} /></Field>
          <Field label="Amount"><input inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} placeholder="0.00" /></Field>
          <Field label="Category"><select value={category} onChange={(event) => setCategory(event.target.value as typeof category)}><option value="database">Database</option><option value="hosting">Hosting</option><option value="email">Email</option><option value="sms">SMS</option><option value="media_storage">Media storage</option><option value="push">Push</option><option value="api">API</option><option value="other">Other</option></select></Field>
          <Field label="Source"><select value={source} onChange={(event) => setSource(event.target.value as typeof source)}><option value="invoice">Invoice</option><option value="manual">Manual</option><option value="api">Provider API</option></select></Field>
          <Field label="Notes" className="sm:col-span-2"><input value={notes} onChange={(event) => setNotes(event.target.value)} maxLength={500} placeholder="Optional invoice context" /></Field>
        </div>
        <Button type="button" className="mt-4" disabled={pending || !amount || reason.trim().length < 3} onClick={saveCost}>Save cost</Button>
      </section>

      <section className="rounded-2xl border border-border/70 bg-card p-4">
        <h3 className="text-sm font-semibold">Business alert controls</h3>
        <p className="mt-1 text-xs leading-5 text-muted-foreground">Simple threshold comparisons only. These are not statistical anomaly detection.</p>
        <div className="mt-3 divide-y divide-border/60">
          {rules.map((rule, index) => (
            <div key={rule.ruleKey} className="flex items-center gap-3 py-3">
              <div className="min-w-0 flex-1"><p className="text-sm font-medium">{labels[rule.ruleKey]}</p><p className="text-xs text-muted-foreground">Alert at {rule.thresholdPercent}%</p></div>
              <input aria-label={`${labels[rule.ruleKey]} threshold percent`} type="number" min="1" max="1000" value={rule.thresholdPercent} onChange={(event) => setRules((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, thresholdPercent: Number(event.target.value) } : item))} className="focus-ring h-9 w-20 rounded-lg border border-border bg-background px-2 text-sm" />
              <AppSwitch checked={rule.enabled} label={`${rule.enabled ? "Disable" : "Enable"} ${labels[rule.ruleKey]}`} onCheckedChange={(enabled) => setRules((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, enabled } : item))} />
            </div>
          ))}
        </div>
        <Button type="button" variant="outline" disabled={pending || reason.trim().length < 3} onClick={saveRules}>Save alert controls</Button>
      </section>

      <section className="rounded-2xl border border-border/70 bg-card p-4 xl:col-span-2">
        <div className="flex flex-wrap items-end gap-3">
          <Field label="Reason for this financial change" className="min-w-[260px] flex-1"><input value={reason} onChange={(event) => setReason(event.target.value)} maxLength={500} placeholder="Recorded in the admin audit log" /></Field>
          <Button type="button" variant="outline" disabled={pending || reason.trim().length < 3} onClick={() => run("snapshot")}>Capture today</Button>
          <Button type="button" variant="outline" disabled={pending || reason.trim().length < 3} onClick={() => run("fees")}>Reconcile fees</Button>
        </div>
        {feedback ? <p className="mt-3 text-xs text-muted-foreground" role="status">{feedback}</p> : null}
      </section>
    </div>
  );
}

function Field({ label, className = "", children }: { label: string; className?: string; children: ReactElement<{ className?: string }> }) {
  return <label className={className}><span className="mb-1.5 block text-xs font-medium text-muted-foreground">{label}</span>{cloneElement(children, { className: `focus-ring h-10 w-full rounded-xl border border-border bg-background px-3 text-sm outline-none ${children.props.className ?? ""}` })}</label>;
}
