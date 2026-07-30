"use client";

import { Check, Clock, MapPin } from "lucide-react";
import type { ReactNode } from "react";
import { UserAvatar } from "@/components/ui/user-avatar";
import { useReducedMotion } from "@/hooks/use-reduced-motion";
import { durationUntilLabel, gracePeriodEndMs } from "@/lib/safety/safe-arrival";
import type { SafeArrivalJourney, SafeArrivalWatcher } from "@/lib/safety/safe-arrival-service";
import { DEFAULT_RECIPIENT_TIMEZONE } from "@/lib/notifications/preferences";
import { cn } from "@/lib/utils";

/**
 * Shared Safe Arrival journey presentation. Every piece here renders STATUS and
 * TIME only. There is deliberately no map, no marker, no distance and no route:
 * the visual is symbolic, and the data model has no coordinates to leak even if
 * someone tried.
 */

// ---------------------------------------------------------------------------
// Time formatting
// ---------------------------------------------------------------------------

/**
 * "9:00 PM". Formatted in the product's default recipient timezone rather than
 * the viewer's, so the traveller and every watcher read the SAME clock time for
 * the same journey — a watcher abroad seeing "4:00 PM" for a 9pm Accra arrival
 * would be actively misleading in a safety feature.
 */
export function journeyTime(iso: string | null | undefined): string {
  if (!iso) return "";
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return "";
  return new Date(ms).toLocaleTimeString("en-GB", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone: DEFAULT_RECIPIENT_TIMEZONE
  });
}

/** "Today · 9:00 PM" / "Tomorrow · 12:30 AM" / "Fri · 6:15 PM". */
export function journeyDayTime(iso: string | null | undefined, nowMs: number): string {
  if (!iso) return "";
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return "";
  const date = new Date(ms);
  const now = new Date(nowMs);
  const startOfDay = (value: Date) => new Date(value.getFullYear(), value.getMonth(), value.getDate()).getTime();
  const diffDays = Math.round((startOfDay(date) - startOfDay(now)) / 86_400_000);
  const day =
    diffDays === 0 ? "Today" : diffDays === 1 ? "Tomorrow" : date.toLocaleDateString([], { weekday: "short" });
  return `${day} · ${journeyTime(iso)}`;
}

// ---------------------------------------------------------------------------
// Status chip
// ---------------------------------------------------------------------------

export type JourneyTone = "transit" | "extended" | "overdue" | "arrived" | "ended";

/**
 * Derives the display tone from canonical status plus the server-stored timing.
 * Orange for a journey in progress, green for a confirmed arrival, red reserved
 * for overdue — never used decoratively.
 */
export function journeyTone(journey: SafeArrivalJourney, nowMs: number): JourneyTone {
  if (journey.status === "completed") return "arrived";
  if (journey.status === "cancelled" || journey.status === "expired") return "ended";
  if (journey.status === "unconfirmed") return "overdue";
  const expectedMs = Date.parse(journey.expectedArrivalAt);
  const graceEnd = gracePeriodEndMs({
    expectedArrivalMs: expectedMs,
    gracePeriodMinutes: journey.gracePeriodMinutes
  });
  // Past the grace deadline but the job has not stamped it yet: show the
  // traveller and watcher the truth rather than a stale "in transit".
  if (Number.isFinite(graceEnd) && nowMs >= graceEnd) return "overdue";
  if (journey.status === "extended") return "extended";
  return "transit";
}

const TONE_LABEL: Record<JourneyTone, string> = {
  transit: "IN TRANSIT",
  extended: "EXTENDED",
  overdue: "NOT CONFIRMED",
  arrived: "ARRIVED",
  ended: "ENDED"
};

const TONE_CHIP: Record<JourneyTone, string> = {
  transit: "border-orange-400/30 bg-orange-400/12 text-orange-700 dark:text-orange-200",
  extended: "border-orange-400/30 bg-orange-400/12 text-orange-700 dark:text-orange-200",
  overdue: "border-red-400/30 bg-red-400/12 text-red-700 dark:text-red-200",
  arrived: "border-emerald-400/30 bg-emerald-400/12 text-emerald-700 dark:text-emerald-200",
  ended: "border-border bg-secondary text-muted-foreground"
};

export function JourneyStatusChip({ tone, className }: { tone: JourneyTone; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-[0.6875rem] font-bold uppercase tracking-[0.08em]",
        TONE_CHIP[tone],
        className
      )}
    >
      <span
        className={cn(
          "h-1.5 w-1.5 rounded-full",
          tone === "arrived"
            ? "bg-emerald-500"
            : tone === "overdue"
              ? "bg-red-500"
              : tone === "ended"
                ? "bg-muted-foreground"
                : "bg-orange-500"
        )}
        aria-hidden="true"
      />
      {TONE_LABEL[tone]}
    </span>
  );
}

// ---------------------------------------------------------------------------
// The symbolic journey visual
// ---------------------------------------------------------------------------

