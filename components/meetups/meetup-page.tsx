"use client";

import { Link, useRevalidate } from "@/lib/platform";
import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import {
  ArrowLeft,
  CalendarClock,
  CarFront,
  Check,
  CheckCircle2,
  ChevronDown,
  Clock3,
  House,
  LogOut,
  MapPin,
  Navigation,
  Plus,
  TimerReset,
  Users
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  ARRIVAL_LABELS,
  MEETUP_TITLES,
  canUpdateArrival,
  isMeetupHintFresh,
  meetupPhase,
  type Meetup,
  type MeetupMode,
  type MeetupUpdate
} from "@/lib/meetups/rules";
import { useFeedRefresh } from "@/hooks/use-feed-refresh";
import { useCountdownResume } from "@/hooks/use-countdown-clock";

export type MeetupSaveAction = (input: unknown, create?: boolean) => Promise<{ ok: boolean; message: string }>;

const inputClass = "w-full rounded-2xl border border-border bg-background px-4 py-3 text-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/15";
const panelClass = "rounded-[28px] border border-border/70 bg-card shadow-[0_12px_40px_hsl(var(--shadow)/0.08)]";

function timeLabel(iso: string, timezone: string) {
  return new Intl.DateTimeFormat("en", { timeZone: timezone, dateStyle: "medium", timeStyle: "short" }).format(new Date(iso));
}

