"use client";

import { useActionState } from "react";
import {
  changeExperimentStatusAction,
  changeExperimentTesterAction,
  createExperimentAction,
  type ExperimentActionState
} from "@/app/(admin)/admin/experiments/actions";
import { EXPERIMENT_METRICS } from "@/lib/experiments/model";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

const initial: ExperimentActionState = { ok: false, message: "" };

export function ExperimentCreateForm({
  featureFlags
}: {
  featureFlags: Array<{ id: string; key: string; description: string | null }>;
}) {
  const [state, action, pending] = useActionState(createExperimentAction, initial);
  return (
    <form action={action} className="grid gap-5">
      <div className="grid gap-4 md:grid-cols-2">
        <Field label="Experiment key" hint="Stable lowercase key used by application code.">
          <Input name="key" required pattern="[a-z][a-z0-9_]{2,63}" placeholder="premium_cta_copy" />
        </Field>
        <Field label="Name">
          <Input name="name" required minLength={3} maxLength={100} placeholder="Premium CTA copy" />
        </Field>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <Field label="Description">
          <Textarea name="description" required minLength={3} maxLength={500} className="min-h-24" />
        </Field>
        <Field label="Hypothesis">
          <Textarea name="hypothesis" required minLength={3} maxLength={1000} className="min-h-24" />
        </Field>
      </div>

      <fieldset className="grid gap-4 rounded-2xl border border-border/70 p-4 md:grid-cols-3">
        <legend className="px-2 text-sm font-semibold">Audience and release</legend>
        <Field label="Parent feature flag" hint="An off flag always overrides the experiment.">
          <select name="parentFeatureFlagId" defaultValue="" className="input-shell h-11 w-full px-3">
            <option value="">Core surface, no optional flag</option>
            {featureFlags.map((flag) => <option key={flag.id} value={flag.id}>{flag.key}</option>)}
          </select>
        </Field>
        <Field label="Eligible allocation">
          <Input name="allocationPercentage" type="number" min={1} max={100} defaultValue={100} required />
        </Field>
        <Field label="Audience">
          <select name="audience" defaultValue="all_eligible" className="input-shell h-11 w-full px-3">
            <option value="all_eligible">All eligible accounts</option>
            <option value="selected_testers">Selected testers only</option>
          </select>
        </Field>
        <Field label="Conflict group" hint="Optional. Prevents overlapping changes to one surface.">
          <Input name="conflictGroup" pattern="[a-z][a-z0-9_]*" placeholder="premium_cta" />
        </Field>
        <Field label="Scheduled start">
          <Input name="startsAt" type="datetime-local" />
        </Field>
        <Field label="Scheduled end">
          <Input name="endsAt" type="datetime-local" />
        </Field>
        <CheckGroup
          legend="Platforms"
          name="platforms"
          options={[["web", "Web and PWA"], ["android", "Android"], ["ios", "iOS"]]}
          defaults={["web", "android", "ios"]}
        />
        <CheckGroup
          legend="Subscription tiers"
          name="plans"
          options={[["free", "Free"], ["buddy_plus", "Buddy Plus"], ["buddy_pro", "Buddy Pro"]]}
          defaults={["free", "buddy_plus", "buddy_pro"]}
        />
      </fieldset>

      <fieldset className="grid gap-4 rounded-2xl border border-border/70 p-4 md:grid-cols-3">
        <legend className="px-2 text-sm font-semibold">Variants</legend>
        <VariantFields prefix="control" title="Control" defaultName="Control" defaultWeight={50} />
        <VariantFields prefix="variantA" title="Variant A" defaultName="Variant A" defaultWeight={50} />
        <VariantFields prefix="variantB" title="Variant B, optional" defaultName="" />
      </fieldset>

      <fieldset className="grid gap-4 rounded-2xl border border-border/70 p-4 md:grid-cols-3">
        <legend className="px-2 text-sm font-semibold">Success and guardrails</legend>
        <Field label="Primary metric">
          <select name="primaryMetric" defaultValue="meaningful_interaction" className="input-shell h-11 w-full px-3">
            {EXPERIMENT_METRICS.map((metric) => <option key={metric.key} value={metric.key}>{metric.label}</option>)}
          </select>
        </Field>
        <MetricSelect name="secondaryMetrics" label="Secondary metrics" />
        <MetricSelect name="guardrailMetrics" label="Guardrail metrics" />
      </fieldset>

      <ActionFooter pending={pending} state={state} label="Create draft" />
    </form>
  );
}