/**
 * A destination motif: a dashed path curving up to a pin. Purely decorative and
 * `aria-hidden` — it encodes nothing, and in particular the dash offset is NOT
 * derived from progress, because there is no position to represent. The ambient
 * drift is very slow and stops entirely under prefers-reduced-motion.
 */
export function JourneyVisual({
  tone,
  className,
  children
}: {
  tone: JourneyTone;
  className?: string;
  children?: ReactNode;
}) {
  const reducedMotion = useReducedMotion();
  return (
    <div
      className={cn(
        "journey-scene relative isolate flex w-full items-center justify-center overflow-hidden rounded-[1.5rem]",
        `journey-scene-${tone}`,
        className
      )}
    >
      <svg
        className="journey-scene-path pointer-events-none absolute inset-0 h-full w-full"
        viewBox="0 0 320 160"
        preserveAspectRatio="none"
        aria-hidden="true"
        focusable="false"
      >
        <path
          d="M18 148 C 78 148, 96 96, 150 84 S 236 66, 300 26"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeDasharray="7 9"
          className={cn(!reducedMotion && "journey-scene-dash")}
        />
      </svg>
      <div className="relative z-10 flex flex-col items-center gap-3 px-4 py-6">{children}</div>
    </div>
  );
}

/** The pin/arrival mark that sits inside the scene. */
export function JourneyMark({ tone, large = false }: { tone: JourneyTone; large?: boolean }) {
  const reducedMotion = useReducedMotion();
  const isArrived = tone === "arrived";
  return (
    <span
      className={cn(
        "journey-pin relative grid place-items-center rounded-full",
        `journey-pin-${tone}`,
        large ? "h-20 w-20" : "h-16 w-16",
        !reducedMotion && (tone === "transit" || tone === "extended") && "journey-pin-breathe"
      )}
      aria-hidden="true"
    >
      {isArrived ? (
        <Check className={large ? "h-9 w-9" : "h-7 w-7"} strokeWidth={3} />
      ) : (
        <MapPin className={large ? "h-9 w-9" : "h-7 w-7"} />
      )}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Timeline
// ---------------------------------------------------------------------------

/**
 * Started → Expected arrival → Grace period ends.
 *
 * Each row is marked reached/pending against the SERVER-stored timestamps and
 * the current clock, so it stays truthful with the app closed and reopened. The
 * grace row is what makes the safety contract legible: it is the moment watchers
 * get told the confirmation has not landed.
 */
export function JourneyTimeline({
  journey,
  nowMs,
  className
}: {
  journey: SafeArrivalJourney;
  nowMs: number;
  className?: string;
}) {
  const expectedMs = Date.parse(journey.expectedArrivalAt);
  const graceEndMs = gracePeriodEndMs({
    expectedArrivalMs: expectedMs,
    gracePeriodMinutes: journey.gracePeriodMinutes
  });
  const arrivedMs = journey.confirmedAt ? Date.parse(journey.confirmedAt) : null;

  const rows: { label: string; time: string; reached: boolean; tone: "orange" | "green" | "muted" }[] = [
    { label: "Started", time: journeyTime(journey.startedAt), reached: true, tone: "orange" },
    {
      label: "Expected arrival",
      time: journeyTime(journey.expectedArrivalAt),
      reached: nowMs >= expectedMs,
      tone: "muted"
    }
  ];

  if (arrivedMs) {
    rows.push({ label: "Arrived", time: journeyTime(journey.confirmedAt), reached: true, tone: "green" });
  } else {
    rows.push({
      label: "Grace period ends",
      time: journeyTime(new Date(graceEndMs).toISOString()),
      reached: nowMs >= graceEndMs,
      tone: "muted"
    });
  }

  return (
    <div className={cn("rounded-[1.25rem] border border-border/70 bg-card/60 p-4", className)}>
      <p className="text-sm font-semibold">Journey timeline</p>
      <ul className="mt-3 space-y-0">
        {rows.map((row, index) => (
          <li key={row.label} className="relative flex items-center gap-3 py-1.5">
            {index < rows.length - 1 ? (
              <span
                className="absolute left-[0.3125rem] top-[1.6rem] h-[calc(100%-0.7rem)] w-px bg-border"
                aria-hidden="true"
              />
            ) : null}
            <span
              className={cn(
                "relative z-10 h-2.5 w-2.5 shrink-0 rounded-full ring-2 ring-card",
                row.reached
                  ? row.tone === "green"
                    ? "bg-emerald-500"
                    : "bg-orange-500"
                  : "border border-border bg-secondary"
              )}
              aria-hidden="true"
            />
            <span className={cn("min-w-0 flex-1 truncate text-sm", row.reached ? "font-medium" : "text-muted-foreground")}>
              {row.label}
            </span>
            <span className="shrink-0 text-sm tabular-nums text-muted-foreground">{row.time}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Watcher strip
// ---------------------------------------------------------------------------

/**
 * "Watching over you" — real watcher data only.
 *
 * Everyone the traveller CHOSE is shown, including those who have not answered
 * yet. Showing only accepted watchers is what previously made a freshly started
 * journey look like nobody had been invited. An accepted watcher carries a check
 * so cover is still distinguishable at a glance; a declined watcher is dropped,
 * since they will not be alerted.
 */
export function WatcherStrip({
  watchers,
  title,
  emptyLabel,
  maxVisible = 4,
  onOpenList
}: {
  watchers: SafeArrivalWatcher[];
  title: string;
  emptyLabel?: string;
  maxVisible?: number;
  onOpenList?: () => void;
}) {
  const reducedMotion = useReducedMotion();
  const alertable = watchers.filter((watcher) => watcher.state !== "declined");
  const visible = alertable.slice(0, maxVisible);
  const overflow = alertable.length - visible.length;

  if (alertable.length === 0) {
    return emptyLabel ? (
      <div className="rounded-[1.25rem] border border-border/70 bg-card/60 p-4">
        <p className="text-sm font-semibold">{title}</p>
        <p className="mt-1 text-xs text-muted-foreground">{emptyLabel}</p>
      </div>
    ) : null;
  }

  const body = (
    <>
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm font-semibold">{title}</p>
        <p className="shrink-0 text-xs text-muted-foreground">
          {alertable.length} {alertable.length === 1 ? "Muddy" : "Muddies"}
        </p>
      </div>
      <div className="mt-3 flex items-start gap-3">
        {visible.map((watcher) => (
          <div key={watcher.id} className="flex min-w-0 flex-col items-center gap-1.5">
            <span className="relative">
              <span
                className={cn(
                  "journey-watcher rounded-full ring-2 ring-card",
                  !reducedMotion && watcher.state === "watching" && "journey-watcher-pulse"
                )}
              >
                <UserAvatar src={watcher.avatarUrl} name={watcher.name} size="sm" decorative />
              </span>
              {watcher.state === "watching" ? (
                <span
                  className="absolute -bottom-0.5 -right-0.5 grid h-4 w-4 place-items-center rounded-full bg-emerald-500 ring-2 ring-card"
                  aria-hidden="true"
                >
                  <Check className="h-2.5 w-2.5 text-white" strokeWidth={4} />
                </span>
              ) : null}
            </span>
            <span className="max-w-[4.5rem] truncate text-[0.6875rem] text-muted-foreground">
              {watcher.name.split(" ")[0]}
            </span>
          </div>
        ))}
        {overflow > 0 ? (
          <div className="flex flex-col items-center gap-1.5">
            <span className="grid h-9 w-9 place-items-center rounded-full bg-secondary text-xs font-semibold ring-2 ring-card">
              +{overflow}
            </span>
            <span className="text-[0.6875rem] text-muted-foreground">more</span>
          </div>
        ) : null}
      </div>
      {/* Screen readers get the full roster and each person's state, so the
          check badge is never the only carrier of that information. */}
      <p className="sr-only">
        {alertable
          .map((watcher) => `${watcher.name}: ${watcher.state === "watching" ? "watching" : "invited"}`)
          .join(". ")}
      </p>
    </>
  );

  if (!onOpenList) {
    return <div className="rounded-[1.25rem] border border-border/70 bg-card/60 p-4">{body}</div>;
  }
  return (
    <button
      type="button"
      onClick={onOpenList}
      aria-label={`${title}. ${alertable.length} chosen. Open the full list.`}
      className="focus-ring safe-motion w-full rounded-[1.25rem] border border-border/70 bg-card/60 p-4 text-left hover:bg-secondary/40"
    >
      {body}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Countdown line
// ---------------------------------------------------------------------------

/** "Arriving by 9:00 PM" + "Arrives in 2h 15m", or the overdue equivalent. */
export function JourneyCountdown({ journey, nowMs }: { journey: SafeArrivalJourney; nowMs: number }) {
  const expectedMs = Date.parse(journey.expectedArrivalAt);
  const remaining = durationUntilLabel(expectedMs, nowMs);
  const tone = journeyTone(journey, nowMs);

  if (tone === "arrived") {
    return (
      <p className="text-sm text-muted-foreground">
        Arrived {journeyTime(journey.confirmedAt)}
      </p>
    );
  }

  return (
    <>
      <p className="text-sm text-muted-foreground">Arriving by {journeyTime(journey.expectedArrivalAt)}</p>
      {remaining ? (
        <p className="text-sm font-semibold text-orange-600 dark:text-orange-300">Arrives in {remaining}</p>
      ) : (
        <p
          className={cn(
            "flex items-center gap-1.5 text-sm font-semibold",
            tone === "overdue" ? "text-red-600 dark:text-red-300" : "text-orange-600 dark:text-orange-300"
          )}
        >
          <Clock className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          {tone === "overdue" ? "Arrival not confirmed" : "Arrival time reached"}
        </p>
      )}
    </>
  );
}
