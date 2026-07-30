"use client";

import { BellRing, ChevronRight, Clock, MapPin, RefreshCcw, ShieldCheck, WifiOff } from "lucide-react";
import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  acknowledgeSafeArrivalAction,
  cancelSafeArrivalAction,
  confirmSafeArrivalAction,
  createSafeArrivalAction,
  extendSafeArrivalAction
} from "@/app/(app)/safe-arrival-actions";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { UserAvatar } from "@/components/ui/user-avatar";
import { useBrowserPush } from "@/hooks/use-browser-push";
import { useJourneyClock, useJourneyRealtime } from "@/hooks/use-journey-realtime";
import { useReducedMotion } from "@/hooks/use-reduced-motion";
import { EXTENSION_OPTIONS_MINUTES, gracePeriodEndMs } from "@/lib/safety/safe-arrival";
import type { SafeArrivalJourney, SafeArrivalWatcherOption } from "@/lib/safety/safe-arrival-service";
import type { SubscriptionPlan } from "@/lib/supabase/database.types";
import { cn } from "@/lib/utils";
import {
  JourneyCountdown,
  JourneyMark,
  JourneyStatusChip,
  JourneyTimeline,
  JourneyVisual,
  WatcherStrip,
  journeyDayTime,
  journeyTime,
  journeyTone
} from "@/components/safety/journey-parts";
import { SafeArrivalSetup, type SafeArrivalSetupInput } from "@/components/safety/safe-arrival-setup";

/**
 * Safe Arrival, both experiences.
 *
 * Screen selection is driven by canonical server state, with one exception: the
 * journey returned by a successful start/confirm is held in local state so the
 * traveller sees ACTIVE (or ARRIVED) the instant the server confirms it — no
 * refresh, no navigation, and no waiting on a Realtime event. `router.refresh()`
 * still runs afterwards to reconcile, and the server copy wins once it lands.
 */
