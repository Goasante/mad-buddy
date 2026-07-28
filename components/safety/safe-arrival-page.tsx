"use client";

import { ShieldCheck, ChevronRight, Check, Info } from "lucide-react";
import { useEffect, useId, useMemo, useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  acknowledgeSafeArrivalAction,
  cancelSafeArrivalAction,
  confirmSafeArrivalAction,
  createSafeArrivalAction,
  extendSafeArrivalAction
} from "@/app/(app)/safe-arrival-actions";
import { FormField } from "@/components/auth/form-field";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { GlowAvatar } from "@/components/glow/glow-avatar";
import { UserAvatar } from "@/components/ui/user-avatar";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { JourneyStatusCard } from "@/components/safety/journey-status-card";
import { useReducedMotion } from "@/hooks/use-reduced-motion";
import { EXTENSION_OPTIONS_MINUTES } from "@/lib/safety/safe-arrival";
import { resolveJourneyState } from "@/lib/safety/journey-status";
import type { SafeArrivalStatus } from "@/lib/supabase/database.types";
import { cn } from "@/lib/utils";

function journeyTiming(session: SafeArrivalSessionSummary) {
  return {
    expectedArrivalMs: Date.parse(session.expectedArrivalAt),
    gracePeriodMinutes: session.gracePeriodMinutes,
    nowMs: Date.now()
  };
}

export type SafeArrivalContactOption = { id: string; name: string; isCloseFriend: boolean };

export type SafeArrivalWatcher = { id: string; name: string; avatarUrl: string | null };

export type SafeArrivalSessionSummary = {
  id: string;
  destinationLabel: string;
  expectedArrivalAt: string;
  gracePeriodMinutes: number;
  note: string | null;
  status: string;
  travellerName: string;
  isTraveller: boolean;
  myAcknowledgement: string | null;
  startedAt?: string;
  watchers?: SafeArrivalWatcher[];
  sharedCount?: number;
};

const gracePeriodOptions = [10, 20, 30, 60];

/** "Today · 9:00 PM" / "Tomorrow · 12:30 AM" / "Fri · 6:15 PM" — never a raw ISO string. */
function friendlyDateTime(iso: string): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const startOfDay = (value: Date) => new Date(value.getFullYear(), value.getMonth(), value.getDate()).getTime();
  const diffDays = Math.round((startOfDay(date) - startOfDay(new Date())) / 86_400_000);
  const dayLabel =
    diffDays === 0 ? "Today" : diffDays === 1 ? "Tomorrow" : date.toLocaleDateString([], { weekday: "short" });
  const timeLabel = date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  return `${dayLabel} · ${timeLabel}`;
}

