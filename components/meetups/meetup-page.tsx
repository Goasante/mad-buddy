"use client";

import { Link, PLATFORM_KIND, useRevalidate } from "@/lib/platform";
import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import {
  ArrowLeft,
  CalendarClock,
  CarFront,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock3,
  House,
  LogOut,
  MapPin,
  Navigation,
  Plus,
  TimerReset,
  Users,
  X
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  ARRIVAL_LABELS,
  JOURNEY_LABELS,
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
import { useMeetupRealtime } from "@/hooks/use-meetup-realtime";

export type MeetupSaveAction = (input: unknown, create?: boolean) => Promise<{ ok: boolean; message: string }>;

const inputClass =
  "box-border w-full min-w-0 max-w-full rounded-2xl border border-border bg-background px-4 py-3 text-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/15";
const panelClass =
  "rounded-[26px] border border-border/80 bg-card shadow-[0_10px_34px_hsl(var(--shadow)/0.08)]";

function timeLabel(iso: string, timezone: string) {
  return new Intl.DateTimeFormat("en", {
    timeZone: timezone,
    dateStyle: "medium",
    timeStyle: "short"
  }).format(new Date(iso));
}

function compactTimeLabel(iso: string, timezone: string) {
  const value = new Date(iso);
  const date = new Intl.DateTimeFormat("en", {
    timeZone: timezone,
    month: "short",
    day: "numeric"
  }).format(value);
  const time = new Intl.DateTimeFormat("en", {
    timeZone: timezone,
    hour: "numeric",
    minute: "2-digit"
  }).format(value);
  return `${date} · ${time}`;
}

function localDateTimeValue(date: Date) {
  const shifted = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return shifted.toISOString().slice(0, 16);
}

function journeyGlowClass(state: Meetup["members"][number]["journeyState"], fresh: boolean) {
  if (state === "here") return "ring-4 ring-emerald-500/45 shadow-[0_0_22px_hsl(var(--primary)/0.28)]";
  if (state === "at_spot" && fresh) return "ring-4 ring-primary/45 shadow-[0_0_20px_hsl(var(--primary)/0.24)]";
  if (state === "nearby" && fresh) return "ring-4 ring-primary/30";
  if (state === "approaching" && fresh) return "ring-2 ring-primary/30";
  if (state === "on_the_way") return "ring-2 ring-primary/15";
  return "";
}

function activityText(item: Meetup["activity"][number], meetup: Meetup) {
  const who = item.actorName;
  if (item.event === "created") return `${who} arranged the meetup`;
  if (item.event === "accepted") return `${who} accepted`;
  if (item.event === "declined") return `${who} cannot make it`;
  if (item.event === "on_my_way") return `${who} is on the way`;
  if (item.event === "late") {
    const minutes = typeof item.detail.delayMinutes === "number" ? item.detail.delayMinutes : null;
    return minutes ? `${who} is running about ${minutes} min late` : `${who} is running late`;
  }
  if (item.event === "here") return `${who} is here`;
  if (item.event === "left") return `${who} left`;
  if (item.event === "met") return `${who} confirmed meeting`;
  if (item.event === "beacon_set") return `${who} set the Meetup Glow point`;
  if (item.event === "beacon_locked") return `${who} confirmed the Meetup Glow point`;
  if (item.event === "beacon_reset") return `${who} reset the Meetup Glow point`;
  if (item.event === "home_started") return `${who} is heading home`;
  if (item.event === "home_arrived") return `${who} checked in at home`;
  if (item.event === "cancelled") return "Meetup cancelled";
  if (item.event === "ended") return "Meetup ended";
  if (item.event === "suggested") return `${who} suggested another time`;
  if (item.event === "rescheduled") {
    const startsAt = typeof item.detail.startsAt === "string" ? item.detail.startsAt : null;
    return startsAt ? `${who} moved the meetup to ${compactTimeLabel(startsAt, meetup.timezone)}` : `${who} changed the meetup time`;
  }
  return null;
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
  if (response === "declined") return "Cannot make it";
  return "Waiting";
}

function meetupStatus(meetup: Meetup, viewerId: string) {
  if (meetup.status === "cancelled") return { label: "Cancelled", tone: "muted" as const };
  if (meetup.status === "ended") return { label: "Completed", tone: "success" as const };

  const mine = meetup.members.find((person) => person.userId === viewerId);
  const waiting = meetup.members.filter((person) => person.response === "invited").length;

  if (meetup.creatorId === viewerId && waiting > 0) {
    return {
      label: `${waiting} ${waiting === 1 ? "response" : "responses"} pending`,
      tone: "waiting" as const
    };
  }

  if (mine?.response === "declined") return { label: "Cannot make it", tone: "muted" as const };
  if (mine?.response === "invited") return { label: "Invitation", tone: "waiting" as const };
  return { label: "Accepted", tone: "success" as const };
}

function StatusPill({ label, tone }: { label: string; tone: "success" | "waiting" | "muted" }) {
  const className =
    tone === "success"
      ? "bg-emerald-500/12 text-emerald-700 dark:text-emerald-300"
      : tone === "waiting"
        ? "bg-amber-500/12 text-amber-700 dark:text-amber-300"
        : "bg-secondary text-muted-foreground";

  return <span className={`whitespace-nowrap rounded-full px-2.5 py-1 text-[11px] font-semibold ${className}`}>{label}</span>;
}

export function MeetupPage({
  viewerId,
  meetups,
  muddies,
  focusedId,
  saveAction,
  reloadAction,
  initialNowMs
}: {
  viewerId: string;
  meetups: Meetup[];
  muddies: { id: string; name: string }[];
  focusedId?: string;
  saveAction: MeetupSaveAction;
  reloadAction?: () => Promise<void>;
  initialNowMs: number;
}) {
  const revalidate = useRevalidate();
  const focusedMeetup = focusedId ? meetups.find((meetup) => meetup.id === focusedId) : undefined;
  const [creating, setCreating] = useState(false);
  const [clockNow, setClockNow] = useState(initialNowMs);
  const [tab, setTab] = useState<"active" | "mine">(() => {
    if (!focusedMeetup || focusedMeetup.status !== "active") return focusedMeetup ? "mine" : "active";
    const mine = focusedMeetup.members.find((person) => person.userId === viewerId);
    return meetupPhase(focusedMeetup, initialNowMs) !== "upcoming" && mine?.response !== "declined"
      ? "active"
      : "mine";
  });

  useCountdownResume(setClockNow, 30_000);

  const refresh = useCallback(async () => {
    if (reloadAction) await reloadAction();
    else revalidate();
  }, [reloadAction, revalidate]);

  useFeedRefresh(refresh);

  const safeHome = meetups.filter((meetup) => {
    const mine = meetup.members.find((person) => person.userId === viewerId);
    return mine?.homeStartedAt && !mine.homeArrivedAt;
  });
  const normalMeetups = meetups.filter((meetup) => meetup.status === "active");
  // "Active" is the two-hour arrival/check-in window. Future arrangements stay
  // under Your Meetups until that window opens; finished meetups disappear.
  const active = normalMeetups.filter((meetup) => {
    const mine = meetup.members.find((person) => person.userId === viewerId);
    return mine?.response !== "declined" && meetupPhase(meetup, clockNow) !== "upcoming";
  });
  const activeIds = new Set(active.map((meetup) => meetup.id));
  const upcoming = normalMeetups.filter((meetup) => !activeIds.has(meetup.id));
  const yourMeetupsCount = upcoming.length;

  useMeetupRealtime({
    meetupIds: normalMeetups.map((meetup) => meetup.id),
    enabled: normalMeetups.length > 0,
    onChange: refresh
  });

  const controls = (
    <div className="mx-auto w-full max-w-xl px-3 pb-3 pt-2 sm:px-4">
      {PLATFORM_KIND === "mobile" ? (
        <div className="mb-3">
          <h1 className="text-2xl font-bold tracking-tight">Meet Up</h1>
          <p className="mt-1 text-sm text-muted-foreground">Make it happen, together.</p>
        </div>
      ) : (
        <>
          <div className="mb-3 hidden md:block">
            <h1 className="text-3xl font-bold tracking-tight">Meet Up</h1>
            <p className="mt-1 text-sm text-muted-foreground">Make it happen, together.</p>
          </div>
          <p className="mb-3 text-sm text-muted-foreground md:hidden">Make it happen, together.</p>
        </>
      )}

      <Button
        className="h-12 w-full rounded-2xl text-base shadow-[0_10px_24px_hsl(var(--primary)/0.18)]"
        onClick={() => setCreating((value) => !value)}
      >
        {creating ? <ArrowLeft className="h-5 w-5" /> : <Plus className="h-5 w-5" />}
        {creating ? "Back to meetups" : "Arrange a Meet Up"}
      </Button>

      {!creating && (
        <div className="mt-3 grid grid-cols-2 gap-1 rounded-2xl bg-secondary/70 p-1">
          <button
            type="button"
            onClick={() => setTab("active")}
            className={[
              "rounded-xl px-3 py-2.5 text-sm font-semibold transition",
              tab === "active" ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground"
            ].join(" ")}
          >
            Active ({active.length})
          </button>
          <button
            type="button"
            onClick={() => setTab("mine")}
            className={[
              "rounded-xl px-3 py-2.5 text-sm font-semibold transition",
              tab === "mine" ? "bg-card text-foreground shadow-sm" : "text-muted-foreground"
            ].join(" ")}
          >
            Your Meetups{yourMeetupsCount ? ` (${yourMeetupsCount})` : ""}
          </button>
        </div>
      )}
    </div>
  );

  return (
    <main className="mx-auto min-h-screen max-w-xl pb-40">
      {PLATFORM_KIND === "web" && (
        <header className="fixed inset-x-0 top-0 z-40 grid grid-cols-[44px_1fr_44px] items-center gap-2 bg-background px-4 pb-3 pt-[calc(env(safe-area-inset-top,0px)+0.75rem)] md:hidden">
          <Link
            href="/dashboard"
            aria-label="Back"
            className="focus-ring grid h-[44px] w-[44px] place-items-center rounded-full text-foreground transition active:scale-95"
          >
            <ArrowLeft className="h-[22px] w-[22px]" />
          </Link>
          <h1 className="truncate text-center text-[1.125rem] font-semibold tracking-tight">Meet Up</h1>
          <span className="h-[44px] w-[44px]" aria-hidden="true" />
        </header>
      )}

      <div
        className={
          PLATFORM_KIND === "web"
            ? "fixed inset-x-0 top-[var(--mobile-header-height)] z-30 border-b border-border/50 bg-background/95 backdrop-blur-xl md:static md:border-0 md:bg-transparent md:backdrop-blur-none"
            : "sticky top-0 z-30 border-b border-border/50 bg-background/95 backdrop-blur-xl"
        }
      >
        {controls}
      </div>

      <div
        className={[
          "px-3 sm:px-4 md:pt-4",
          PLATFORM_KIND === "web"
            ? creating
              ? "pt-[6.75rem]"
              : "pt-[10.75rem]"
            : "pt-4"
        ].join(" ")}
      >
        {!creating && safeHome.map((meetup) => (
          <SafeHomeCard
            key={`home-${meetup.id}`}
            meetup={meetup}
            viewerId={viewerId}
            saveAction={saveAction}
            refreshAction={refresh}
          />
        ))}

        {creating ? (
          <CreateMeetup
            muddies={muddies}
            saveAction={saveAction}
            onCreated={(createdStart) => {
              setCreating(false);
              setTab(Date.parse(createdStart) - Date.now() <= 2 * 60 * 60_000 ? "active" : "mine");
              void refresh();
            }}
          />
        ) : (
          <>
            {focusedId && !meetups.some((meetup) => meetup.id === focusedId) && (
              <p role="status" className={panelClass + " mb-4 p-5 text-sm"}>
                This meetup is no longer available to you.
              </p>
            )}

            {tab === "active" && (
              <section className="space-y-3">
                {!active.length ? (
                  <EmptyMeetups
                    onArrange={() => setCreating(true)}
                    title="Nothing active right now"
                    body="Active is for meetups in the arrival or check-in window. Upcoming meetups are under Your Meetups."
                  />
                ) : (
                  active.map((meetup, index) => (
                    <MeetupCard
                      key={meetup.id}
                      meetup={meetup}
                      viewerId={viewerId}
                      focused={meetup.id === focusedId}
                      initialExpanded={meetup.id === focusedId || index === 0}
                      saveAction={saveAction}
                      refreshAction={refresh}
                    />
                  ))
                )}
              </section>
            )}

            {tab === "mine" && (
              <section className="space-y-6">
                {!upcoming.length ? (
                  <EmptyMeetups
                    onArrange={() => setCreating(true)}
                    title="No upcoming meetups"
                    body="Finished and expired meetups leave this screen automatically."
                  />
                ) : (
                  <div>
                    <div className="mb-3 flex items-center justify-between px-1">
                      <h2 className="text-sm font-bold">Upcoming</h2>
                      <span className="text-xs text-muted-foreground">{upcoming.length}</span>
                    </div>
                    <div className="space-y-3">
                      {upcoming.map((meetup) => (
                        <MeetupCard
                          key={meetup.id}
                          meetup={meetup}
                          viewerId={viewerId}
                          focused={meetup.id === focusedId}
                          initialExpanded={meetup.id === focusedId}
                          saveAction={saveAction}
                          refreshAction={refresh}
                        />
                      ))}
                    </div>
                  </div>
                )}
              </section>
            )}
          </>
        )}
      </div>
    </main>
  );
}

function EmptyMeetups({
  onArrange,
  title = "No meetups here yet",
  body = "Invite a Muddy over, go to their place, or agree somewhere to meet."
}: {
  onArrange: () => void;
  title?: string;
  body?: string;
}) {
  return (
    <section className={panelClass + " overflow-hidden"}>
      <div className="flex min-h-44 flex-col items-center justify-center bg-gradient-to-br from-primary/10 via-transparent to-transparent px-6 py-8 text-center">
        <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-secondary text-muted-foreground">
          <Users className="h-7 w-7" />
        </div>
        <h2 className="text-lg font-bold">{title}</h2>
        <p className="mt-2 max-w-xs text-sm text-muted-foreground">{body}</p>
        <Button className="mt-5 rounded-2xl" onClick={onArrange}>
          <Plus className="h-4 w-4" />
          Arrange a meetup
        </Button>
      </div>
    </section>
  );
}

function CreateMeetup({
  muddies,
  onCreated,
  saveAction
}: {
  muddies: { id: string; name: string }[];
  onCreated: (startsAtIso: string) => void;
  saveAction: MeetupSaveAction;
}) {
  const [step, setStep] = useState(1);
  const [mode, setMode] = useState<MeetupMode>("come_over");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [place, setPlace] = useState("");
  const [startsAt, setStartsAt] = useState(() => localDateTimeValue(new Date(Date.now() + 30 * 60_000)));
  const [minStartsAt] = useState(() => localDateTimeValue(new Date(Date.now() + 60_000)));
  const [note, setNote] = useState("");
  const [message, setMessage] = useState("");
  const [pending, startTransition] = useTransition();
  const requestKey = useRef<string | null>(null);

  const selectedMuddies = muddies.filter((muddy) => selectedIds.includes(muddy.id));

  function resetRequestKey() {
    requestKey.current = null;
    setMessage("");
  }

  function chooseMode(nextMode: MeetupMode) {
    resetRequestKey();
    setMode(nextMode);
    setSelectedIds((current) => (nextMode === "coming_to" ? current.slice(0, 1) : current));
  }

  function toggleParticipant(id: string) {
    resetRequestKey();
    setSelectedIds((current) => {
      if (mode === "coming_to") return [id];
      return current.includes(id) ? current.filter((value) => value !== id) : [...current, id];
    });
  }

  function nextStep() {
    setMessage("");

    if (step === 1) {
      setStep(2);
      return;
    }

    if (step === 2) {
      if (!place.trim()) {
        setMessage("Add the agreed place.");
        return;
      }
      const scheduled = new Date(startsAt);
      if (!startsAt || !Number.isFinite(scheduled.getTime()) || scheduled.getTime() <= Date.now() + 60_000) {
        setMessage("Choose a future date and time.");
        return;
      }
      setStep(3);
      return;
    }

    if (step === 3) {
      if (!selectedIds.length) {
        setMessage(mode === "coming_to" ? "Choose one Muddy." : "Choose at least one Muddy.");
        return;
      }
      setStep(4);
    }
  }

  function submit() {
    if (!selectedIds.length || !place.trim()) return;
    requestKey.current ??= crypto.randomUUID();

    const input = {
      mode,
      participantIds: selectedIds,
      placeLabel: place,
      note,
      startsAt: new Date(startsAt).toISOString(),
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      requestKey: requestKey.current
    };

    startTransition(async () => {
      try {
        const result = await saveAction(input, true);
        setMessage(result.message);
        if (result.ok) onCreated(new Date(startsAt).toISOString());
      } catch {
        setMessage("Could not save. Try again; your invitation will not be duplicated.");
      }
    });
  }

  return (
    <section className={panelClass + " overflow-hidden"}>
      <div className="border-b border-border/70 px-5 py-5">
        <div className="flex items-center gap-3">
          {step > 1 && (
            <button
              type="button"
              aria-label="Previous step"
              onClick={() => {
                setMessage("");
                setStep((value) => Math.max(1, value - 1));
              }}
              className="flex h-10 w-10 items-center justify-center rounded-full bg-secondary text-muted-foreground"
            >
              <ArrowLeft className="h-4 w-4" />
            </button>
          )}
          <div>
            <h2 className="text-xl font-bold">Arrange a Meet Up</h2>
            <p className="mt-0.5 text-xs text-muted-foreground">Simple details, then send the invitation.</p>
          </div>
        </div>

        <div className="mt-5 grid grid-cols-4 gap-2">
          {["Type", "Details", "Invite", "Review"].map((label, index) => {
            const number = index + 1;
            const activeStep = step === number;
            const complete = step > number;
            return (
              <div key={label} className="space-y-1.5 text-center">
                <div
                  className={[
                    "mx-auto flex h-7 w-7 items-center justify-center rounded-full border text-[11px] font-bold",
                    activeStep
                      ? "border-primary bg-primary text-primary-foreground"
                      : complete
                        ? "border-primary/40 bg-primary/10 text-primary"
                        : "border-border bg-background text-muted-foreground"
                  ].join(" ")}
                >
                  {complete ? <Check className="h-3.5 w-3.5" /> : number}
                </div>
                <span className={`text-[10px] ${activeStep ? "font-semibold text-foreground" : "text-muted-foreground"}`}>
                  {label}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      <div className="space-y-5 p-5">
        {step === 1 && (
          <section>
            <h3 className="mb-3 text-sm font-bold">What kind of meet up?</h3>
            <div className="space-y-2.5">
              {(["come_over", "coming_to", "meet_somewhere"] as const).map((value) => {
                const selected = mode === value;
                return (
                  <button
                    key={value}
                    type="button"
                    onClick={() => chooseMode(value)}
                    className={[
                      "flex w-full items-center gap-3 rounded-2xl border p-4 text-left transition",
                      selected
                        ? "border-primary bg-primary/10 ring-1 ring-primary/20"
                        : "border-border bg-background hover:bg-secondary/50"
                    ].join(" ")}
                  >
                    <span
                      className={[
                        "flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl",
                        selected ? "bg-primary/15 text-primary" : "bg-secondary text-muted-foreground"
                      ].join(" ")}
                    >
                      <MeetupModeIcon mode={value} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-bold">{MEETUP_TITLES[value]}</span>
                      <span className="block text-xs text-muted-foreground">{modeDescription(value)}</span>
                    </span>
                    {selected ? (
                      <span className="flex h-5 w-5 items-center justify-center rounded-full bg-primary text-primary-foreground">
                        <Check className="h-3.5 w-3.5" />
                      </span>
                    ) : (
                      <ChevronRight className="h-4 w-4 text-muted-foreground" />
                    )}
                  </button>
                );
              })}
            </div>
          </section>
        )}

        {step === 2 && (
          <section className="space-y-5">
            <div>
              <label className="mb-2 block text-sm font-bold">Agreed place</label>
              <div className="relative">
                <MapPin className="pointer-events-none absolute left-4 top-3.5 h-4 w-4 text-muted-foreground" />
                <input
                  value={place}
                  onChange={(event) => {
                    resetRequestKey();
                    setPlace(event.target.value);
                  }}
                  maxLength={120}
                  placeholder={mode === "meet_somewhere" ? "e.g. Kozo Spot, A&C Mall" : "e.g. My place"}
                  className={inputClass + " pl-10"}
                />
              </div>
              <p className="mt-2 text-xs text-muted-foreground">
                Only invited participants see this. An exact address is optional.
              </p>
            </div>

            <div>
              <label className="mb-2 block text-sm font-bold">Date & time</label>
              <input
                type="datetime-local"
                value={startsAt}
                min={minStartsAt}
                onChange={(event) => {
                  resetRequestKey();
                  setStartsAt(event.target.value);
                }}
                className={inputClass}
              />
              <p className="mt-2 text-xs text-muted-foreground">
                Meetups are scheduled. The live arrival window opens two hours before this time.
              </p>
            </div>

            <div>
              <label className="mb-2 block text-sm font-bold">
                Add a note <span className="font-normal text-muted-foreground">(optional)</span>
              </label>
              <textarea
                value={note}
                onChange={(event) => {
                  resetRequestKey();
                  setNote(event.target.value);
                }}
                maxLength={200}
                rows={4}
                placeholder="Good vibes, snacks, games..."
                className={inputClass + " resize-none"}
              />
            </div>
          </section>
        )}

        {step === 3 && (
          <section>
            <div className="mb-3 flex items-center justify-between">
              <div>
                <h3 className="text-sm font-bold">{mode === "coming_to" ? "Choose one Muddy" : "Invite Muddies"}</h3>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {mode === "coming_to" ? "Choose whose place you are going to." : "Choose who should receive the invite."}
                </p>
              </div>
              {!!selectedIds.length && <span className="text-xs font-semibold text-primary">{selectedIds.length} selected</span>}
            </div>

            {!muddies.length && <p className="text-sm text-muted-foreground">Add a Muddy before arranging a meetup.</p>}

            <div className="max-h-72 space-y-2 overflow-y-auto pr-1">
              {muddies.map((muddy) => {
                const selected = selectedIds.includes(muddy.id);
                return (
                  <button
                    key={muddy.id}
                    type="button"
                    onClick={() => toggleParticipant(muddy.id)}
                    className={[
                      "flex w-full items-center gap-3 rounded-2xl border p-3 text-left transition",
                      selected ? "border-primary/50 bg-primary/10" : "border-border bg-background"
                    ].join(" ")}
                  >
                    <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-secondary text-xs font-bold">
                      {initials(muddy.name)}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-sm font-semibold">{muddy.name}</span>
                    <span
                      className={[
                        "flex h-5 w-5 items-center justify-center rounded-full border",
                        selected ? "border-primary bg-primary text-primary-foreground" : "border-border"
                      ].join(" ")}
                    >
                      {selected && <Check className="h-3.5 w-3.5" />}
                    </span>
                  </button>
                );
              })}
            </div>
          </section>
        )}

        {step === 4 && (
          <section className="space-y-4">
            <div className="rounded-2xl bg-secondary/50 p-4">
              <div className="flex items-center gap-3">
                <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                  <MeetupModeIcon mode={mode} />
                </span>
                <div>
                  <h3 className="font-bold">{MEETUP_TITLES[mode]}</h3>
                  <p className="text-xs text-muted-foreground">{modeDescription(mode)}</p>
                </div>
              </div>

              <div className="mt-4 space-y-2 border-t border-border/70 pt-4 text-sm">
                <p className="flex items-center gap-2">
                  <MapPin className="h-4 w-4 text-primary" />
                  {place}
                </p>
                <p className="flex items-center gap-2">
                  <CalendarClock className="h-4 w-4 text-primary" />
                  {startsAt ? new Date(startsAt).toLocaleString() : "Choose a date & time"}
                </p>
                {!!note && <p className="rounded-xl bg-background px-3 py-2 text-muted-foreground">{note}</p>}
              </div>
            </div>

            <div>
              <h3 className="mb-2 text-sm font-bold">Invited ({selectedMuddies.length})</h3>
              <div className="flex flex-wrap gap-2">
                {selectedMuddies.map((muddy) => (
                  <span key={muddy.id} className="inline-flex items-center gap-2 rounded-full bg-secondary px-3 py-2 text-xs font-semibold">
                    <span className="flex h-6 w-6 items-center justify-center rounded-full bg-background text-[9px]">
                      {initials(muddy.name)}
                    </span>
                    {muddy.name}
                  </span>
                ))}
              </div>
            </div>
          </section>
        )}

        {!!message && <p role="status" className="rounded-xl bg-secondary/60 px-3 py-2 text-sm">{message}</p>}

        <div className="flex gap-2">
          {step < 4 ? (
            <Button className="h-12 w-full rounded-2xl" onClick={nextStep} disabled={step === 3 && !muddies.length}>
              Next
              <ChevronRight className="h-4 w-4" />
            </Button>
          ) : (
            <Button className="h-12 w-full rounded-2xl" onClick={submit} disabled={pending}>
              {pending ? "Sending…" : "Send invitation"}
            </Button>
          )}
        </div>
      </div>
    </section>
  );
}

function MeetupCard({
  meetup: m,
  viewerId,
  focused,
  initialExpanded,
  saveAction,
  refreshAction
}: {
  meetup: Meetup;
  viewerId: string;
  focused: boolean;
  initialExpanded: boolean;
  saveAction: MeetupSaveAction;
  refreshAction: () => Promise<void>;
}) {
  const card = useRef<HTMLElement>(null);
  const retry = useRef<{ signature: string; key: string } | null>(null);
  const [expanded, setExpanded] = useState(initialExpanded);
  const [statusOpen, setStatusOpen] = useState(false);
  const [homePromptOpen, setHomePromptOpen] = useState(false);
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

  const mine = m.members.find((person) => person.userId === viewerId);
  const creator = m.creatorId === viewerId;
  const open = m.status === "active";
  const ready = now !== null && canUpdateArrival(m, viewerId, now);
  const confirmed = m.members.filter((person) => person.metAt).length;
  const acceptedMembers = m.members.filter((person) => person.response === "accepted");
  const hereCount = acceptedMembers.filter((person) => person.arrival === "here" || person.journeyState === "here" || person.journeyState === "at_spot").length;
  const nearbyCount = acceptedMembers.filter((person) => person.journeyState === "nearby").length;
  const approachingCount = acceptedMembers.filter((person) => person.journeyState === "approaching").length;
  const onWayCount = acceptedMembers.filter((person) => person.arrival === "on_my_way" || person.arrival === "late").length;
  const status = meetupStatus(m, viewerId);

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

  const visibleMembers = expanded ? m.members : m.members.slice(0, 4);

  return (
    <>
      <article
        ref={card}
        className={[
          panelClass,
          "overflow-hidden transition",
          focused ? "ring-2 ring-primary ring-offset-2 ring-offset-background" : ""
        ].join(" ")}
      >
        <button
          type="button"
          onClick={() => setExpanded((value) => !value)}
          className="w-full p-4 text-left sm:p-5"
          aria-expanded={expanded}
        >
          <div className="flex min-w-0 items-start gap-3">
            <span className="flex h-[52px] w-[52px] shrink-0 items-center justify-center rounded-2xl bg-secondary text-primary">
              <MeetupModeIcon mode={m.mode} className="h-6 w-6" />
            </span>

            <span className="min-w-0 flex-1">
              <span className="flex min-w-0 items-center gap-2">
                <span className="min-w-0 flex-1 truncate text-lg font-bold">{MEETUP_TITLES[m.mode]}</span>
                <ChevronDown
                  className={`h-4 w-4 shrink-0 text-muted-foreground transition ${expanded ? "rotate-180" : ""}`}
                />
              </span>

              <span className="mt-1.5 flex min-w-0 items-center gap-2 whitespace-nowrap text-sm text-muted-foreground">
                <CalendarClock className="h-4 w-4 shrink-0 text-primary" />
                <span className="truncate">{compactTimeLabel(m.startsAt, m.timezone)}</span>
              </span>

              <span className="mt-1 flex min-w-0 items-center gap-2 text-sm text-muted-foreground">
                <MapPin className="h-4 w-4 shrink-0 text-primary" />
                <span className="truncate">{m.placeLabel}</span>
              </span>

              <span className="mt-3 flex min-w-0 items-center justify-between gap-2">
                {!expanded ? (
                  <span className="flex min-w-0 items-center">
                    {visibleMembers.map((person, index) => (
                      <span
                        key={person.key}
                        className="-ml-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border-2 border-card bg-secondary text-[9px] font-bold first:ml-0"
                        style={{ zIndex: visibleMembers.length - index }}
                      >
                        {initials(person.userId === viewerId ? "You" : person.name)}
                      </span>
                    ))}
                    {m.members.length > 4 && (
                      <span className="ml-2 text-[11px] text-muted-foreground">+{m.members.length - 4}</span>
                    )}
                  </span>
                ) : (
                  <span />
                )}
                <StatusPill label={status.label} tone={status.tone} />
              </span>
            </span>
          </div>
        </button>

        {expanded && (
          <div className="space-y-4 border-t border-border/70 px-4 pb-5 pt-4 sm:px-5">
            {!!m.note && <p className="rounded-2xl bg-secondary/50 px-4 py-3 text-sm">{m.note}</p>}

            {!creator && open && mine?.response === "invited" && (
              <section className="rounded-2xl border border-primary/20 bg-primary/10 p-4">
                <p className="text-sm font-bold">{"You're invited"}</p>
                <p className="mt-1 text-xs text-muted-foreground">Accept to join the meetup and receive updates.</p>
                <fieldset disabled={pending} className="mt-4 grid grid-cols-2 gap-2">
                  <Button className="rounded-2xl" onClick={() => update({ action: "respond", response: "accepted" })}>
                    <Check className="h-4 w-4" />
                    Accept
                  </Button>
                  <Button
                    variant="outline"
                    className="rounded-2xl"
                    onClick={() => update({ action: "respond", response: "declined" })}
                  >
                    Decline
                  </Button>
                </fieldset>
              </section>
            )}

            <section>
              <div className="mb-2 flex items-center justify-between">
                <h3 className="text-sm font-bold">People ({m.members.length})</h3>
                {confirmed > 0 && <span className="text-[11px] text-muted-foreground">{confirmed} confirmed</span>}
              </div>

              <ul className="divide-y divide-border/60 rounded-2xl bg-secondary/40 px-3">
                {m.members.map((person) => {
                  const nearby =
                    person.nearby &&
                    person.observedAt &&
                    now !== null &&
                    isMeetupHintFresh(person.observedAt, now);

                  const personStatus = person.metAt
                    ? "Confirmed"
                    : person.response !== "accepted"
                      ? responseLabel(person.response)
                      : person.arrival === "not_started"
                        ? "Going"
                        : person.delayMinutes
                          ? ARRIVAL_LABELS[person.arrival] + " · " + person.delayMinutes + " min"
                          : ARRIVAL_LABELS[person.arrival];

                  return (
                    <li key={person.key} className="flex items-center gap-3 py-3">
                      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-background text-xs font-bold">
                        {initials(person.userId === viewerId ? "You" : person.name)}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-semibold">
                          {person.userId === viewerId ? "You" : person.name}
                          {person.userId === m.hostId ? " · Host" : ""}
                        </span>
                        {nearby && <span className="block text-[11px] font-medium text-primary">Nearby now</span>}
                      </span>
                      <span className="text-[11px] font-semibold text-muted-foreground">{personStatus}</span>
                    </li>
                  );
                })}
              </ul>
            </section>

            {open && (
              <fieldset disabled={pending} className="space-y-3">
                {mine?.response === "accepted" && (
                  <section className="flex items-center gap-3 rounded-2xl border border-border bg-background px-3 py-3">
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-300">
                      <Navigation className="h-5 w-5" />
                    </span>
                    <button
                      type="button"
                      onClick={() => update({ action: "proximity", enabled: !mine.proximityEnabled })}
                      className="min-w-0 flex-1 text-left"
                    >
                      <span className="block text-sm font-bold">Allow nearby hint</span>
                      <span className="block text-xs text-muted-foreground">No exact location shared.</span>
                    </button>
                    <span title="Ghost Mode and Privacy Zones still apply.">
                      <Info className="h-4 w-4 text-muted-foreground" />
                    </span>
                    <button
                      type="button"
                      aria-pressed={mine.proximityEnabled}
                      aria-label="Allow nearby hint for this meetup"
                      onClick={() => update({ action: "proximity", enabled: !mine.proximityEnabled })}
                      className={[
                        "relative h-7 w-12 shrink-0 rounded-full transition",
                        mine.proximityEnabled ? "bg-primary" : "bg-secondary"
                      ].join(" ")}
                    >
                      <span
                        className={[
                          "absolute top-1 h-5 w-5 rounded-full bg-white shadow-sm transition",
                          mine.proximityEnabled ? "left-6" : "left-1"
                        ].join(" ")}
                      />
                    </button>
                  </section>
                )}

                {!creator && mine?.response === "accepted" && (
                  <Button
                    variant="outline"
                    className="w-full rounded-2xl"
                    onClick={() => update({ action: "respond", response: "declined" })}
                  >
                    {"Can't make it"}
                  </Button>
                )}

                {!creator && mine?.response === "declined" && (
                  <Button className="w-full rounded-2xl" onClick={() => update({ action: "respond", response: "accepted" })}>
                    Accept invitation
                  </Button>
                )}

                {ready && (
                  <div className="grid grid-cols-2 gap-2">
                    <Button variant="outline" className="rounded-2xl" onClick={() => setStatusOpen(true)}>
                      <Navigation className="h-4 w-4" />
                      Update status
                    </Button>
                    {!mine?.metAt && (
                      <Button className="rounded-2xl" onClick={() => update({ action: "met" })}>
                        <CheckCircle2 className="h-4 w-4" />
                        We met
                      </Button>
                    )}
                  </div>
                )}

                {!ready && mine?.response === "accepted" && (
                  <p className="rounded-2xl bg-secondary/50 px-3 py-2.5 text-xs text-muted-foreground">
                    Arrival updates open two hours before the meetup once you and another participant have accepted.
                  </p>
                )}

                {now !== null && meetupPhase(m, now) === "unconfirmed" && !mine?.metAt && (
                  <p className="rounded-2xl border border-amber-500/20 bg-amber-500/10 px-3 py-2.5 text-sm">
                    {"Did you meet? Confirm if you did, or choose another time. An unconfirmed meetup does not mean it failed."}
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
                        onChange={(event) => setDate(event.target.value)}
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
                            <p>
                              {person.name} suggests {timeLabel(person.suggestedStartAt!, m.timezone)}
                            </p>
                            <Button
                              variant="outline"
                              className="mt-2 w-full rounded-xl"
                              onClick={() => changeTime("reschedule", person.suggestedStartAt!)}
                            >
                              Use this time
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
                          if (window.confirm("End this meetup? This will not confirm anyone's arrival.")) {
                            update({ action: "end" });
                          }
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
              <div className="flex items-center gap-3 rounded-2xl bg-emerald-500/10 p-3 text-sm">
                <CheckCircle2 className="h-5 w-5 text-emerald-600 dark:text-emerald-300" />
                <span>
                  {confirmed} {confirmed === 1 ? "person has" : "people have"} confirmed meeting.
                </span>
              </div>
            )}

            {!!message && <p role="status" className="text-sm">{message}</p>}
          </div>
        )}
      </article>

      {statusOpen && ready && (
        <div
          className="fixed inset-0 z-[80] flex items-end justify-center bg-black/55 px-2"
          onClick={() => setStatusOpen(false)}
        >
          <section
            className="w-full max-w-xl rounded-t-[28px] border border-border bg-card px-4 pb-[calc(env(safe-area-inset-bottom)+1.5rem)] pt-4 shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="mb-4 flex items-start justify-between gap-3">
              <div>
                <h3 className="text-xl font-bold">Update my status</h3>
                <p className="mt-1 text-sm text-muted-foreground">Let your Muddies know where you are.</p>
              </div>
              <button
                type="button"
                aria-label="Close status actions"
                className="flex h-10 w-10 items-center justify-center rounded-full bg-secondary text-muted-foreground"
                onClick={() => setStatusOpen(false)}
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="space-y-2.5">
              <button
                type="button"
                onClick={() => {
                  setStatusOpen(false);
                  update({ action: "arrival", arrival: "on_my_way" });
                }}
                className="flex w-full items-center gap-3 rounded-2xl bg-secondary/55 p-4 text-left"
              >
                <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-blue-500/15 text-blue-600 dark:text-blue-300">
                  <CarFront className="h-5 w-5" />
                </span>
                <span>
                  <span className="block text-sm font-bold">On my way</span>
                  <span className="block text-xs text-muted-foreground">{"I'm heading there now"}</span>
                </span>
              </button>

              <button
                type="button"
                onClick={() => {
                  setStatusOpen(false);
                  update({ action: "arrival", arrival: "here" });
                }}
                className="flex w-full items-center gap-3 rounded-2xl bg-secondary/55 p-4 text-left"
              >
                <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-emerald-500/15 text-emerald-600 dark:text-emerald-300">
                  <MapPin className="h-5 w-5" />
                </span>
                <span>
                  <span className="block text-sm font-bold">{"I'm here"}</span>
                  <span className="block text-xs text-muted-foreground">{"I've arrived at the agreed place"}</span>
                </span>
              </button>

              <div className="rounded-2xl bg-secondary/55 p-4">
                <div className="flex items-center gap-3">
                  <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-amber-500/15 text-amber-600 dark:text-amber-300">
                    <Clock3 className="h-5 w-5" />
                  </span>
                  <span>
                    <span className="block text-sm font-bold">Running late</span>
                    <span className="block text-xs text-muted-foreground">Tell everyone how late you will be</span>
                  </span>
                </div>
                <div className="mt-3 flex items-center gap-2">
                  <input
                    type="number"
                    min={1}
                    max={120}
                    value={delay}
                    onChange={(event) => setDelay(Number(event.target.value))}
                    className="h-11 w-24 rounded-xl border border-border bg-background px-3 text-sm"
                  />
                  <span className="text-xs text-muted-foreground">minutes</span>
                  <Button
                    variant="outline"
                    className="ml-auto rounded-xl"
                    onClick={() => {
                      setStatusOpen(false);
                      update({ action: "arrival", arrival: "late", delayMinutes: delay });
                    }}
                  >
                    Send
                  </Button>
                </div>
              </div>

              <button
                type="button"
                onClick={() => {
                  setStatusOpen(false);
                  update({ action: "arrival", arrival: "left" });
                }}
                className="flex w-full items-center gap-3 rounded-2xl bg-secondary/55 p-4 text-left"
              >
                <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-red-500/15 text-red-600 dark:text-red-300">
                  <LogOut className="h-5 w-5" />
                </span>
                <span>
                  <span className="block text-sm font-bold">I left</span>
                  <span className="block text-xs text-muted-foreground">{"I'm leaving now"}</span>
                </span>
              </button>
            </div>
          </section>
        </div>
      )}
    </>
  );
}
