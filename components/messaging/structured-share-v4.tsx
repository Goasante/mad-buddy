"use client";

import { CalendarDays, Loader2, MapPin, Search } from "lucide-react";
import { useEffect, useMemo, useState, useTransition } from "react";

import {
  getStructuredShareOptionsAction,
  sendStructuredChatMessageAction
} from "@/app/(app)/messaging-structured-share-actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import type { StructuredShareOption } from "@/lib/messaging/structured-share-v4-types";
import { cn } from "@/lib/utils";

export type StructuredShareMode = "place" | "agenda";

function formatDate(value: string | null) {
  if (!value) return "Time not set";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Time not set";
  return new Intl.DateTimeFormat(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  }).format(date);
}

export function StructuredShareV4({
  conversationId,
  open,
  mode,
  onOpenChange,
  onFeedback,
  onSent
}: {
  conversationId: string;
  open: boolean;
  mode: StructuredShareMode;
  onOpenChange: (open: boolean) => void;
  onFeedback: (message: string) => void;
  onSent: () => void | Promise<void>;
}) {
  const [placeName, setPlaceName] = useState("");
  const [placeArea, setPlaceArea] = useState("");
  const [placeAddress, setPlaceAddress] = useState("");
  const [placeKind, setPlaceKind] = useState<"venue" | "area">("venue");
  const [agenda, setAgenda] = useState<StructuredShareOption[] | null>(null);
  const [agendaQuery, setAgendaQuery] = useState("");
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    if (!open || mode !== "agenda" || agenda !== null) return;
    let disposed = false;
    void getStructuredShareOptionsAction(conversationId)
      .then((items) => {
        if (!disposed) setAgenda(items);
      })
      .catch(() => {
        if (!disposed) setAgenda([]);
      });
    return () => {
      disposed = true;
    };
  }, [agenda, conversationId, mode, open]);

  const visibleAgenda = useMemo(() => {
    const term = agendaQuery.trim().toLowerCase();
    if (!agenda) return [];
    if (!term) return agenda;
    return agenda.filter((item) =>
      `${item.title} ${item.contextLabel} ${item.locationLabel ?? ""}`.toLowerCase().includes(term)
    );
  }, [agenda, agendaQuery]);

  function close() {
    setPlaceName("");
    setPlaceArea("");
    setPlaceAddress("");
    setPlaceKind("venue");
    setAgenda(null);
    setAgendaQuery("");
    onOpenChange(false);
  }

  function finish(result: { ok: boolean; message: string }) {
    onFeedback(result.message);
    if (!result.ok) return;
    close();
    void onSent();
  }

  function sendPlace() {
    if (!placeName.trim()) return;
    startTransition(async () => {
      finish(await sendStructuredChatMessageAction({
        kind: "place",
        conversationId,
        clientMessageId: crypto.randomUUID(),
        placeName: placeName.trim(),
        areaLabel: placeArea.trim(),
        addressLabel: placeAddress.trim(),
        placeKind
      }));
    });
  }

  function sendAgenda(item: StructuredShareOption) {
    startTransition(async () => {
      finish(await sendStructuredChatMessageAction({
        kind: "agenda",
        conversationId,
        clientMessageId: crypto.randomUUID(),
        refKind: item.kind,
        refId: item.id
      }));
    });
  }

  return (
    <Modal
      open={open}
      onOpenChange={(next) => {
        if (!next) close();
      }}
      title={mode === "place" ? "Share Place" : "Share Plan or Event"}
      variant="sheet"
    >
      {mode === "place" ? (
        <div className="space-y-3 pb-[max(.5rem,env(safe-area-inset-bottom))]">
          <Field label="Place" required>
            <Input value={placeName} onChange={(event) => setPlaceName(event.target.value)} maxLength={160} placeholder="Cafe, campus, park…" autoFocus />
          </Field>
          <div className="grid grid-cols-2 gap-2 rounded-2xl bg-secondary/55 p-1" role="radiogroup" aria-label="Place type">
            {(["venue", "area"] as const).map((value) => (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={placeKind === value}
                onClick={() => setPlaceKind(value)}
                className={cn(
                  "focus-ring min-h-10 rounded-xl text-sm font-medium capitalize transition",
                  placeKind === value ? "bg-card text-foreground shadow-sm" : "text-muted-foreground"
                )}
              >
                {value}
              </button>
            ))}
          </div>
          <Field label="Area">
            <Input value={placeArea} onChange={(event) => setPlaceArea(event.target.value)} maxLength={160} placeholder="Optional general area" />
          </Field>
          <Field label="Directions">
            <Input value={placeAddress} onChange={(event) => setPlaceAddress(event.target.value)} maxLength={240} placeholder="Optional human-readable directions" />
          </Field>
          <p className="rounded-2xl border border-primary/15 bg-primary/10 px-3 py-2 text-xs leading-relaxed text-muted-foreground">
            <strong className="text-foreground">Privacy:</strong> this share contains no live coordinates or exact device location.
          </p>
          <div className="flex gap-2">
            <Button variant="outline" className="flex-1" onClick={close} disabled={isPending}>Cancel</Button>
            <Button className="flex-1" onClick={sendPlace} disabled={isPending || !placeName.trim()}>
              {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <MapPin className="h-4 w-4" />}
              Share Place
            </Button>
          </div>
        </div>
      ) : (
        <div className="space-y-3 pb-[max(.5rem,env(safe-area-inset-bottom))]">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input value={agendaQuery} onChange={(event) => setAgendaQuery(event.target.value)} placeholder="Search your Plans and Events" className="pl-10" autoFocus />
          </div>
          {agenda === null ? (
            <div className="grid min-h-40 place-items-center"><Loader2 className="h-5 w-5 animate-spin text-primary" /></div>
          ) : visibleAgenda.length === 0 ? (
            <div className="rounded-[22px] border border-dashed border-border/70 px-5 py-9 text-center">
              <CalendarDays className="mx-auto h-5 w-5 text-primary" />
              <strong className="mt-2 block text-sm">Nothing to share here</strong>
              <p className="mt-1 text-xs text-muted-foreground">Upcoming Plans and Events you can access will appear here.</p>
            </div>
          ) : (
            <ul className="max-h-[52vh] space-y-2 overflow-y-auto">
              {visibleAgenda.map((item) => (
                <li key={`${item.kind}:${item.id}`}>
                  <button
                    type="button"
                    disabled={isPending}
                    onClick={() => sendAgenda(item)}
                    className="focus-ring flex w-full items-start gap-3 rounded-[20px] border border-border/60 bg-card/55 p-3 text-left transition hover:border-primary/30 active:scale-[.99] disabled:opacity-55"
                  >
                    <span className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-primary/10 text-primary"><CalendarDays className="h-4 w-4" /></span>
                    <span className="min-w-0 flex-1">
                      <span className="text-xs font-medium text-primary">{item.contextLabel}</span>
                      <strong className="block truncate text-sm">{item.title}</strong>
                      <span className="mt-0.5 block truncate text-xs text-muted-foreground">{formatDate(item.startsAt)}{item.locationLabel ? ` · ${item.locationLabel}` : ""}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          <Button variant="outline" className="w-full" onClick={close} disabled={isPending}>Close</Button>
        </div>
      )}
    </Modal>
  );
}

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-medium">{label}{required ? <span className="text-primary"> *</span> : null}</span>
      {children}
    </label>
  );
}