export function ExperimentLifecycleForm({
  experimentId,
  actions
}: {
  experimentId: string;
  actions: ReadonlyArray<"schedule" | "start" | "pause" | "resume" | "stop" | "cancel" | "emergency_stop">;
}) {
  const [state, action, pending] = useActionState(changeExperimentStatusAction, initial);
  return (
    <form action={action} className="grid gap-3 rounded-2xl border border-border/70 p-4 sm:grid-cols-[180px_1fr_140px_auto] sm:items-end">
      <input type="hidden" name="experimentId" value={experimentId} />
      <Field label="Lifecycle action">
        <select name="action" className="input-shell h-11 w-full px-3">
          {actions.map((item) => (
            <option key={item} value={item}>
              {item === "emergency_stop" ? "Emergency stop" : title(item)}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Reason">
        <Input name="reason" required minLength={3} maxLength={500} placeholder="Required audit reason" />
      </Field>
      <Field label="Confirmation">
        <Input name="confirmation" required pattern="CONFIRM" placeholder="CONFIRM" autoComplete="off" />
      </Field>
      <Button type="submit" variant={actions.includes("emergency_stop") ? "danger" : "primary"} disabled={pending}>
        {pending ? "Applying..." : "Apply"}
      </Button>
      {state.message ? (
        <p className={state.ok ? "text-sm text-emerald-500 sm:col-span-full" : "text-sm text-destructive sm:col-span-full"} role="status">
          {state.message}
        </p>
      ) : null}
    </form>
  );
}

export function ExperimentTesterForm({ experimentId }: { experimentId: string }) {
  const [state, action, pending] = useActionState(changeExperimentTesterAction, initial);
  return (
    <form action={action} className="grid gap-3 sm:grid-cols-[1fr_140px_1fr_auto] sm:items-end">
      <input type="hidden" name="experimentId" value={experimentId} />
      <Field label="User ID or username">
        <Input name="account" required placeholder="@username or UUID" />
      </Field>
      <Field label="Operation">
        <select name="operation" className="input-shell h-11 w-full px-3">
          <option value="add">Add tester</option>
          <option value="remove">Remove tester</option>
        </select>
      </Field>
      <Field label="Reason">
        <Input name="reason" required minLength={3} maxLength={500} />
      </Field>
      <Button type="submit" disabled={pending}>{pending ? "Saving..." : "Update"}</Button>
      {state.message ? (
        <p className={state.ok ? "text-sm text-emerald-500 sm:col-span-full" : "text-sm text-destructive sm:col-span-full"} role="status">
          {state.message}
        </p>
      ) : null}
    </form>
  );
}

function VariantFields({
  prefix,
  title: heading,
  defaultName,
  defaultWeight
}: {
  prefix: "control" | "variantA" | "variantB";
  title: string;
  defaultName: string;
  defaultWeight?: number;
}) {
  return (
    <div className="grid gap-3 rounded-xl bg-secondary/35 p-3">
      <p className="text-sm font-semibold">{heading}</p>
      <Field label="Name">
        <Input name={`${prefix}Name`} defaultValue={defaultName} required={prefix !== "variantB"} />
      </Field>
      <Field label="Description">
        <Input name={`${prefix}Description`} placeholder="What changes for this variant" />
      </Field>
      <Field label="Allocation percent">
        <Input name={`${prefix}Weight`} type="number" min={1} max={99} defaultValue={defaultWeight} required={prefix !== "variantB"} />
      </Field>
    </div>
  );
}

function MetricSelect({ name, label }: { name: string; label: string }) {
  return (
    <Field label={label} hint="Use Ctrl or Command to choose more than one.">
      <select name={name} multiple className="input-shell min-h-32 w-full px-3 py-2">
        {EXPERIMENT_METRICS.map((metric) => <option key={metric.key} value={metric.key}>{metric.label}</option>)}
      </select>
    </Field>
  );
}

function CheckGroup({
  legend,
  name,
  options,
  defaults
}: {
  legend: string;
  name: string;
  options: Array<[string, string]>;
  defaults: string[];
}) {
  return (
    <fieldset className="rounded-xl border border-border/60 p-3">
      <legend className="px-1 text-sm font-medium">{legend}</legend>
      <div className="mt-1 grid gap-2">
        {options.map(([value, label]) => (
          <label key={value} className="flex items-center gap-2 text-sm">
            <input name={name} value={value} type="checkbox" defaultChecked={defaults.includes(value)} className="h-4 w-4 accent-primary" />
            {label}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="grid gap-1.5 text-sm font-medium">
      {label}
      {children}
      {hint ? <span className="text-xs font-normal leading-5 text-muted-foreground">{hint}</span> : null}
    </label>
  );
}

function ActionFooter({ pending, state, label }: { pending: boolean; state: ExperimentActionState; label: string }) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <Button type="submit" disabled={pending}>{pending ? "Creating..." : label}</Button>
      {state.message ? (
        <p className={state.ok ? "text-sm text-emerald-500" : "text-sm text-destructive"} role="status">{state.message}</p>
      ) : null}
    </div>
  );
}

function title(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1).replaceAll("_", " ");
}
