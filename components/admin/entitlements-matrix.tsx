"use client";

import { useState, useTransition } from "react";
import { Check, RotateCcw } from "lucide-react";
import { resetTierEntitlementAction, setTierEntitlementAction } from "@/app/(admin)/admin/entitlements/actions";
import { AdminSection } from "@/components/admin/admin-ui";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export type SubscriptionTier = "free" | "buddy_plus" | "buddy_pro";
type NumericCell = { unlimited: boolean; value: number; overridden: boolean };
type BooleanCell = { value: boolean; overridden: boolean };

export type MatrixData = {
  canManage: boolean;
  numeric: { key: string; label: string; cells: Record<SubscriptionTier, NumericCell> }[];
  boolean: { key: string; label: string; cells: Record<SubscriptionTier, BooleanCell> }[];
};

const TIERS: { id: SubscriptionTier; label: string }[] = [
  { id: "free", label: "Free" },
  { id: "buddy_plus", label: "Buddy Plus" },
  { id: "buddy_pro", label: "Buddy Pro" }
];

export function EntitlementsMatrix({ data }: { data: MatrixData }) {
  const [feedback, setFeedback] = useState<{ ok: boolean; text: string } | null>(null);

  return (
    <div className="space-y-5">
      {feedback ? (
        <div className={cn("rounded-xl border p-3 text-sm", feedback.ok ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-200" : "border-amber-500/30 bg-amber-500/10 text-amber-100")} role="status">
          {feedback.text}
        </div>
      ) : null}

      <AdminSection title="Limits" description="Numeric caps per tier. Toggle ∞ for unlimited.">
        <Card className="overflow-x-auto p-0">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="border-b border-border/70 bg-secondary/25 text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                <th className="px-4 py-3 font-semibold">Entitlement</th>
                {TIERS.map((tier) => <th key={tier.id} className="px-4 py-3 font-semibold">{tier.label}</th>)}
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60">
              {data.numeric.map((row) => (
                <tr key={row.key}>
                  <td className="px-4 py-3 align-top font-medium">{row.label}</td>
                  {TIERS.map((tier) => (
                    <td key={tier.id} className="px-4 py-3 align-top">
                      <NumericEditor
                        entitlementKey={row.key}
                        plan={tier.id}
                        cell={row.cells[tier.id]}
                        canManage={data.canManage}
                        onFeedback={setFeedback}
                      />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      </AdminSection>

      <AdminSection title="Features" description="On/off features per tier.">
        <Card className="overflow-x-auto p-0">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="border-b border-border/70 bg-secondary/25 text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                <th className="px-4 py-3 font-semibold">Feature</th>
                {TIERS.map((tier) => <th key={tier.id} className="px-4 py-3 font-semibold">{tier.label}</th>)}
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60">
              {data.boolean.map((row) => (
                <tr key={row.key}>
                  <td className="px-4 py-3 align-top font-medium">{row.label}</td>
                  {TIERS.map((tier) => (
                    <td key={tier.id} className="px-4 py-3 align-top">
                      <BooleanEditor
                        entitlementKey={row.key}
                        plan={tier.id}
                        cell={row.cells[tier.id]}
                        canManage={data.canManage}
                        onFeedback={setFeedback}
                      />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      </AdminSection>
    </div>
  );
}

type FeedbackFn = (f: { ok: boolean; text: string }) => void;

function NumericEditor({ entitlementKey, plan, cell, canManage, onFeedback }: { entitlementKey: string; plan: SubscriptionTier; cell: NumericCell; canManage: boolean; onFeedback: FeedbackFn }) {
  const [unlimited, setUnlimited] = useState(cell.unlimited);
  const [value, setValue] = useState(String(cell.value));
  const [pending, start] = useTransition();
  const dirty = unlimited !== cell.unlimited || (!unlimited && Number(value) !== cell.value);

  function save() {
    start(async () => {
      const result = await setTierEntitlementAction({ plan, key: entitlementKey, unlimited, numericValue: unlimited ? null : Math.max(0, Math.floor(Number(value) || 0)) });
      onFeedback({ ok: result.ok, text: result.message });
    });
  }
  function reset() {
    start(async () => {
      const result = await resetTierEntitlementAction({ plan, key: entitlementKey });
      onFeedback({ ok: result.ok, text: result.message });
    });
  }

  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-1.5">
        <Input
          type="number"
          min={0}
          value={unlimited ? "" : value}
          disabled={!canManage || unlimited || pending}
          onChange={(event) => setValue(event.target.value)}
          className="h-8 w-24 px-2 text-sm"
          aria-label={`${entitlementKey} for ${plan}`}
        />
        <button
          type="button"
          disabled={!canManage || pending}
          onClick={() => setUnlimited((v) => !v)}
          className={cn("focus-ring h-8 rounded-md border px-2 text-xs font-medium", unlimited ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground")}
          title="Unlimited"
        >
          ∞
        </button>
      </div>
      {canManage ? (
        <div className="flex items-center gap-2">
          {dirty ? (
            <Button type="button" size="sm" className="h-7 px-2 text-xs" disabled={pending} onClick={save}>
              <Check className="h-3.5 w-3.5" aria-hidden="true" /> Save
            </Button>
          ) : null}
          {cell.overridden ? (
            <button type="button" disabled={pending} onClick={reset} className="focus-ring inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground">
              <RotateCcw className="h-3 w-3" aria-hidden="true" /> Reset
            </button>
          ) : (
            <span className="text-[11px] text-muted-foreground">Default</span>
          )}
        </div>
      ) : (
        <span className="text-[11px] text-muted-foreground">{cell.overridden ? "Custom" : "Default"}</span>
      )}
    </div>
  );
}

function BooleanEditor({ entitlementKey, plan, cell, canManage, onFeedback }: { entitlementKey: string; plan: SubscriptionTier; cell: BooleanCell; canManage: boolean; onFeedback: FeedbackFn }) {
  const [pending, start] = useTransition();

  function toggle(next: boolean) {
    start(async () => {
      const result = await setTierEntitlementAction({ plan, key: entitlementKey, booleanValue: next });
      onFeedback({ ok: result.ok, text: result.message });
    });
  }
  function reset() {
    start(async () => {
      const result = await resetTierEntitlementAction({ plan, key: entitlementKey });
      onFeedback({ ok: result.ok, text: result.message });
    });
  }

  return (
    <div className="space-y-1.5">
      <button
        type="button"
        role="switch"
        aria-checked={cell.value}
        aria-label={`${entitlementKey} for ${plan}`}
        disabled={!canManage || pending}
        onClick={() => toggle(!cell.value)}
        className={cn("relative h-6 w-11 shrink-0 rounded-full transition-colors disabled:opacity-60", cell.value ? "bg-primary" : "bg-secondary")}
      >
        <span className={cn("absolute top-0.5 h-5 w-5 rounded-full bg-white transition-transform", cell.value ? "translate-x-5" : "translate-x-0.5")} />
      </button>
      {canManage && cell.overridden ? (
        <button type="button" disabled={pending} onClick={reset} className="focus-ring flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground">
          <RotateCcw className="h-3 w-3" aria-hidden="true" /> Reset
        </button>
      ) : (
        <span className="text-[11px] text-muted-foreground">{cell.overridden ? "Custom" : "Default"}</span>
      )}
    </div>
  );
}
