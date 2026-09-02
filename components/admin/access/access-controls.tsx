"use client";

import { useState, useTransition } from "react";

import {
  closeGlobalAccessAction,
  grantAccessAction,
  openGlobalAccessAction,
  revokeAccessAction
} from "@/app/(admin)/admin/access-actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/**
 * Admin controls for Mad Buddy Access -- the thing that actually unlocks Linkr
 * and UpFor.
 *
 * WHY THIS EXISTS. The server actions have been correct and audited since
 * 20260824, but nothing rendered them, so there was no way to grant Access from
 * Admin at all. An owner looking for one found the legacy premium-trial page
 * instead and granted a tier from it, which does not touch Access -- the
 * resolver reads access_grants, global windows, staff and live subscriptions,
 * and nothing else. The grant appeared to work and changed nothing.
 *
 * The durations offered here come from GRANT_DURATIONS on the server; the
 * server re-validates every one of them, so this list is a convenience and
 * never the authority.
 */

const DURATIONS = [
  { value: "7d", label: "7 days" },
  { value: "14d", label: "14 days" },
  { value: "30d", label: "30 days" },
  { value: "3m", label: "3 months" },
  { value: "1y", label: "1 year" },
  { value: "indefinite", label: "Indefinite" }
] as const;

type Result = { ok: boolean; message: string } | null;

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-semibold text-muted-foreground">{label}</span>
      {children}
      {hint ? <span className="mt-1 block text-xs text-muted-foreground">{hint}</span> : null}
    </label>
  );
}

function Outcome({ result }: { result: Result }) {
  if (!result) return null;
  return (
    <p
      role="status"
      className={`text-sm ${result.ok ? "text-[#2F6F6B]" : "text-destructive"}`}
    >
      {result.message}
    </p>
  );
}

export function GrantAccessForm() {
  const [result, setResult] = useState<Result>(null);
  const [pending, startTransition] = useTransition();

  return (
    <form
      className="grid gap-4 md:grid-cols-2"
      action={(formData) => {
        setResult(null);
        startTransition(async () => {
          setResult(
            await grantAccessAction({
              userId: String(formData.get("userId") ?? "").trim(),
              duration: String(formData.get("duration") ?? "14d"),
              reason: String(formData.get("reason") ?? "").trim()
            }).catch(() => ({ ok: false, message: "The grant could not be saved. Try again." }))
          );
        });
      }}
    >
      <Field label="User ID" hint="The account's UUID, from the Users screen.">
        <Input name="userId" required placeholder="00000000-0000-0000-0000-000000000000" />
      </Field>
      <Field label="Duration">
        <select name="duration" defaultValue="14d" className="input-shell h-11 w-full px-3">
          {DURATIONS.map((duration) => (
            <option key={duration.value} value={duration.value}>
              {duration.label}
            </option>
          ))}
        </select>
      </Field>
      <div className="md:col-span-2">
        <Field label="Reason" hint="Recorded in the audit log. Say why, not what.">
          <Input name="reason" required minLength={3} maxLength={500} placeholder="Support: access ended mid-conversation" />
        </Field>
      </div>
      <div className="flex items-center gap-3 md:col-span-2">
        <Button type="submit" disabled={pending}>
          {pending ? "Granting…" : "Grant Access"}
        </Button>
        <Outcome result={result} />
      </div>
    </form>
  );
}

export function RevokeAccessForm() {
  const [result, setResult] = useState<Result>(null);
  const [pending, startTransition] = useTransition();

  return (
    <form
      className="grid gap-4 md:grid-cols-2"
      action={(formData) => {
        setResult(null);
        startTransition(async () => {
          setResult(
            await revokeAccessAction({
              userId: String(formData.get("userId") ?? "").trim(),
              reason: String(formData.get("reason") ?? "").trim()
            }).catch(() => ({ ok: false, message: "The revoke could not be saved. Try again." }))
          );
        });
      }}
    >
      <Field label="User ID">
        <Input name="userId" required placeholder="00000000-0000-0000-0000-000000000000" />
      </Field>
      <Field label="Reason">
        <Input name="reason" required minLength={3} maxLength={500} placeholder="Granted in error" />
      </Field>
      <div className="flex items-center gap-3 md:col-span-2">
        <Button type="submit" variant="outline" disabled={pending}>
          {pending ? "Revoking…" : "Revoke admin grants"}
        </Button>
        <Outcome result={result} />
      </div>
      {/* Says exactly what it touches. Revoking an admin grant does not cancel a
          subscription, end Welcome Access or remove staff access, and an admin
          who assumes otherwise will think the revoke failed. */}
      <p className="text-xs text-muted-foreground md:col-span-2">
        Revokes admin grants only. A live subscription, Welcome Access, staff access or an open
        global window each keep this person&apos;s access on their own.
      </p>
    </form>
  );
}

export function GlobalAccessForm({ openWindowId }: { openWindowId: string | null }) {
  const [result, setResult] = useState<Result>(null);
  const [pending, startTransition] = useTransition();

  if (openWindowId) {
    return (
      <form
        className="grid gap-4 md:grid-cols-2"
        action={(formData) => {
          setResult(null);
          startTransition(async () => {
            setResult(
              await closeGlobalAccessAction({
                windowId: openWindowId,
                reason: String(formData.get("reason") ?? "").trim()
              }).catch(() => ({ ok: false, message: "The window could not be closed. Try again." }))
            );
          });
        }}
      >
        <div className="md:col-span-2">
          <Field label="Reason for closing">
            <Input name="reason" required minLength={3} maxLength={500} placeholder="Promotion ended" />
          </Field>
        </div>
        <div className="flex items-center gap-3 md:col-span-2">
          <Button type="submit" variant="outline" disabled={pending}>
            {pending ? "Closing…" : "Close global access"}
          </Button>
          <Outcome result={result} />
        </div>
        <p className="text-xs text-muted-foreground md:col-span-2">
          Closing returns everybody to whatever they hold on their own. Nobody who has a
          subscription, a grant or Welcome Access loses anything.
        </p>
      </form>
    );
  }

  return (
    <form
      className="grid gap-4 md:grid-cols-2"
      action={(formData) => {
        setResult(null);
        startTransition(async () => {
          setResult(
            await openGlobalAccessAction({
              duration: String(formData.get("duration") ?? "7d"),
              reason: String(formData.get("reason") ?? "").trim()
            }).catch(() => ({ ok: false, message: "The window could not be opened. Try again." }))
          );
        });
      }}
    >
      <Field label="Duration">
        <select name="duration" defaultValue="7d" className="input-shell h-11 w-full px-3">
          {DURATIONS.map((duration) => (
            <option key={duration.value} value={duration.value}>
              {duration.label}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Reason">
        <Input name="reason" required minLength={3} maxLength={500} placeholder="Launch week promotion" />
      </Field>
      <div className="flex items-center gap-3 md:col-span-2">
        <Button type="submit" disabled={pending}>
          {pending ? "Opening…" : "Open global access"}
        </Button>
        <Outcome result={result} />
      </div>
      <p className="text-xs text-muted-foreground md:col-span-2">
        Gives Linkr and UpFor to <strong>everyone</strong> for this window. One row — it never
        touches individual accounts, so closing it restores each person to their own sources.
      </p>
    </form>
  );
}