export function SafeArrivalPage({
  travelling,
  watching,
  watcherOptions,
  maxWatchers,
  plan,
  focusedJourney,
  requestedSessionId
}: {
  travelling: SafeArrivalJourney[];
  watching: SafeArrivalJourney[];
  watcherOptions: SafeArrivalWatcherOption[];
  maxWatchers: number;
  plan: SubscriptionPlan;
  focusedJourney: SafeArrivalJourney | null;
  requestedSessionId: string | null;
}) {
  const router = useRouter();
  const [setupOpen, setSetupOpen] = useState(false);
  const [setupError, setSetupError] = useState<string | null>(null);
  const [toast, setToast] = useState("");
  const [isPending, startTransition] = useTransition();
  // Set only from a confirmed server response.
  const [optimistic, setOptimistic] = useState<SafeArrivalJourney | null>(null);
  const [dismissedArrival, setDismissedArrival] = useState<string | null>(null);
  const nowMs = useJourneyClock(true);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(""), 4000);
    return () => window.clearTimeout(timer);
  }, [toast]);

  // A newer server payload supersedes the local copy of the same journey.
  const serverVersion = useMemo(() => {
    if (!optimistic) return null;
    return (
      travelling.find((journey) => journey.id === optimistic.id) ??
      watching.find((journey) => journey.id === optimistic.id) ??
      (focusedJourney?.id === optimistic.id ? focusedJourney : null)
    );
  }, [optimistic, travelling, watching, focusedJourney]);

  const liveTravelling = travelling[0] ?? null;
  // The journey the traveller is looking at, in priority order: the one we hold
  // from a confirmed mutation, whatever the server says is live, or — when the
  // traveller followed their OWN notification for a journey that has already
  // ended — that journey, so the link resolves to its summary rather than to the
  // Home screen.
  const travellerJourney = useMemo(() => {
    if (optimistic?.isTraveller) return serverVersion?.isTraveller ? serverVersion : optimistic;
    if (liveTravelling) return liveTravelling;
    if (focusedJourney?.isTraveller) return focusedJourney;
    return null;
  }, [optimistic, serverVersion, liveTravelling, focusedJourney]);

  // A watcher arriving from a notification: show THAT journey first, full width,
  // rather than burying it under the viewer's own empty state.
  const watcherFocus = useMemo(() => {
    if (!requestedSessionId) return null;
    const fromList = watching.find((journey) => journey.id === requestedSessionId);
    if (fromList) return fromList;
    if (focusedJourney && !focusedJourney.isTraveller) return focusedJourney;
    return null;
  }, [requestedSessionId, watching, focusedJourney]);

  const otherWatching = useMemo(
    () => watching.filter((journey) => journey.id !== watcherFocus?.id),
    [watching, watcherFocus]
  );

  function runAction(action: () => Promise<{ ok: boolean; message: string; journey?: SafeArrivalJourney | null }>) {
    startTransition(async () => {
      const result = await action();
      setToast(result.message);
      if (!result.ok) return;
      // Adopt the canonical journey the server returned, then reconcile. `null`
      // (a cancel) clears the local copy so the Home screen returns at once.
      setOptimistic(result.journey ?? null);
      router.refresh();
    });
  }

  function handleStart(input: SafeArrivalSetupInput) {
    setSetupError(null);
    startTransition(async () => {
      const result = await createSafeArrivalAction(input);
      if (!result.ok) {
        // Keep the sheet open with every field intact so Retry is one tap.
        setSetupError(result.message);
        return;
      }
      setSetupError(null);
      setOptimistic(result.journey ?? null);
      setDismissedArrival(null);
      // Closed only now that the journey provably exists.
      setSetupOpen(false);
      router.refresh();
    });
  }

  const arrivedJourney =
    travellerJourney?.status === "completed" && travellerJourney.id !== dismissedArrival
      ? travellerJourney
      : null;
  const activeJourney =
    travellerJourney && travellerJourney.status !== "completed" && travellerJourney.status !== "cancelled"
      ? travellerJourney
      : null;

  return (
    <div className="mx-auto w-full max-w-[560px] space-y-4 pb-4 pt-4">
      {toast ? (
        <div
          className="rounded-[1rem] border border-orange-400/20 bg-orange-400/10 px-3 py-2.5 text-sm text-orange-800 dark:text-orange-50"
          role="status"
        >
          {toast}
        </div>
      ) : null}

      {watcherFocus ? (
        <WatcherJourneyView
          journey={watcherFocus}
          nowMs={nowMs}
          isPending={isPending}
          onRespond={(response) => runAction(() => acknowledgeSafeArrivalAction(watcherFocus.id, response))}
        />
      ) : arrivedJourney ? (
        <ArrivedJourneyView
          journey={arrivedJourney}
          nowMs={nowMs}
          onDone={() => {
            setDismissedArrival(arrivedJourney.id);
            setOptimistic(null);
            router.refresh();
          }}
        />
      ) : activeJourney ? (
        <ActiveJourneyView
          journey={activeJourney}
          nowMs={nowMs}
          isPending={isPending}
          onConfirm={() => runAction(() => confirmSafeArrivalAction(activeJourney.id))}
          onExtend={(minutes) => runAction(() => extendSafeArrivalAction(activeJourney.id, minutes))}
          onCancel={() => runAction(() => cancelSafeArrivalAction(activeJourney.id))}
        />
      ) : (
        <SafeArrivalHome onStart={() => setSetupOpen(true)} />
      )}

      {otherWatching.length > 0 ? (
        <section>
          <h2 className="mb-2 px-1 text-sm font-semibold">
            {watcherFocus || activeJourney || arrivedJourney ? "Also watching over" : "You're watching over"}
          </h2>
          <ul className="space-y-2">
            {otherWatching.map((journey) => (
              <li key={journey.id}>
                <WatchingSummaryRow journey={journey} nowMs={nowMs} />
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <SafeArrivalSetup
        open={setupOpen}
        watcherOptions={watcherOptions}
        maxWatchers={maxWatchers}
        plan={plan}
        pending={isPending}
        error={setupError}
        nowMs={nowMs}
        onOpenChange={(next) => {
          setSetupOpen(next);
          if (!next) setSetupError(null);
        }}
        onSubmit={handleStart}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Screen 1: Home
// ---------------------------------------------------------------------------

const HOME_POINTS = [
  { icon: MapPin, text: "They'll know your destination and expected arrival time." },
  { icon: Clock, text: "You can extend your time if you need to." },
  { icon: ShieldCheck, text: "No live location is shared. You're in control." }
];

function SafeArrivalHome({ onStart }: { onStart: () => void }) {
  const [howOpen, setHowOpen] = useState(false);

  return (
    <div className="space-y-5">
      <header className="px-1 text-center">
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Safe Arrival</h1>
        <p className="mx-auto mt-1.5 max-w-[16rem] text-sm text-muted-foreground">
          Let trusted Muddies know you got there safely.
        </p>
      </header>

      <JourneyVisual tone="transit" className="min-h-[11rem]">
        <JourneyMark tone="transit" large />
      </JourneyVisual>

      <ul className="space-y-2.5 px-1">
        {HOME_POINTS.map((point) => (
          <li key={point.text} className="flex items-start gap-3">
            <span
              className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-full bg-orange-400/12 text-orange-600 dark:text-orange-300"
              aria-hidden="true"
            >
              <point.icon className="h-4 w-4" />
            </span>
            <p className="min-w-0 flex-1 text-sm leading-6 text-muted-foreground">{point.text}</p>
          </li>
        ))}
      </ul>

      <div className="space-y-2 px-1">
        <Button type="button" size="lg" className="w-full" onClick={onStart}>
          Start Safe Arrival
        </Button>
        <button
          type="button"
          onClick={() => setHowOpen(true)}
          className="focus-ring safe-motion mx-auto block min-h-11 rounded-full px-3 text-sm font-medium text-muted-foreground underline-offset-4 hover:underline"
        >
          How it works
        </button>
      </div>

      <Modal open={howOpen} onOpenChange={setHowOpen} title="How Safe Arrival works" variant="sheet" compact>
        <ol className="space-y-3">
          {[
            "You set your destination, expected arrival time, and grace period.",
            "You choose trusted Muddies to watch over your journey.",
            "They're notified when you start, extend, arrive, or don't confirm.",
            "No live location is shared. Your privacy stays protected."
          ].map((line, index) => (
            <li key={line} className="flex items-start gap-3">
              <span
                className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-orange-500 text-xs font-bold text-white"
                aria-hidden="true"
              >
                {index + 1}
              </span>
              <p className="min-w-0 flex-1 text-sm leading-6">{line}</p>
            </li>
          ))}
        </ol>
      </Modal>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Screen 4: Active traveller
// ---------------------------------------------------------------------------

function ActiveJourneyView({
  journey,
  nowMs,
  isPending,
  onConfirm,
  onExtend,
  onCancel
}: {
  journey: SafeArrivalJourney;
  nowMs: number;
  isPending: boolean;
  onConfirm: () => void;
  onExtend: (minutes: number) => void;
  onCancel: () => void;
}) {
  const [moreOpen, setMoreOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [watcherListOpen, setWatcherListOpen] = useState(false);
  const tone = journeyTone(journey, nowMs);
  const realtime = useJourneyRealtime({ sessionId: journey.id, watchContacts: true, enabled: true });
  const extraExtensions = EXTENSION_OPTIONS_MINUTES.filter((minutes) => minutes !== 10 && minutes !== 20);

  return (
    <div className="space-y-4">
      <JourneyHeader title="Safe Arrival" tone={tone} />

      <JourneyVisual tone={tone} className="min-h-[10rem]">
        <JourneyMark tone={tone} />
        <div className="text-center">
          <h2 className="text-xl font-semibold tracking-tight">{journey.destinationLabel}</h2>
          <div className="mt-1 space-y-0.5">
            <JourneyCountdown journey={journey} nowMs={nowMs} />
          </div>
        </div>
      </JourneyVisual>

      {tone === "overdue" ? (
        <p
          role="status"
          className="rounded-[1rem] border border-red-400/25 bg-red-400/10 px-3 py-2.5 text-xs leading-5 text-red-800 dark:text-red-100"
        >
          Your grace period has passed, so your Muddies have been asked to check in with you. Confirm below
          whenever you can.
        </p>
      ) : null}

      <WatcherStrip
        watchers={journey.watchers}
        title="Watching over you"
        emptyLabel="Nobody is watching this journey yet."
        onOpenList={journey.watchers.length > 0 ? () => setWatcherListOpen(true) : undefined}
      />

      <JourneyTimeline journey={journey} nowMs={nowMs} />

      {journey.note ? (
        <p className="rounded-[1rem] border border-border/70 bg-card/60 px-4 py-3 text-sm text-muted-foreground">
          {journey.note}
        </p>
      ) : null}

      <div className="space-y-2">
        <Button
          type="button"
          size="lg"
          onClick={onConfirm}
          disabled={isPending}
          className="w-full bg-emerald-600 text-white hover:bg-emerald-600/90 hover:shadow-[0_16px_36px_rgba(5,150,105,0.25)]"
        >
          {isPending ? "Saving…" : "I've arrived safely"}
        </Button>

        <div className="flex gap-2">
          {EXTENSION_OPTIONS_MINUTES.slice(0, 2).map((minutes) => (
            <Button
              key={minutes}
              type="button"
              variant="outline"
              className="flex-1"
              onClick={() => onExtend(minutes)}
              disabled={isPending}
            >
              +{minutes} min
            </Button>
          ))}
          {extraExtensions.length > 0 ? (
            <Button
              type="button"
              variant="outline"
              className="flex-1"
              aria-expanded={moreOpen}
              onClick={() => setMoreOpen((value) => !value)}
              disabled={isPending}
            >
              More
            </Button>
          ) : null}
        </div>

        {moreOpen ? (
          <div className="flex gap-2">
            {extraExtensions.map((minutes) => (
              <Button
                key={minutes}
                type="button"
                variant="outline"
                className="flex-1"
                onClick={() => onExtend(minutes)}
                disabled={isPending}
              >
                +{minutes} min
              </Button>
            ))}
          </div>
        ) : null}

        <button
          type="button"
          onClick={() => setCancelOpen(true)}
          disabled={isPending}
          className="focus-ring safe-motion mx-auto block min-h-11 rounded-full px-3 text-sm font-semibold text-red-600 hover:bg-red-500/10 dark:text-red-400"
        >
          Cancel Safe Arrival
        </button>
      </div>

      {realtime.state === "offline" ? <RealtimeNotice onRetry={realtime.retry} /> : null}

      <Modal
        open={cancelOpen}
        onOpenChange={setCancelOpen}
        title="Cancel Safe Arrival?"
        description="Your Muddies will be told the journey ended. Nobody will be alerted if you don't confirm."
        variant="sheet"
        compact
        footer={
          <div className="flex w-full gap-2">
            <Button type="button" variant="outline" className="flex-1" onClick={() => setCancelOpen(false)}>
              Keep it on
            </Button>
            <Button
              type="button"
              variant="danger"
              className="flex-1"
              disabled={isPending}
              onClick={() => {
                setCancelOpen(false);
                onCancel();
              }}
            >
              Cancel journey
            </Button>
          </div>
        }
      >
        <p className="text-sm text-muted-foreground">
          Only cancel if you no longer need anyone checking on you.
        </p>
      </Modal>

      <WatcherListModal
        open={watcherListOpen}
        onOpenChange={setWatcherListOpen}
        journey={journey}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Screen 5: Watcher
// ---------------------------------------------------------------------------

function WatcherJourneyView({
  journey,
  nowMs,
  isPending,
  onRespond
}: {
  journey: SafeArrivalJourney;
  nowMs: number;
  isPending: boolean;
  onRespond: (response: "watching" | "declined") => void;
}) {
  const reducedMotion = useReducedMotion();
  const tone = journeyTone(journey, nowMs);
  const realtime = useJourneyRealtime({
    sessionId: journey.id,
    watchContacts: false,
    enabled: journey.status !== "completed" && journey.status !== "cancelled"
  });
  const push = useBrowserPush();
  const firstName = journey.travellerName.split(" ")[0];
  const graceEnd = journeyTime(
    new Date(
      gracePeriodEndMs({
        expectedArrivalMs: Date.parse(journey.expectedArrivalAt),
        gracePeriodMinutes: journey.gracePeriodMinutes
      })
    ).toISOString()
  );
  const otherWatchers = journey.watchers.filter((watcher) => watcher.state !== "declined");

  return (
    <div className="space-y-4">
      <header className="px-1 text-center">
        <h1 className="text-xl font-semibold tracking-tight">Safe Arrival</h1>
        <p className="mt-0.5 text-sm text-muted-foreground">Watching {firstName}</p>
      </header>

      <div className="rounded-[1.25rem] border border-border/70 bg-card/60 p-4">
        <div className="flex items-center gap-3">
          <UserAvatar src={journey.travellerAvatarUrl} name={journey.travellerName} size="md" decorative />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold">{journey.travellerName}</p>
            <JourneyStatusChip tone={tone} className="mt-1" />
          </div>
        </div>

        <dl className="mt-4 space-y-2.5">
          <div className="flex items-baseline justify-between gap-3">
            <dt className="flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground">
              <MapPin className="h-3.5 w-3.5" aria-hidden="true" />
              Destination
            </dt>
            <dd className="min-w-0 truncate text-sm font-semibold">{journey.destinationLabel}</dd>
          </div>
          <div className="flex items-baseline justify-between gap-3">
            <dt className="shrink-0 text-xs text-muted-foreground">Expected arrival</dt>
            <dd className="text-sm font-semibold tabular-nums">{journeyTime(journey.expectedArrivalAt)}</dd>
          </div>
          {journey.status === "completed" ? (
            <div className="flex items-baseline justify-between gap-3">
              <dt className="shrink-0 text-xs text-muted-foreground">Arrived</dt>
              <dd className="text-sm font-semibold tabular-nums text-emerald-600 dark:text-emerald-400">
                {journeyTime(journey.confirmedAt)}
              </dd>
            </div>
          ) : (
            <div className="flex items-baseline justify-between gap-3">
              <dt className="shrink-0 text-xs text-muted-foreground">Arrives in</dt>
              <dd className="text-sm font-semibold tabular-nums text-orange-600 dark:text-orange-300">
                <JourneyArrivesIn journey={journey} nowMs={nowMs} />
              </dd>
            </div>
          )}
        </dl>
      </div>

      {/* The reassurance panel. Deliberately says "watching over", never
          "tracking": the watcher cannot see the traveller move, and the copy must
          not imply otherwise. */}
      <div className="rounded-[1.25rem] border border-border/70 bg-card/60 p-5 text-center">
        <div className="flex justify-center">
          <div className="flex -space-x-2">
            {otherWatchers.slice(0, 4).map((watcher) => (
              <span
                key={watcher.id}
                className={cn(
                  "journey-watcher rounded-full ring-2 ring-card",
                  !reducedMotion && watcher.state === "watching" && "journey-watcher-pulse"
                )}
              >
                <UserAvatar src={watcher.avatarUrl} name={watcher.name} size="sm" decorative />
              </span>
            ))}
          </div>
        </div>
        <p className="mt-3 text-base font-semibold">
          {journey.status === "completed"
            ? `${firstName} arrived safely`
            : `You're watching over ${firstName}`}
        </p>
        <p className="mx-auto mt-1 max-w-[18rem] text-xs leading-5 text-muted-foreground">
          {journey.status === "completed"
            ? "Nothing more to do. Thanks for looking out for them."
            : `We'll notify you if ${firstName} doesn't confirm arrival by ${graceEnd}.`}
        </p>
      </div>

      {journey.myAcknowledgement === "invited" ? (
        <div className="rounded-[1.25rem] border border-orange-400/25 bg-orange-400/10 p-4">
          <p className="text-sm font-semibold">Can you keep an eye out?</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {firstName} will know you accepted. You&apos;ll be alerted either way if they don&apos;t confirm.
          </p>
          <div className="mt-3 flex gap-2">
            <Button type="button" className="flex-1" disabled={isPending} onClick={() => onRespond("watching")}>
              I&apos;ll watch over them
            </Button>
            <Button
              type="button"
              variant="outline"
              className="flex-1"
              disabled={isPending}
              onClick={() => onRespond("declined")}
            >
              Can&apos;t this time
            </Button>
          </div>
        </div>
      ) : null}

      <JourneyTimeline journey={journey} nowMs={nowMs} />

      {/* Reuses the app's single push transport and its existing preferences.
          No separate notification system, no duplicated preference store. */}
      {push.status !== "unsupported" && push.status !== "checking" ? (
        <div className="rounded-[1.25rem] border border-border/70 bg-card/60 p-4">
          <p className="text-sm font-semibold">Receive alerts</p>
          <div className="mt-2.5 flex items-center justify-between gap-3">
            <p className="flex min-w-0 items-center gap-2 text-sm">
              <BellRing className="h-4 w-4 shrink-0 text-orange-500" aria-hidden="true" />
              <span className="min-w-0 truncate">Push notifications</span>
            </p>
            {push.status === "denied" ? (
              <span className="shrink-0 text-xs text-muted-foreground">Blocked in browser</span>
            ) : push.status === "on" ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={push.isPending}
                onClick={() => push.disable()}
              >
                On
              </Button>
            ) : (
              <Button type="button" size="sm" disabled={push.isPending} onClick={() => push.enable()}>
                Turn on
              </Button>
            )}
          </div>
          <p className="mt-1.5 text-xs text-muted-foreground">
            Safe Arrival alerts still reach your Pulse feed either way.
          </p>
        </div>
      ) : null}

      {realtime.state === "offline" ? <RealtimeNotice onRetry={realtime.retry} /> : null}
    </div>
  );
}

function JourneyArrivesIn({ journey, nowMs }: { journey: SafeArrivalJourney; nowMs: number }) {
  const minutes = Math.round((Date.parse(journey.expectedArrivalAt) - nowMs) / 60_000);
  if (!Number.isFinite(minutes) || minutes <= 0) return <>Time reached</>;
  if (minutes < 60) return <>{minutes} min</>;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return <>{rest === 0 ? `${hours}h` : `${hours}h ${rest}m`}</>;
}

// ---------------------------------------------------------------------------
// Screen 6: Arrived
// ---------------------------------------------------------------------------

function ArrivedJourneyView({
  journey,
  nowMs,
  onDone
}: {
  journey: SafeArrivalJourney;
  nowMs: number;
  onDone: () => void;
}) {
  const notified = journey.watchers.filter((watcher) => watcher.state !== "declined");

  return (
    <div className="space-y-4">
      <JourneyHeader title="Safe Arrival" tone="arrived" />

      <JourneyVisual tone="arrived" className="min-h-[10rem]">
        <JourneyMark tone="arrived" large />
        <div className="text-center">
          <h2 className="text-xl font-semibold tracking-tight">You arrived safely</h2>
          <p className="mt-1 text-sm font-semibold tabular-nums text-emerald-600 dark:text-emerald-400">
            {journeyTime(journey.confirmedAt)}
          </p>
        </div>
      </JourneyVisual>

      {notified.length > 0 ? (
        <div className="rounded-[1.25rem] border border-border/70 bg-card/60 p-4">
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm font-semibold">Watchers notified</p>
            <p className="shrink-0 text-xs font-medium text-emerald-600 dark:text-emerald-400">All notified</p>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <div className="flex -space-x-2">
              {notified.slice(0, 5).map((watcher) => (
                <span key={watcher.id} className="rounded-full ring-2 ring-card">
                  <UserAvatar src={watcher.avatarUrl} name={watcher.name} size="sm" decorative />
                </span>
              ))}
            </div>
            <p className="min-w-0 flex-1 text-xs text-muted-foreground">
              {notified.map((watcher) => watcher.name).join(", ")}
            </p>
          </div>
        </div>
      ) : null}

      <div className="rounded-[1.25rem] border border-border/70 bg-card/60 px-4">
        <p className="pt-4 text-sm font-semibold">Journey summary</p>
        <dl className="divide-y divide-border/60 pb-1">
          <SummaryRow label="Destination" value={journey.destinationLabel} />
          <SummaryRow label="Started" value={journeyDayTime(journey.startedAt, nowMs)} />
          <SummaryRow label="Expected arrival" value={journeyTime(journey.expectedArrivalAt)} />
          <SummaryRow label="Arrived" value={journeyTime(journey.confirmedAt)} />
          <SummaryRow label="Grace period" value={`${journey.gracePeriodMinutes} min`} />
        </dl>
      </div>

      <Button type="button" size="lg" variant="outline" className="w-full" onClick={onDone}>
        Done
      </Button>
    </div>
  );
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-3">
      <dt className="shrink-0 text-xs text-muted-foreground">{label}</dt>
      <dd className="min-w-0 truncate text-sm font-semibold">{value}</dd>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Shared chrome
// ---------------------------------------------------------------------------

function JourneyHeader({ title, tone }: { title: string; tone: Parameters<typeof JourneyStatusChip>[0]["tone"] }) {
  return (
    <header className="flex flex-col items-center gap-2 px-1">
      <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
      <JourneyStatusChip tone={tone} />
    </header>
  );
}

function RealtimeNotice({ onRetry }: { onRetry: () => void }) {
  return (
    <div
      className="flex flex-wrap items-center gap-2 rounded-[1rem] bg-amber-500/10 px-3 py-2.5 text-xs text-amber-700 dark:text-amber-300"
      role="status"
    >
      <WifiOff className="h-4 w-4 shrink-0" aria-hidden="true" />
      {/* Realtime is an enhancement: the journey and its alerts are already
          correct server-side, so this never blocks anything. */}
      <span className="min-w-0 flex-1">Live updates are paused. Everything else still works.</span>
      <button
        type="button"
        onClick={onRetry}
        className="focus-ring safe-motion inline-flex min-h-9 items-center gap-1 rounded-lg px-2 font-semibold hover:bg-amber-500/10"
      >
        <RefreshCcw className="h-3.5 w-3.5" aria-hidden="true" />
        Refresh
      </button>
    </div>
  );
}

function WatcherListModal({
  open,
  onOpenChange,
  journey
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  journey: SafeArrivalJourney;
}) {
  return (
    <Modal open={open} onOpenChange={onOpenChange} title="Watching over you" variant="sheet" compact>
      <ul className="space-y-1.5">
        {journey.watchers.map((watcher) => (
          <li key={watcher.id} className="flex items-center gap-3 rounded-xl border border-border/70 px-3 py-2.5">
            <UserAvatar src={watcher.avatarUrl} name={watcher.name} size="sm" decorative />
            <span className="min-w-0 flex-1 truncate text-sm font-medium">{watcher.name}</span>
            <span
              className={cn(
                "shrink-0 text-xs font-semibold",
                watcher.state === "watching"
                  ? "text-emerald-600 dark:text-emerald-400"
                  : watcher.state === "declined"
                    ? "text-muted-foreground"
                    : "text-orange-600 dark:text-orange-300"
              )}
            >
              {watcher.state === "watching" ? "Watching" : watcher.state === "declined" ? "Not this time" : "Invited"}
            </span>
          </li>
        ))}
      </ul>
      <p className="mt-3 text-xs text-muted-foreground">
        Everyone here is notified when you arrive, extend, or don&apos;t confirm. Invited Muddies are alerted
        even if they haven&apos;t opened the request.
      </p>
    </Modal>
  );
}

function WatchingSummaryRow({ journey, nowMs }: { journey: SafeArrivalJourney; nowMs: number }) {
  const tone = journeyTone(journey, nowMs);
  return (
    // A plain anchor, deliberately, NOT next/link. This navigates to the same
    // pathname with a different query string. NavigationWatchdog arms on any
    // same-origin anchor click whose href differs from the current URL, and
    // clears only when usePathname() changes — which it would not here. A
    // client-side Link would therefore leave the watchdog armed and fire a false
    // "navigation did not complete" warning 15s later. A real document load
    // unmounts the watchdog with the rest of the tree, so it cannot misfire.
    <a
      href={`/safe-arrival?session=${journey.id}`}
      className="focus-ring safe-motion flex min-h-16 items-center gap-3 rounded-[1.25rem] border border-border/70 bg-card/60 px-4 py-3 hover:bg-secondary/40"
    >
      <UserAvatar src={journey.travellerAvatarUrl} name={journey.travellerName} size="sm" decorative />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold">{journey.travellerName}</span>
        <span className="block truncate text-xs text-muted-foreground">
          {journey.destinationLabel} · by {journeyTime(journey.expectedArrivalAt)}
        </span>
      </span>
      <JourneyStatusChip tone={tone} />
      <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
    </a>
  );
}