function minutesLeftLabel(expectedArrivalMs: number, nowMs: number): string | null {
  const minutes = Math.round((expectedArrivalMs - nowMs) / 60_000);
  if (minutes <= 0) return null;
  if (minutes < 60) return `${minutes} min left`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours}h left` : `${hours}h ${rest}m left`;
}

export function SafeArrivalPage({
  mySessions = [],
  watching = [],
  contacts = []
}: {
  mySessions?: SafeArrivalSessionSummary[];
  watching?: SafeArrivalSessionSummary[];
  contacts?: SafeArrivalContactOption[];
}) {
  const router = useRouter();
  const requestedSessionId = useSearchParams().get("session");
  const [createOpen, setCreateOpen] = useState(false);
  const [toast, setToast] = useState("");
  const [arrivedFlourish, setArrivedFlourish] = useState<{ watcherNames: string[] } | null>(null);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(""), 4000);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const activeSession = useMemo(
    () => mySessions.find((session) => resolveJourneyState(session.status as SafeArrivalStatus).isLive),
    [mySessions]
  );

  function run(action: () => Promise<{ ok: boolean; message: string }>) {
    startTransition(async () => {
      const result = await action();
      setToast(result.message);
      if (result.ok) router.refresh();
    });
  }

  function handleConfirmArrival(session: SafeArrivalSessionSummary) {
    startTransition(async () => {
      const result = await confirmSafeArrivalAction(session.id);
      if (result.ok) {
        setArrivedFlourish({ watcherNames: (session.watchers ?? []).map((watcher) => watcher.name) });
        router.refresh();
      } else {
        setToast(result.message);
      }
    });
  }

  return (
    <div className="mx-auto max-w-[560px] space-y-6 pt-6">
      <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Safe Arrival</h1>

      {toast ? (
        <div
          className="rounded-[1rem] border border-orange-400/20 bg-orange-400/10 p-3 text-sm text-orange-800 dark:text-orange-50"
          role="status"
        >
          {toast}
        </div>
      ) : null}

      {arrivedFlourish ? (
        <ArrivedFlourish watcherNames={arrivedFlourish.watcherNames} onDone={() => setArrivedFlourish(null)} />
      ) : activeSession ? (
        <ActiveJourneyView
          session={activeSession}
          isPending={isPending}
          onConfirmArrival={() => handleConfirmArrival(activeSession)}
          onExtend={(minutes) => run(() => extendSafeArrivalAction(activeSession.id, minutes))}
          onCancel={() => run(() => cancelSafeArrivalAction(activeSession.id))}
        />
      ) : (
        <OffState onStart={() => setCreateOpen(true)} />
      )}

      {watching.length > 0 ? (
        <section>
          <h2 className="mb-3 text-sm font-semibold">You&apos;re checking on</h2>
          <div className="space-y-3">
            {watching.map((session) => (
              <Card
                key={session.id}
                id={`safe-arrival-${session.id}`}
                className={cn("p-4", requestedSessionId === session.id && "ring-2 ring-primary/35")}
              >
                <JourneyStatusCard
                  role="watcher"
                  sessionId={session.id}
                  status={session.status as SafeArrivalStatus}
                  timing={journeyTiming(session)}
                  travellerName={session.travellerName}
                >
                  <div className="text-sm text-muted-foreground">
                    {session.travellerName} → {session.destinationLabel}
                  </div>
                </JourneyStatusCard>
                {session.myAcknowledgement === "pending" ? (
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Button
                      type="button"
                      size="sm"
                      onClick={() => run(() => acknowledgeSafeArrivalAction(session.id, "watching"))}
                      disabled={isPending}
                    >
                      I&apos;ll watch your journey
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => run(() => acknowledgeSafeArrivalAction(session.id, "declined"))}
                      disabled={isPending}
                    >
                      Can&apos;t this time
                    </Button>
                  </div>
                ) : null}
              </Card>
            ))}
          </div>
        </section>
      ) : null}

      <CreateSafeArrivalModal
        open={createOpen}
        contacts={contacts}
        pending={isPending}
        onOpenChange={setCreateOpen}
        onCreate={(input) =>
          startTransition(async () => {
            const result = await createSafeArrivalAction(input);
            setToast(result.message);
            if (result.ok) {
              setCreateOpen(false);
              router.refresh();
            }
          })
        }
      />
    </div>
  );
}

function OffState({ onStart }: { onStart: () => void }) {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-6 py-10 text-center">
      <div>
        <p className="text-base font-medium">Let trusted Muddies know you got there safely.</p>
      </div>

      <span className="journey-mark journey-mark-idle relative grid h-24 w-24 place-items-center rounded-full" aria-hidden="true">
        <ShieldCheck className="h-10 w-10" />
      </span>

      <p className="text-lg font-semibold">Ready to head out?</p>

      <Button type="button" size="lg" onClick={onStart} className="min-w-[220px]">
        Start Safe Arrival
      </Button>

      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <ShieldCheck className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        Private · No live location shared
      </p>
    </div>
  );
}

function ArrivedFlourish({ watcherNames, onDone }: { watcherNames: string[]; onDone: () => void }) {
  const notifiedLabel =
    watcherNames.length === 0
      ? "Your trusted Muddies have been notified."
      : watcherNames.length === 1
        ? `${watcherNames[0]} has been notified.`
        : watcherNames.length === 2
          ? `${watcherNames[0]} and ${watcherNames[1]} have been notified.`
          : `${watcherNames[0]}, ${watcherNames[1]}, and ${watcherNames.length - 2} more have been notified.`;

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 py-10 text-center">
      <span className="journey-mark journey-mark-arrived relative grid h-20 w-20 place-items-center rounded-full">
        <Check className="h-9 w-9" aria-hidden="true" />
      </span>
      <p className="text-lg font-semibold">You arrived safely</p>
      <p className="max-w-xs text-sm text-muted-foreground">{notifiedLabel}</p>
      <Button type="button" onClick={onDone} className="mt-2 min-w-[160px]">
        Done
      </Button>
    </div>
  );
}

function ActiveJourneyView({
  session,
  isPending,
  onConfirmArrival,
  onExtend,
  onCancel
}: {
  session: SafeArrivalSessionSummary;
  isPending: boolean;
  onConfirmArrival: () => void;
  onExtend: (minutes: number) => void;
  onCancel: () => void;
}) {
  const reducedMotion = useReducedMotion();
  const [moreOpen, setMoreOpen] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [nowMs, setNowMs] = useState(() => Date.now());

  // Re-render every 30s so the countdown/progress stay current without polling.
  useEffect(() => {
    const interval = window.setInterval(() => setNowMs(Date.now()), 30_000);
    return () => window.clearInterval(interval);
  }, []);

  const journey = resolveJourneyState(session.status as SafeArrivalStatus, journeyTiming(session));
  const expectedArrivalMs = Date.parse(session.expectedArrivalAt);
  const startedAtMs = session.startedAt ? Date.parse(session.startedAt) : undefined;
  const remaining = minutesLeftLabel(expectedArrivalMs, nowMs);

  const progressPct = (() => {
    if (!startedAtMs || !Number.isFinite(startedAtMs) || !Number.isFinite(expectedArrivalMs)) return 0;
    const total = expectedArrivalMs - startedAtMs;
    if (total <= 0) return 100;
    return Math.min(100, Math.max(0, ((nowMs - startedAtMs) / total) * 100));
  })();

  const motionClass = reducedMotion ? "" : journey.motion === "active" ? "journey-mark-active" : journey.motion === "waiting" ? "journey-mark-waiting" : "";
  const watchers = session.watchers ?? [];
  const extraExtensions = EXTENSION_OPTIONS_MINUTES.filter((minutes) => minutes !== 10 && minutes !== 20);

  return (
    <div className="flex flex-col items-center gap-5 py-2 text-center">
      <span
        className={cn("journey-mark relative grid h-20 w-20 place-items-center rounded-full", `journey-mark-${journey.key}`, motionClass)}
        aria-hidden="true"
      >
        <ShieldCheck className="h-9 w-9" />
      </span>

      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-primary">{journey.status}</p>
        <h2 className="mt-1 text-2xl font-semibold tracking-tight">{session.destinationLabel}</h2>
        <p className="mt-1.5 text-sm text-muted-foreground">
          Expected {friendlyDateTime(session.expectedArrivalAt)}
          {remaining ? ` · ${remaining}` : ""}
        </p>
      </div>

      {startedAtMs ? (
        <div className="w-full max-w-xs">
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-secondary">
            <div className="h-full rounded-full bg-primary transition-[width]" style={{ width: `${progressPct}%` }} />
          </div>
          <div className="mt-1.5 flex justify-between text-[0.6875rem] text-muted-foreground">
            <span>Started</span>
            <span>Expected arrival</span>
          </div>
        </div>
      ) : null}

      {watchers.length > 0 ? (
        <div className="flex items-center gap-2">
          <div className="flex -space-x-2">
            {watchers.slice(0, 4).map((watcher) => (
              <span
                key={watcher.id}
                className={cn("journey-watcher rounded-full ring-2 ring-card", !reducedMotion && "journey-watcher-pulse")}
                title={watcher.name}
              >
                <UserAvatar src={watcher.avatarUrl} name={watcher.name} size="sm" decorative />
              </span>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">
            Watching over you · {watchers.length} {watchers.length === 1 ? "Muddy" : "Muddies"}
          </p>
        </div>
      ) : null}

      <Button type="button" size="lg" onClick={onConfirmArrival} disabled={isPending} className="min-w-[240px]">
        I&apos;ve arrived safely
      </Button>

      <div className="flex flex-wrap items-center justify-center gap-2">
        {EXTENSION_OPTIONS_MINUTES.slice(0, 2).map((minutes) => (
          <Button key={minutes} type="button" size="sm" variant="outline" onClick={() => onExtend(minutes)} disabled={isPending}>
            +{minutes}m
          </Button>
        ))}
        {extraExtensions.length > 0 ? (
          <Button type="button" size="sm" variant="outline" onClick={() => setMoreOpen((value) => !value)} disabled={isPending}>
            More
          </Button>
        ) : null}
      </div>

      {moreOpen ? (
        <div className="flex flex-wrap items-center justify-center gap-2">
          {extraExtensions.map((minutes) => (
            <Button key={minutes} type="button" size="sm" variant="outline" onClick={() => onExtend(minutes)} disabled={isPending}>
              +{minutes}m
            </Button>
          ))}
        </div>
      ) : null}

      {confirmCancel ? (
        <div className="flex items-center gap-2 text-sm">
          <span className="text-muted-foreground">Cancel this Safe Arrival?</span>
          <Button type="button" size="sm" variant="danger" onClick={onCancel} disabled={isPending}>
            Yes, cancel
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={() => setConfirmCancel(false)}>
            Never mind
          </Button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setConfirmCancel(true)}
          disabled={isPending}
          className="focus-ring safe-motion text-xs font-medium text-muted-foreground underline-offset-2 hover:text-destructive hover:underline"
        >
          Cancel Safe Arrival
        </button>
      )}
    </div>
  );
}

function CreateSafeArrivalModal({
  open,
  contacts,
  pending,
  onOpenChange,
  onCreate
}: {
  open: boolean;
  contacts: SafeArrivalContactOption[];
  pending: boolean;
  onOpenChange: (open: boolean) => void;
  onCreate: (input: {
    destinationLabel: string;
    expectedArrivalAt: string;
    gracePeriodMinutes: number;
    note?: string;
    contactIds: string[];
  }) => void;
}) {
  const [destination, setDestination] = useState("");
  const [date, setDate] = useState("");
  const [time, setTime] = useState("");
  const [grace, setGrace] = useState(20);
  const [note, setNote] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const formId = useId();

  function reset() {
    setDestination("");
    setDate("");
    setTime("");
    setGrace(20);
    setNote("");
    setSelected([]);
    setPickerOpen(false);
  }

  function handleOpenChange(next: boolean) {
    onOpenChange(next);
    if (!next) reset();
  }

  function toggle(id: string) {
    setSelected((current) => (current.includes(id) ? current.filter((entry) => entry !== id) : [...current, id]));
  }

  const arrivalIso = date && time ? new Date(`${date}T${time}`).toISOString() : "";
  const canCreate = destination.trim().length > 0 && arrivalIso.length > 0 && selected.length > 0;
  const selectedContacts = contacts.filter((contact) => selected.includes(contact.id));

  return (
    <Modal
      open={open}
      onOpenChange={handleOpenChange}
      title="Start Safe Arrival"
      variant="sheet"
      compact
      footer={
        <Button
          type="button"
          className="w-full"
          disabled={!canCreate || pending}
          onClick={() =>
            onCreate({
              destinationLabel: destination.trim(),
              expectedArrivalAt: arrivalIso,
              gracePeriodMinutes: grace,
              note: note.trim() || undefined,
              contactIds: selected
            })
          }
        >
          Start Safe Arrival
        </Button>
      }
    >
      <div className="space-y-4">
        <FormField htmlFor={`${formId}-destination`} label="Where are you heading?">
          <Input
            id={`${formId}-destination`}
            value={destination}
            onChange={(event) => setDestination(event.target.value)}
            placeholder="e.g. Home, East Legon"
          />
        </FormField>

        <div>
          <p className="mb-1.5 text-sm font-medium text-foreground">Expected arrival</p>
          <div className="flex gap-2">
            <input
              type="date"
              value={date}
              onChange={(event) => setDate(event.target.value)}
              className="focus-ring safe-motion h-11 w-1/2 rounded-md border border-border bg-card/70 px-3 text-sm"
            />
            <input
              type="time"
              value={time}
              onChange={(event) => setTime(event.target.value)}
              className="focus-ring safe-motion h-11 w-1/2 rounded-md border border-border bg-card/70 px-3 text-sm"
            />
          </div>
          {arrivalIso ? <p className="mt-1.5 text-xs text-muted-foreground">{friendlyDateTime(arrivalIso)}</p> : null}
        </div>

        <div>
          <p className="mb-1.5 text-sm font-medium text-foreground">Grace period</p>
          <div className="flex gap-1.5">
            {gracePeriodOptions.map((minutes) => (
              <button
                key={minutes}
                type="button"
                onClick={() => setGrace(minutes)}
                aria-pressed={grace === minutes}
                className={cn(
                  "focus-ring safe-motion min-h-9 flex-1 rounded-full border px-2 py-1.5 text-xs font-medium",
                  grace === minutes
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-border text-muted-foreground hover:bg-secondary"
                )}
              >
                {minutes}m
              </button>
            ))}
          </div>
          <p className="mt-1.5 text-xs text-muted-foreground">
            If you haven&apos;t confirmed by then, your trusted Muddies are notified.
          </p>
        </div>

        <div>
          <button
            type="button"
            onClick={() => setPickerOpen((value) => !value)}
            className="focus-ring safe-motion flex w-full items-center justify-between gap-2 rounded-lg py-1 text-left"
          >
            <span>
              <span className="block text-sm font-medium text-foreground">Trusted Muddies</span>
              {selectedContacts.length === 0 ? (
                <span className="text-xs text-muted-foreground">Choose who should check on you</span>
              ) : (
                <span className="mt-1 flex items-center gap-1.5">
                  <span className="flex -space-x-1.5">
                    {selectedContacts.slice(0, 3).map((contact) => (
                      <GlowAvatar key={contact.id} name={contact.name} size="sm" />
                    ))}
                  </span>
                  {selectedContacts.length > 3 ? (
                    <span className="text-xs text-muted-foreground">+{selectedContacts.length - 3}</span>
                  ) : null}
                </span>
              )}
            </span>
            <span className="flex items-center gap-1 text-xs font-medium text-primary">
              {selectedContacts.length === 0 ? "Choose" : "Change"}
              <ChevronRight className={cn("h-3.5 w-3.5 transition-transform", pickerOpen && "rotate-90")} aria-hidden="true" />
            </span>
          </button>

          {pickerOpen ? (
            contacts.length === 0 ? (
              <p className="mt-2 text-xs text-muted-foreground">Add Muddies first to choose a trusted contact.</p>
            ) : (
              <div className="mt-2 grid max-h-48 gap-2 overflow-y-auto sm:grid-cols-2">
                {contacts.map((contact) => (
                  <button
                    key={contact.id}
                    type="button"
                    onClick={() => toggle(contact.id)}
                    className={cn(
                      "focus-ring safe-motion flex items-center gap-3 rounded-lg border p-2.5 text-left text-sm",
                      selected.includes(contact.id) ? "border-primary bg-primary/10" : "border-border hover:bg-secondary"
                    )}
                  >
                    <GlowAvatar name={contact.name} size="sm" />
                    <span className="min-w-0 flex-1 truncate font-medium">{contact.name}</span>
                    {contact.isCloseFriend ? <Badge variant="orange">Close</Badge> : null}
                  </button>
                ))}
              </div>
            )
          ) : null}
        </div>

        <FormField htmlFor={`${formId}-note`} label="Note (optional)">
          <Input
            id={`${formId}-note`}
            value={note}
            maxLength={200}
            onChange={(event) => setNote(event.target.value)}
            placeholder="Taking a ride from work"
          />
        </FormField>

        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Info className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          No live location is shared — only your destination label, expected time, and confirmation.
        </p>
      </div>
    </Modal>
  );
}