function initials(name: string) {
  return name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

function MeetupModeIcon({ mode, className = "h-5 w-5" }: { mode: MeetupMode; className?: string }) {
  const Icon = mode === "come_over" ? House : mode === "coming_to" ? CarFront : MapPin;
  return <Icon className={className} />;
}

function modeDescription(mode: MeetupMode) {
  if (mode === "come_over") return "Invite Muddies to your place";
  if (mode === "coming_to") return "Go to a Muddy's place";
  return "Choose a place to meet";
}

function responseLabel(response: "invited" | "accepted" | "declined") {
  if (response === "accepted") return "Accepted";
  if (response === "declined") return "Can't make it";
  return "Invited";
}

export function MeetupPage({
  viewerId,
  meetups,
  muddies,
  focusedId,
  saveAction,
  reloadAction
}: {
  viewerId: string;
  meetups: Meetup[];
  muddies: { id: string; name: string }[];
  focusedId?: string;
  saveAction: MeetupSaveAction;
  reloadAction?: () => Promise<void>;
}) {
  const revalidate = useRevalidate();
  const [creating, setCreating] = useState(false);
  const refresh = useCallback(async () => {
    if (reloadAction) await reloadAction();
    else revalidate();
  }, [reloadAction, revalidate]);

  useFeedRefresh(refresh);

  const active = meetups.filter((m) => m.status === "active");
  const past = meetups.filter((m) => m.status !== "active");
  const focusedPast = past.find((m) => m.id === focusedId);

  return (
    <main className="mx-auto min-h-screen max-w-xl px-3 pb-28 pt-4 sm:px-4">
      <header className="mb-5 space-y-4">
        <Link href="/dashboard" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition hover:text-foreground">
          <ArrowLeft className="h-4 w-4" />
          Home
        </Link>

        <div>
          <h1 className="text-3xl font-bold tracking-tight">Meet Up</h1>
          <p className="mt-1 text-sm text-muted-foreground">Make it happen, together.</p>
        </div>

        <Button
          className="h-14 w-full rounded-2xl text-base shadow-[0_14px_34px_hsl(var(--primary)/0.24)]"
          onClick={() => setCreating((value) => !value)}
        >
          {creating ? <ArrowLeft className="h-5 w-5" /> : <Plus className="h-5 w-5" />}
          {creating ? "Back to meet ups" : "Arrange"}
        </Button>

        <div className="grid grid-cols-2 gap-2 rounded-2xl bg-secondary/70 p-1.5">
          <div className="rounded-xl bg-primary px-4 py-2.5 text-center text-sm font-semibold text-primary-foreground">
            Active ({active.length})
          </div>
          <Link
            href="/plans"
            className="rounded-xl px-4 py-2.5 text-center text-sm font-semibold text-muted-foreground transition hover:bg-card hover:text-foreground"
          >
            Your Plans
          </Link>
        </div>
      </header>

      {creating && (
        <div className="mb-5">
          <CreateMeetup
            muddies={muddies}
            saveAction={saveAction}
            onCreated={() => {
              setCreating(false);
              void refresh();
            }}
          />
        </div>
      )}

      {focusedId && !meetups.some((m) => m.id === focusedId) && (
        <p role="status" className={panelClass + " mb-4 p-5 text-sm"}>
          This meetup is no longer available to you.
        </p>
      )}

      {!creating && !active.length && (
        <section className={panelClass + " mb-5 overflow-hidden"}>
          <div className="flex min-h-44 flex-col items-center justify-center bg-gradient-to-br from-primary/20 via-primary/5 to-transparent px-6 py-8 text-center">
            <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-3xl bg-primary/20 text-primary">
              <Users className="h-8 w-8" />
            </div>
            <h2 className="text-lg font-bold">No active meet ups</h2>
            <p className="mt-2 max-w-xs text-sm text-muted-foreground">
              Invite a Muddy over, go to their place, or agree somewhere to meet.
            </p>
            <Button className="mt-5 rounded-2xl" onClick={() => setCreating(true)}>
              <Plus className="h-4 w-4" />
              Arrange a meet up
            </Button>
          </div>
        </section>
      )}

      <div className="space-y-4">
        {active.map((m) => (
          <MeetupCard
            key={m.id}
            meetup={m}
            viewerId={viewerId}
            focused={m.id === focusedId}
            saveAction={saveAction}
            refreshAction={refresh}
          />
        ))}
        {focusedPast && (
          <MeetupCard
            meetup={focusedPast}
            viewerId={viewerId}
            focused
            saveAction={saveAction}
            refreshAction={refresh}
          />
        )}
      </div>

      {past.some((m) => m.id !== focusedId) && (
        <details className={panelClass + " mt-5 overflow-hidden"}>
          <summary className="flex cursor-pointer list-none items-center justify-between px-5 py-4 text-sm font-semibold">
            <span>Past & cancelled ({past.length - (focusedPast ? 1 : 0)})</span>
            <ChevronDown className="h-4 w-4 text-muted-foreground" />
          </summary>
          <div className="space-y-3 border-t border-border/70 p-3">
            {past
              .filter((m) => m.id !== focusedId)
              .map((m) => (
                <MeetupCard
                  key={m.id}
                  meetup={m}
                  viewerId={viewerId}
                  focused={false}
                  saveAction={saveAction}
                  refreshAction={refresh}
                />
              ))}
          </div>
        </details>
      )}
    </main>
  );
}

function CreateMeetup({
  muddies,
  onCreated,
  saveAction
}: {
  muddies: { id: string; name: string }[];
  onCreated: () => void;
  saveAction: MeetupSaveAction;
}) {
  const [mode, setMode] = useState<MeetupMode>("come_over");
  const [when, setWhen] = useState("now");
  const [message, setMessage] = useState("");
  const [pending, startTransition] = useTransition();
  const requestKey = useRef<string | null>(null);

  const chooseMode = (nextMode: MeetupMode) => {
    requestKey.current = null;
    setMode(nextMode);
  };

  return (
    <form
      method="post"
      className={panelClass + " overflow-hidden"}
      onChange={() => {
        requestKey.current = null;
      }}
      onSubmit={(event) => {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        const localTime = String(data.get("startsAt") ?? "");

        if (when === "later" && (!localTime || !Number.isFinite(new Date(localTime).getTime()))) {
          setMessage("Choose a date and time.");
          return;
        }

        requestKey.current ??= crypto.randomUUID();

        const input = {
          mode,
          participantIds: data.getAll("participants"),
          placeLabel: data.get("place"),
          note: data.get("note"),
          when,
          ...(when === "later" ? { startsAt: new Date(localTime).toISOString() } : {}),
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          requestKey: requestKey.current
        };

        startTransition(async () => {
          try {
            const result = await saveAction(input, true);
            setMessage(result.message);
            if (result.ok) onCreated();
          } catch {
            setMessage("Could not save. Try again; your invitation won't be duplicated.");
          }
        });
      }}
    >
      <div className="border-b border-border/70 px-5 py-5">
        <h2 className="text-xl font-bold">Arrange a Meet Up</h2>
        <p className="mt-1 text-sm text-muted-foreground">Invite your Muddies and agree the details.</p>
      </div>

      <fieldset disabled={pending} className="space-y-6 p-5">
        <section>
          <h3 className="mb-3 text-sm font-bold">1. What kind of meet up?</h3>
          <div className="space-y-2.5">
            {(["come_over", "coming_to", "meet_somewhere"] as const).map((value) => {
              const selected = mode === value;
              return (
                <button
                  key={value}
                  type="button"
                  onClick={() => chooseMode(value)}
                  className={[
                    "flex w-full items-center gap-3 rounded-2xl border p-3.5 text-left transition",
                    selected ? "border-primary bg-primary/10 ring-1 ring-primary/20" : "border-border bg-background hover:bg-secondary/50"
                  ].join(" ")}
                >
                  <span className={["flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl", selected ? "bg-primary/20 text-primary" : "bg-secondary text-muted-foreground"].join(" ")}>
                    <MeetupModeIcon mode={value} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-bold">{MEETUP_TITLES[value]}</span>
                    <span className="block text-xs text-muted-foreground">{modeDescription(value)}</span>
                  </span>
                  <span className={["flex h-5 w-5 items-center justify-center rounded-full border", selected ? "border-primary bg-primary text-primary-foreground" : "border-border"].join(" ")}>
                    {selected && <Check className="h-3.5 w-3.5" />}
                  </span>
                </button>
              );
            })}
          </div>
        </section>

        <section>
          <h3 className="mb-3 text-sm font-bold">2. Who are you inviting?</h3>
          {!muddies.length && <p className="text-sm text-muted-foreground">Add a Muddy before arranging a meetup.</p>}
          <div className="max-h-56 space-y-2 overflow-y-auto pr-1">
            {muddies.map((muddy) => (
              <label
                key={mode + "-" + muddy.id}
                className="flex cursor-pointer items-center gap-3 rounded-2xl border border-border bg-background p-3 transition hover:bg-secondary/50"
              >
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-secondary text-xs font-bold">
                  {initials(muddy.name)}
                </span>
                <span className="min-w-0 flex-1 truncate text-sm font-semibold">{muddy.name}</span>
                <input
                  name="participants"
                  type={mode === "coming_to" ? "radio" : "checkbox"}
                  value={muddy.id}
                  className="h-5 w-5 accent-[hsl(var(--primary))]"
                />
              </label>
            ))}
          </div>
        </section>

        <section>
          <h3 className="mb-3 text-sm font-bold">3. Place</h3>
          <div className="relative">
            <MapPin className="pointer-events-none absolute left-4 top-3.5 h-4 w-4 text-muted-foreground" />
            <input
              name="place"
              required
              maxLength={120}
              placeholder={mode === "meet_somewhere" ? "e.g. Kozo Spot, A&C Mall" : "e.g. My place · ring the doorbell"}
              className={inputClass + " pl-10"}
            />
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            Only invited participants see this. An exact address is optional.
          </p>
        </section>

        <section>
          <h3 className="mb-3 text-sm font-bold">4. Date & time</h3>
          <div className="grid grid-cols-2 gap-2 rounded-2xl bg-secondary/70 p-1.5">
            <button
              type="button"
              onClick={() => {
                requestKey.current = null;
                setWhen("now");
              }}
              className={["rounded-xl px-4 py-2.5 text-sm font-semibold transition", when === "now" ? "bg-primary text-primary-foreground" : "text-muted-foreground"].join(" ")}
            >
              Now
            </button>
            <button
              type="button"
              onClick={() => {
                requestKey.current = null;
                setWhen("later");
              }}
              className={["rounded-xl px-4 py-2.5 text-sm font-semibold transition", when === "later" ? "bg-primary text-primary-foreground" : "text-muted-foreground"].join(" ")}
            >
              Later
            </button>
          </div>

          {when === "later" && (
            <label className="mt-3 block space-y-2 text-sm">
              <span className="font-medium">Choose date & time</span>
              <input name="startsAt" type="datetime-local" required className={inputClass} />
            </label>
          )}
        </section>

        <section>
          <h3 className="mb-3 text-sm font-bold">5. Add a note <span className="font-normal text-muted-foreground">(optional)</span></h3>
          <textarea
            name="note"
            maxLength={200}
            rows={4}
            placeholder="Good vibes, snacks, games..."
            className={inputClass + " resize-none"}
          />
        </section>

        <Button type="submit" disabled={!muddies.length} className="h-14 w-full rounded-2xl text-base">
          {pending ? "Sending…" : "Send invitation"}
        </Button>

        {!!message && <p role="status" className="text-center text-sm">{message}</p>}
      </fieldset>
    </form>
  );
}

function MeetupCard({
  meetup: m,
  viewerId,
  focused,
  saveAction,
  refreshAction
}: {
  meetup: Meetup;
  viewerId: string;
  focused: boolean;
  saveAction: MeetupSaveAction;
  refreshAction: () => Promise<void>;
}) {
  const card = useRef<HTMLElement>(null);
  const retry = useRef<{ signature: string; key: string } | null>(null);
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState("");
  const [date, setDate] = useState("");
  const [delay, setDelay] = useState(15);
  const [now, setNow] = useState<number | null>(null);

  useCountdownResume(setNow, 30_000);

  useEffect(() => {
    const initial = window.setTimeout(() => setNow(Date.now()), 0);
    return () => window.clearTimeout(initial);
  }, []);

  useEffect(() => {
    if (focused) card.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [focused]);

  const mine = m.members.find((p) => p.userId === viewerId);
  const creator = m.creatorId === viewerId;
  const open = m.status === "active";
  const ready = now !== null && canUpdateArrival(m, viewerId, now);
  const confirmed = m.members.filter((p) => p.metAt).length;

  function update(command: Record<string, unknown>) {
    const signature = JSON.stringify({ ...command, revision: m.revision });
    if (retry.current?.signature !== signature) retry.current = { signature, key: crypto.randomUUID() };

    const input = {
      ...command,
      id: m.id,
      revision: m.revision,
      requestKey: retry.current.key
    } as MeetupUpdate;

    startTransition(async () => {
      try {
        const result = await saveAction(input);
        setMessage(result.message);
        if (result.ok) {
          retry.current = null;
          await refreshAction();
        }
      } catch {
        setMessage("Could not save your update. Try again.");
      }
    });
  }

  function changeTime(action: "suggest" | "reschedule", iso?: string) {
    const time = iso ? new Date(iso) : new Date(date);
    if (!Number.isFinite(time.getTime()) || time.getTime() <= Date.now()) {
      setMessage("Choose a future date and time.");
      return;
    }
    update({ action, startsAt: time.toISOString() });
  }

  return (
    <article
      ref={card}
      className={[
        panelClass,
        "overflow-hidden",
        focused ? "ring-2 ring-primary ring-offset-2 ring-offset-background" : ""
      ].join(" ")}
    >
      <div className="flex items-start gap-4 bg-gradient-to-br from-primary/20 via-primary/5 to-transparent p-5">
        <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-card text-primary shadow-sm">
          <MeetupModeIcon mode={m.mode} className="h-7 w-7" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-lg font-bold">{MEETUP_TITLES[m.mode]}</h2>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {creator ? "You arranged this meet up" : "Meet Up invitation"}
              </p>
            </div>
            <span className="rounded-full bg-card px-2.5 py-1 text-[11px] font-semibold capitalize shadow-sm">
              {open ? responseLabel(mine?.response ?? "invited") : m.status}
            </span>
          </div>

          <div className="mt-4 space-y-2 text-sm">
            <p className="flex items-center gap-2">
              <CalendarClock className="h-4 w-4 shrink-0 text-primary" />
              <span>{timeLabel(m.startsAt, m.timezone)}</span>
            </p>
            <p className="flex items-center gap-2">
              <MapPin className="h-4 w-4 shrink-0 text-primary" />
              <span>{m.placeLabel}</span>
            </p>
          </div>
        </div>
      </div>

      <div className="space-y-5 p-5">
        {m.note && (
          <div className="rounded-2xl bg-secondary/60 px-4 py-3 text-sm">
            {m.note}
          </div>
        )}

        {!creator && open && mine?.response === "invited" && (
          <section className="rounded-2xl border border-primary/20 bg-primary/10 p-4">
            <p className="text-sm font-bold">You're invited</p>
            <p className="mt-1 text-xs text-muted-foreground">Accept to join the meet up and receive arrival updates.</p>
            <fieldset disabled={pending} className="mt-4 grid grid-cols-2 gap-2">
              <Button className="rounded-2xl" onClick={() => update({ action: "respond", response: "accepted" })}>
                <Check className="h-4 w-4" />
                Accept
              </Button>
              <Button variant="outline" className="rounded-2xl" onClick={() => update({ action: "respond", response: "declined" })}>
                Decline
              </Button>
            </fieldset>
          </section>
        )}

        <section>
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-sm font-bold">People ({m.members.length})</h3>
            {confirmed > 0 && <span className="text-xs font-medium text-muted-foreground">{confirmed} confirmed meeting</span>}
          </div>

          <ul className="space-y-2">
            {m.members.map((person) => {
              const nearby = person.nearby && person.observedAt && now !== null && isMeetupHintFresh(person.observedAt, now);
              const status = person.metAt
                ? "Confirmed"
                : person.response !== "accepted"
                  ? responseLabel(person.response)
                  : person.delayMinutes
                    ? ARRIVAL_LABELS[person.arrival] + " · " + person.delayMinutes + " min"
                    : ARRIVAL_LABELS[person.arrival];

              return (
                <li key={person.key} className="flex items-center gap-3 rounded-2xl bg-secondary/50 p-3">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-card text-xs font-bold shadow-sm">
                    {initials(person.userId === viewerId ? "You" : person.name)}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold">
                      {person.userId === viewerId ? "You" : person.name}
                      {person.userId === m.hostId ? " · Host" : ""}
                    </span>
                    {nearby && <span className="block text-xs font-medium text-primary">Nearby · not arrival confirmation</span>}
                  </span>
                  <span className={["max-w-[42%] rounded-full px-2.5 py-1 text-right text-[11px] font-semibold", person.metAt ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300" : "bg-card text-muted-foreground"].join(" ")}>
                    {status}
                  </span>
                </li>
              );
            })}
          </ul>
        </section>

        {open && (
          <fieldset disabled={pending} className="space-y-4">
            {mine?.response === "accepted" && (
              <section className="flex items-center gap-3 rounded-2xl border border-border bg-background p-4">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-600">
                  <Navigation className="h-5 w-5" />
                </span>
                <button
                  type="button"
                  onClick={() => update({ action: "proximity", enabled: !mine.proximityEnabled })}
                  className="min-w-0 flex-1 text-left"
                >
                  <span className="block text-sm font-bold">Allow nearby hint</span>
                  <span className="mt-0.5 block text-xs text-muted-foreground">No exact location or distance is shared. Ghost Mode and Privacy Zones still apply.</span>
                </button>
                <button
                  type="button"
                  aria-pressed={mine.proximityEnabled}
                  aria-label="Allow nearby hint for this meetup"
                  onClick={() => update({ action: "proximity", enabled: !mine.proximityEnabled })}
                  className={["relative h-7 w-12 shrink-0 rounded-full transition", mine.proximityEnabled ? "bg-primary" : "bg-secondary"].join(" ")}
                >
                  <span className={["absolute top-1 h-5 w-5 rounded-full bg-white shadow-sm transition", mine.proximityEnabled ? "left-6" : "left-1"].join(" ")} />
                </button>
              </section>
            )}

            {!creator && mine?.response === "accepted" && (
              <Button
                variant="outline"
                className="w-full rounded-2xl"
                onClick={() => update({ action: "respond", response: "declined" })}
              >
                Can't make it
              </Button>
            )}

            {!creator && mine?.response === "declined" && (
              <Button className="w-full rounded-2xl" onClick={() => update({ action: "respond", response: "accepted" })}>
                Accept invitation
              </Button>
            )}

            {ready && (
              <section>
                <h3 className="mb-3 text-sm font-bold">Update my status</h3>
                <div className="space-y-2.5">
                  <button
                    type="button"
                    onClick={() => update({ action: "arrival", arrival: "on_my_way" })}
                    className="flex w-full items-center gap-3 rounded-2xl border border-blue-500/20 bg-blue-500/10 p-4 text-left transition active:scale-[0.99]"
                  >
                    <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-blue-500/20 text-blue-600 dark:text-blue-300">
                      <CarFront className="h-5 w-5" />
                    </span>
                    <span className="flex-1">
                      <span className="block text-sm font-bold">On my way</span>
                      <span className="block text-xs text-muted-foreground">I'm heading there now</span>
                    </span>
                  </button>

                  <button
                    type="button"
                    onClick={() => update({ action: "arrival", arrival: "here" })}
                    className="flex w-full items-center gap-3 rounded-2xl border border-emerald-500/20 bg-emerald-500/10 p-4 text-left transition active:scale-[0.99]"
                  >
                    <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-emerald-500/20 text-emerald-600 dark:text-emerald-300">
                      <MapPin className="h-5 w-5" />
                    </span>
                    <span className="flex-1">
                      <span className="block text-sm font-bold">I'm here</span>
                      <span className="block text-xs text-muted-foreground">I've arrived at the agreed place</span>
                    </span>
                  </button>

                  <div className="rounded-2xl border border-amber-500/20 bg-amber-500/10 p-4">
                    <div className="flex items-center gap-3">
                      <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-amber-500/20 text-amber-600 dark:text-amber-300">
                        <Clock3 className="h-5 w-5" />
                      </span>
                      <span>
                        <span className="block text-sm font-bold">Running late</span>
                        <span className="block text-xs text-muted-foreground">Tell everyone how late you'll be</span>
                      </span>
                    </div>
                    <div className="mt-3 flex items-center gap-2">
                      <input
                        type="number"
                        min={1}
                        max={120}
                        value={delay}
                        onChange={(e) => setDelay(Number(e.target.value))}
                        className="h-11 w-24 rounded-xl border border-border bg-background px-3 text-sm"
                      />
                      <span className="text-xs text-muted-foreground">minutes</span>
                      <Button
                        variant="outline"
                        className="ml-auto rounded-xl"
                        onClick={() => update({ action: "arrival", arrival: "late", delayMinutes: delay })}
                      >
                        Send
                      </Button>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => update({ action: "arrival", arrival: "left" })}
                    className="flex w-full items-center gap-3 rounded-2xl border border-red-500/20 bg-red-500/10 p-4 text-left transition active:scale-[0.99]"
                  >
                    <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-red-500/20 text-red-600 dark:text-red-300">
                      <LogOut className="h-5 w-5" />
                    </span>
                    <span className="flex-1">
                      <span className="block text-sm font-bold">I left</span>
                      <span className="block text-xs text-muted-foreground">I'm leaving now</span>
                    </span>
                  </button>

                  {!mine?.metAt && (
                    <button
                      type="button"
                      onClick={() => update({ action: "met" })}
                      className="flex w-full items-center gap-3 rounded-2xl border border-primary/20 bg-primary/10 p-4 text-left transition active:scale-[0.99]"
                    >
                      <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-primary/20 text-primary">
                        <CheckCircle2 className="h-5 w-5" />
                      </span>
                      <span className="flex-1">
                        <span className="block text-sm font-bold">We met — confirm for me</span>
                        <span className="block text-xs text-muted-foreground">Everyone confirms for themselves.</span>
                      </span>
                    </button>
                  )}
                </div>
              </section>
            )}

            {!ready && mine?.response === "accepted" && (
              <p className="rounded-2xl bg-secondary/60 p-3 text-xs text-muted-foreground">
                Arrival updates open two hours before the time, once you and another participant have accepted, including the host.
              </p>
            )}

            {now !== null && meetupPhase(m, now) === "unconfirmed" && !mine?.metAt && (
              <p className="rounded-2xl border border-amber-500/20 bg-amber-500/10 p-3 text-sm">
                Did you meet? Confirm if you did, or choose another time. An unconfirmed meetup doesn't mean it failed.
              </p>
            )}

            <details className="rounded-2xl border border-border bg-background">
              <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-3.5 text-sm font-semibold">
                <span className="flex items-center gap-2">
                  <TimerReset className="h-4 w-4 text-muted-foreground" />
                  {creator ? "Reschedule or end" : "Suggest another time"}
                </span>
                <ChevronDown className="h-4 w-4 text-muted-foreground" />
              </summary>

              <div className="space-y-3 border-t border-border p-4">
                <label className="block space-y-2 text-sm">
                  <span className="font-medium">New date & time</span>
                  <input
                    type="datetime-local"
                    value={date}
                    onChange={(e) => setDate(e.target.value)}
                    className={inputClass}
                  />
                </label>

                <Button
                  variant="outline"
                  className="w-full rounded-2xl"
                  onClick={() => changeTime(creator ? "reschedule" : "suggest")}
                >
                  {creator ? "Reschedule & ask everyone again" : "Suggest another time"}
                </Button>

                {creator &&
                  m.members
                    .filter((person) => person.suggestedStartAt)
                    .map((person) => (
                      <div key={person.key} className="rounded-2xl bg-secondary/50 p-3 text-sm">
                        <p>{person.name} suggests {timeLabel(person.suggestedStartAt!, m.timezone)}</p>
                        <Button
                          variant="outline"
                          className="mt-2 w-full rounded-xl"
                          onClick={() => changeTime("reschedule", person.suggestedStartAt!)}
                        >
                          Use this time & ask again
                        </Button>
                      </div>
                    ))}

                {(creator || m.hostId === viewerId) && (
                  <Button
                    variant="danger"
                    className="w-full rounded-2xl"
                    onClick={() => {
                      if (window.confirm("Cancel this meetup for everyone?")) update({ action: "cancel" });
                    }}
                  >
                    Cancel meetup
                  </Button>
                )}

                {creator && (
                  <Button
                    variant="outline"
                    className="w-full rounded-2xl"
                    onClick={() => {
                      if (window.confirm("End this meetup? This won't confirm anyone's arrival.")) update({ action: "end" });
                    }}
                  >
                    End meetup
                  </Button>
                )}
              </div>
            </details>
          </fieldset>
        )}

        {!open && confirmed > 0 && (
          <div className="flex items-center gap-3 rounded-2xl bg-emerald-500/10 p-4 text-sm">
            <CheckCircle2 className="h-5 w-5 text-emerald-600 dark:text-emerald-300" />
            <span>{confirmed} {confirmed === 1 ? "person has" : "people have"} confirmed meeting.</span>
          </div>
        )}

        {!!message && <p role="status" className="text-sm">{message}</p>}
      </div>
    </article>
  );
}
