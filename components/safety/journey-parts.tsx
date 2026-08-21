"use client";

import { Check, Clock, MapPin, UserRound } from "lucide-react";
import type { ReactNode } from "react";
import { UserAvatar } from "@/components/ui/user-avatar";
import { useReducedMotion } from "@/hooks/use-reduced-motion";
import { safeArrivalArtworkForTone } from "@/lib/visuals/registry";
import {
  contactCoverageSummary,
  contactPeerSummary,
  durationUntilLabel,
  gracePeriodEndMs
} from "@/lib/safety/safe-arrival";
import type { SafeArrivalContact, SafeArrivalJourney } from "@/lib/safety/safe-arrival-service";
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
  /* Supporting artwork, where the state has any.
   *
   * Sits BEHIND everything at low opacity: the status, timing and controls in
   * `children` remain the readable content, and the existing tone gradient
   * still carries the meaning. `overdue` and `ended` resolve to null, so a
   * not-yet-confirmed journey and a finished one look exactly as they did. */
  const artwork = safeArrivalArtworkForTone(tone);
  return (
    <div
      className={cn(
        "journey-scene relative isolate flex w-full items-center justify-center overflow-hidden rounded-[1.5rem]",
        `journey-scene-${tone}`,
        className
      )}
    >
      {artwork ? (
        // eslint-disable-next-line @next/next/no-img-element -- static local asset
        <img
          src={artwork.path}
          alt=""
          aria-hidden="true"
          loading="lazy"
          decoding="async"
          width={artwork.width}
          height={artwork.height}
          /* NO mix-blend-luminosity.
           *
           * Luminosity discards the photograph's colour and keeps only its
           * lightness, which drained the scene's warm orange gradient to grey
           * and cost the dashed path and pin their contrast -- the artwork was
           * fighting the design rather than supporting it. `soft-light` keeps
           * the tone gradient dominant and lets the image add texture beneath
           * it, at a low enough opacity that the mark stays the brightest
           * thing in the frame. */
          className="pointer-events-none absolute inset-0 h-full w-full object-cover opacity-[0.22] mix-blend-soft-light"
        />
      ) : null}
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
// Contact strip
// ---------------------------------------------------------------------------

/** A single avatar, which may be an anonymous contact this viewer may not name. */
function ContactAvatar({ contact, animate }: { contact: SafeArrivalContact; animate: boolean }) {
  return (
    <span className="relative">
      <span
        className={cn(
          "journey-watcher rounded-full ring-2 ring-card",
          animate && contact.state === "accepted" && "journey-watcher-pulse"
        )}
      >
        {contact.name ? (
          <UserAvatar src={contact.avatarUrl} name={contact.name} size="sm" decorative />
        ) : (
          // No id, name or avatar for this person was ever sent to the client.
          // The placeholder is not a hidden profile, it is the absence of one.
          <span
            className="grid h-9 w-9 place-items-center rounded-full bg-secondary text-muted-foreground"
            aria-hidden="true"
          >
            <UserRound className="h-4 w-4" />
          </span>
        )}
      </span>
      {contact.state === "accepted" ? (
        <span
          className="absolute -bottom-0.5 -right-0.5 grid h-4 w-4 place-items-center rounded-full bg-emerald-500 ring-2 ring-card"
          aria-hidden="true"
        >
          <Check className="h-2.5 w-2.5 text-white" strokeWidth={4} />
        </span>
      ) : null}
    </span>
  );
}

/**
 * "Checking in on you" for the traveller, "You and N others" for a contact.
 *
 * Two rules are enforced here rather than in callers:
 *
 *  1. Counts come from the canonical `acceptedCount` / `invitedCount` the server
 *     derived, NOT from the length of the avatar list. Privacy filtering can make
 *     that list shorter than the real roster, and an invitation is not cover, so
 *     deriving the number from what happens to be rendered has been wrong in both
 *     directions before.
 *  2. A contact with no name is rendered as an anonymous placeholder. The server
 *     already withheld their identity; nothing here can reveal it.
 */
export function ContactStrip({
  contacts,
  acceptedCount,
  invitedCount,
  viewerIsTraveller,
  maxVisible = 4,
  onOpenList
}: {
  contacts: SafeArrivalContact[];
  acceptedCount: number;
  invitedCount: number;
  viewerIsTraveller: boolean;
  maxVisible?: number;
  onOpenList?: () => void;
}) {
  const reducedMotion = useReducedMotion();
  const visible = contacts.slice(0, maxVisible);
  const overflow = contacts.length - visible.length;

  const summary = contactCoverageSummary({ acceptedCount, invitedCount });
  // A contact is told how many OTHER people accepted, never who they are.
  const otherAccepted = acceptedCount - (contacts.some((contact) => contact.isSelf && contact.state === "accepted") ? 1 : 0);
  const headline = viewerIsTraveller ? "Checking in on you" : contactPeerSummary(otherAccepted);
  const detail = viewerIsTraveller
    ? summary.detail
    : invitedCount > 0
      ? `${acceptedCount} confirmed · ${invitedCount} awaiting response`
      : `${acceptedCount} confirmed`;

  if (contacts.length === 0 && acceptedCount === 0 && invitedCount === 0) {
    return (
      <div className="rounded-[1.25rem] border border-border/70 bg-card/60 p-4">
        <p className="text-sm font-semibold">{viewerIsTraveller ? "Checking in on you" : "Safe Arrival contacts"}</p>
        <p className="mt-1 text-xs text-muted-foreground">Nobody is set to check in on this journey.</p>
      </div>
    );
  }

  const body = (
    <>
      <div className="flex items-baseline justify-between gap-3">
        <p className="min-w-0 truncate text-sm font-semibold">
          {viewerIsTraveller && acceptedCount === 0 ? summary.headline : headline}
        </p>
        <p className="shrink-0 text-xs text-muted-foreground">{detail}</p>
      </div>
      {visible.length > 0 ? (
        <div className="mt-3 flex items-start gap-3">
          {visible.map((contact) => (
            <div key={contact.key} className="flex min-w-0 flex-col items-center gap-1.5">
              <ContactAvatar contact={contact} animate={!reducedMotion} />
              <span className="max-w-[4.5rem] truncate text-[0.6875rem] text-muted-foreground">
                {contact.isSelf ? "You" : contact.name ? contact.name.split(" ")[0] : "Muddy"}
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
      ) : null}
      {/* State is announced too, so the green check is never the only carrier. */}
      <p className="sr-only">
        {detail}.{" "}
        {visible
          .map(
            (contact) =>
              `${contact.isSelf ? "You" : (contact.name ?? "Another Muddy")}: ${
                contact.state === "accepted" ? "confirmed" : "awaiting response"
              }`
          )
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
      aria-label={`${headline}. ${detail}. Open the full list.`}
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
