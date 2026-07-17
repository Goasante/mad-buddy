"use client";

import { ShieldCheck, MapPin, Clock, Plus } from "lucide-react";
import { useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
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
import { EmptyState } from "@/components/ui/empty-state";
import { GlowAvatar } from "@/components/glow/glow-avatar";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { EXTENSION_OPTIONS_MINUTES } from "@/lib/safety/safe-arrival";
import { cn } from "@/lib/utils";

export type SafeArrivalContactOption = { id: string; name: string; isCloseFriend: boolean };

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
};

const gracePeriodOptions = [10, 20, 30, 60];

function arrivalLabel(iso: string): string {
  return new Date(iso).toLocaleString([], {
    weekday: "short",
    hour: "numeric",
    minute: "2-digit"
  });
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
  const [createOpen, setCreateOpen] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [isPending, startTransition] = useTransition();

  function run(action: () => Promise<{ ok: boolean; message: string }>) {
    startTransition(async () => {
      const result = await action();
      setFeedback(result.message);
      if (result.ok) router.refresh();
    });
  }

  return (
    <div className="mx-auto max-w-[720px] space-y-6 pt-6">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Safe Arrival</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Ask trusted Muddies to check that you get there. No live location is ever shared.
          </p>
        </div>
        <Button type="button" onClick={() => setCreateOpen(true)}>
          <Plus className="h-4 w-4" aria-hidden="true" />
          Start
        </Button>
      </header>

      {feedback ? (
        <div className="rounded-[1rem] border border-orange-400/20 bg-orange-400/10 p-3 text-sm text-orange-800 dark:text-orange-50" role="status">
          {feedback}
        </div>
      ) : null}

      <section>
        <h2 className="mb-3 text-sm font-semibold">Your journeys</h2>
        {mySessions.length === 0 ? (
          <EmptyState
            icon={ShieldCheck}
            className="!min-h-0 !shadow-none p-5"
            title="No active Safe Arrival"
            description="Start one when you're heading somewhere and want someone to check on you."
            action={
              <Button type="button" onClick={() => setCreateOpen(true)}>
                <Plus className="h-4 w-4" aria-hidden="true" />
                Start Safe Arrival
              </Button>
            }
          />
        ) : (
          <div className="space-y-3">
            {mySessions.map((session) => (
              <Card key={session.id} className="p-4">
                <SessionHeader session={session} />
                <div className="mt-4 flex flex-wrap gap-2">
                  <Button type="button" size="sm" onClick={() => run(() => confirmSafeArrivalAction(session.id))} disabled={isPending}>
                    I&apos;ve arrived safely
                  </Button>
                  {EXTENSION_OPTIONS_MINUTES.map((minutes) => (
                    <Button
                      key={minutes}
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => run(() => extendSafeArrivalAction(session.id, minutes))}
                      disabled={isPending}
                    >
                      +{minutes}m
                    </Button>
                  ))}
                  <Button type="button" size="sm" variant="ghost" onClick={() => run(() => cancelSafeArrivalAction(session.id))} disabled={isPending}>
                    Cancel
                  </Button>
                </div>
              </Card>
            ))}
          </div>
        )}
      </section>

      {watching.length > 0 ? (
        <section>
          <h2 className="mb-3 text-sm font-semibold">You&apos;re checking on</h2>
          <div className="space-y-3">
            {watching.map((session) => (
              <Card key={session.id} className="p-4">
                <div className="flex items-start gap-3">
                  <GlowAvatar name={session.travellerName} size="sm" />
                  <div className="min-w-0 flex-1">
                    <SessionHeader session={session} />
                  </div>
                </div>
                {session.myAcknowledgement === "pending" ? (
                  <div className="mt-4 flex flex-wrap gap-2">
                    <Button type="button" size="sm" onClick={() => run(() => acknowledgeSafeArrivalAction(session.id, "watching"))} disabled={isPending}>
                      I&apos;ll check on you
                    </Button>
                    <Button type="button" size="sm" variant="outline" onClick={() => run(() => acknowledgeSafeArrivalAction(session.id, "declined"))} disabled={isPending}>
                      Can&apos;t monitor this time
                    </Button>
                  </div>
                ) : (
                  <p className="mt-3 text-xs text-muted-foreground">
                    {session.myAcknowledgement === "watching" ? "You're checking on this journey." : "You're not monitoring this one."}
                  </p>
                )}
              </Card>
            ))}
          </div>
        </section>
      ) : null}

      <div className="flex items-start gap-3 rounded-xl border border-border/70 bg-card/50 p-4">
        <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-primary" aria-hidden="true" />
        <div>
          <p className="text-sm font-semibold">What your contacts see</p>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            Only your destination label, expected time, and whether you confirmed. Never your location, route, or speed.
          </p>
        </div>
      </div>

      <CreateSafeArrivalModal
        open={createOpen}
        contacts={contacts}
        pending={isPending}
        onOpenChange={setCreateOpen}
        onCreate={(input) =>
          startTransition(async () => {
            const result = await createSafeArrivalAction(input);
            setFeedback(result.message);
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

function SessionHeader({ session }: { session: SafeArrivalSessionSummary }) {
  const overdue = session.status === "unconfirmed";
  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="truncate text-base font-semibold">
          {session.isTraveller ? session.destinationLabel : `${session.travellerName} → ${session.destinationLabel}`}
        </h3>
        {overdue ? <Badge variant="warning">Not confirmed yet</Badge> : null}
        {session.status === "extended" ? <Badge variant="violet">Extended</Badge> : null}
      </div>
      <p className="mt-1 flex items-center gap-1.5 text-sm text-muted-foreground">
        <Clock className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        Expected by {arrivalLabel(session.expectedArrivalAt)} · {session.gracePeriodMinutes} min grace
      </p>
      {session.note ? <p className="mt-2 text-xs text-muted-foreground">{session.note}</p> : null}
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
  const [arrival, setArrival] = useState("");
  const [grace, setGrace] = useState(20);
  const [note, setNote] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const formId = useId();

  function reset() {
    setDestination("");
    setArrival("");
    setGrace(20);
    setNote("");
    setSelected([]);
  }

  function handleOpenChange(next: boolean) {
    onOpenChange(next);
    if (!next) reset();
  }

  function toggle(id: string) {
    setSelected((current) => (current.includes(id) ? current.filter((entry) => entry !== id) : [...current, id]));
  }

  const canCreate = destination.trim().length > 0 && arrival.length > 0 && selected.length > 0;

  return (
    <Modal
      open={open}
      onOpenChange={handleOpenChange}
      title="Start Safe Arrival"
      description="Your contacts see the destination label and time — never your location."
    >
      <div className="max-h-[60vh] space-y-4 overflow-y-auto pr-1">
        <FormField htmlFor={`${formId}-destination`} label="Where are you heading?">
          <Input
            id={`${formId}-destination`}
            value={destination}
            onChange={(event) => setDestination(event.target.value)}
            placeholder="e.g. Home, East Legon"
          />
        </FormField>
        <FormField htmlFor={`${formId}-arrival`} label="Expected arrival">
          <Input
            id={`${formId}-arrival`}
            type="datetime-local"
            value={arrival}
            onChange={(event) => setArrival(event.target.value)}
          />
        </FormField>
        <div>
          <p className="mb-2 text-sm font-medium text-foreground">Grace period</p>
          <div className="flex flex-wrap gap-2">
            {gracePeriodOptions.map((minutes) => (
              <button
                key={minutes}
                type="button"
                onClick={() => setGrace(minutes)}
                aria-pressed={grace === minutes}
                className={cn(
                  "focus-ring safe-motion rounded-full border px-3 py-1.5 text-xs font-medium",
                  grace === minutes
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-border text-muted-foreground hover:bg-secondary"
                )}
              >
                {minutes} min
              </button>
            ))}
          </div>
          <p className="mt-1.5 text-xs text-muted-foreground">
            If you haven&apos;t confirmed by then, your contacts are told you haven&apos;t confirmed yet.
          </p>
        </div>
        <FormField htmlFor={`${formId}-note`} label="Note (optional)">
          <Input
            id={`${formId}-note`}
            value={note}
            maxLength={200}
            onChange={(event) => setNote(event.target.value)}
            placeholder="Taking a trotro from campus"
          />
        </FormField>
        <div>
          <p className="mb-2 text-sm font-medium text-foreground">Trusted contacts</p>
          {contacts.length === 0 ? (
            <p className="text-xs text-muted-foreground">Add Muddies first to choose a trusted contact.</p>
          ) : (
            <div className="grid max-h-48 gap-2 overflow-y-auto sm:grid-cols-2">
              {contacts.map((contact) => (
                <button
                  key={contact.id}
                  type="button"
                  onClick={() => toggle(contact.id)}
                  className={cn(
                    "focus-ring safe-motion flex items-center gap-3 rounded-lg border p-3 text-left text-sm",
                    selected.includes(contact.id) ? "border-primary bg-primary/10" : "border-border hover:bg-secondary"
                  )}
                >
                  <GlowAvatar name={contact.name} size="sm" />
                  <span className="min-w-0 flex-1 truncate font-medium">{contact.name}</span>
                  {contact.isCloseFriend ? <Badge variant="orange">Close</Badge> : null}
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="flex items-start gap-2 rounded-lg border border-border/70 bg-background/60 p-3">
          <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
          <p className="text-xs leading-5 text-muted-foreground">
            They&apos;ll see: <strong>{destination.trim() || "your destination"}</strong>, your expected time, and whether
            you confirmed. Nothing else.
          </p>
        </div>
      </div>

      <div className="mt-5 flex justify-between gap-3">
        <Button type="button" variant="outline" onClick={() => handleOpenChange(false)}>
          Cancel
        </Button>
        <Button
          type="button"
          disabled={!canCreate || pending}
          onClick={() =>
            onCreate({
              destinationLabel: destination.trim(),
              expectedArrivalAt: new Date(arrival).toISOString(),
              gracePeriodMinutes: grace,
              note: note.trim() || undefined,
              contactIds: selected
            })
          }
        >
          Start Safe Arrival
        </Button>
      </div>
    </Modal>
  );
}
