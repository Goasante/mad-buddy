"use client";

import { ArrowRight, Check, Clock, MapPin, UserRound } from "lucide-react";
import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { acknowledgeSafeArrivalAction } from "@/app/(app)/safe-arrival-actions";
import { Button } from "@/components/ui/button";
import { UserAvatar } from "@/components/ui/user-avatar";
import { useJourneyClock, useJourneyRealtime } from "@/hooks/use-journey-realtime";
import { useReducedMotion } from "@/hooks/use-reduced-motion";
import { contactCoverageSummary, durationUntilLabel } from "@/lib/safety/safe-arrival";
import type { SafeArrivalContact, SafeArrivalJourney } from "@/lib/safety/safe-arrival-service";
import { cn } from "@/lib/utils";
import { journeyTime, journeyTone, type JourneyTone } from "@/components/safety/journey-parts";

/**
 * Safe Arrival on Home.
 *
 * Three states, all built from canonical server data: the traveller's own live
 * journey, a journey the viewer has accepted, and a pending invitation. The
 * shield is deliberately not the dominant visual. The journey and the PEOPLE are,
 * since people are the point of the feature.
 *
 * The progress rail is time-based and decorative. It is derived from started_at,
 * expected_arrival_at and the clock, never from a position, and it is
 * `aria-hidden` so it is never announced as movement.
 */

const TONE_TEXT: Record<JourneyTone, string> = {
  transit: "text-orange-600 dark:text-orange-300",
  extended: "text-orange-600 dark:text-orange-300",
  overdue: "text-red-600 dark:text-red-300",
  arrived: "text-emerald-600 dark:text-emerald-400",
  ended: "text-muted-foreground"
};

const TONE_LABEL: Record<JourneyTone, string> = {
  transit: "IN TRANSIT",
  extended: "EXTENDED",
  overdue: "NOT CHECKED IN",
  arrived: "ARRIVED",
  ended: "ENDED"
};

function CardShell({ children, tone }: { children: React.ReactNode; tone: JourneyTone }) {
  return (
    <div className={cn("journey-home-card relative overflow-hidden rounded-[1.25rem] p-4", `journey-home-${tone}`)}>
      {children}
    </div>
  );
}

function StatusLine({ tone, prefix = "SAFE ARRIVAL" }: { tone: JourneyTone; prefix?: string }) {
  return (
    <p className="flex items-center gap-1.5 text-[0.625rem] font-bold uppercase tracking-[0.1em] text-muted-foreground">
      {prefix}
      <span aria-hidden="true">·</span>
      <span className={TONE_TEXT[tone]}>{TONE_LABEL[tone]}</span>
    </p>
  );
}

/**
 * Elapsed share of the planned window. Purely a clock reading: at the halfway
 * point in TIME the rail sits halfway, wherever the traveller actually is.
 */
function timeElapsedPercent(journey: SafeArrivalJourney, nowMs: number): number {
  const start = Date.parse(journey.startedAt);
  const end = Date.parse(journey.expectedArrivalAt);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return 100;
  return Math.min(100, Math.max(0, ((nowMs - start) / (end - start)) * 100));
}

function JourneyRail({ journey, nowMs, tone }: { journey: SafeArrivalJourney; nowMs: number; tone: JourneyTone }) {
  const reducedMotion = useReducedMotion();
  const percent = timeElapsedPercent(journey, nowMs);
  return (
    <div className="mt-3" aria-hidden="true">
      <div className="flex items-center gap-2">
        <span className="shrink-0 text-[0.625rem] font-semibold text-muted-foreground">You</span>
        <span className="journey-rail relative h-1.5 min-w-0 flex-1 rounded-full">
          <span
            className={cn("journey-rail-fill absolute inset-y-0 left-0 rounded-full", !reducedMotion && "journey-rail-glow")}
            style={{ width: `${percent}%` }}
          />
          <span
            className={cn("journey-rail-dot absolute top-1/2 h-2.5 w-2.5 -translate-y-1/2 rounded-full")}
            style={{ left: `calc(${percent}% - 0.3125rem)` }}
          />
        </span>
        <span
          className={cn(
            "grid h-4 w-4 shrink-0 place-items-center rounded-full border",
            tone === "arrived" ? "border-emerald-500 bg-emerald-500" : "border-border bg-transparent"
          )}
        >
          {tone === "arrived" ? <Check className="h-2.5 w-2.5 text-white" strokeWidth={4} /> : null}
        </span>
        <span className="shrink-0 text-[0.625rem] font-semibold text-muted-foreground">Arrival</span>
      </div>
    </div>
  );
}

/** Compact avatar row that renders anonymous contacts as placeholders. */
function ContactAvatars({ contacts, max = 4 }: { contacts: SafeArrivalContact[]; max?: number }) {
  const visible = contacts.slice(0, max);
  const overflow = contacts.length - visible.length;
  if (visible.length === 0) return null;
  return (
    <div className="flex -space-x-2">
      {visible.map((contact) => (
        <span key={contact.key} className="rounded-full ring-2 ring-card">
          {contact.name ? (
            <UserAvatar src={contact.avatarUrl} name={contact.name} size="xs" decorative />
          ) : (
            <span className="grid h-7 w-7 place-items-center rounded-full bg-secondary text-muted-foreground" aria-hidden="true">
              <UserRound className="h-3.5 w-3.5" />
            </span>
          )}
        </span>
      ))}
      {overflow > 0 ? (
        <span className="grid h-7 w-7 place-items-center rounded-full bg-secondary text-[0.625rem] font-semibold ring-2 ring-card">
          +{overflow}
        </span>
      ) : null}
    </div>
  );
}

function ViewJourneyLink({ label = "View journey" }: { label?: string }) {
  return (
    <Link
      href="/safe-arrival"
      prefetch={false}
      className="focus-ring safe-motion mt-3 inline-flex min-h-9 items-center gap-1 rounded-full text-xs font-semibold text-orange-600 hover:gap-1.5 dark:text-orange-300"
    >
      {label}
      <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
    </Link>
  );
}

// ---------------------------------------------------------------------------
// Traveller
// ---------------------------------------------------------------------------

export function TravellerJourneyHomeCard({ journey }: { journey: SafeArrivalJourney }) {
  const nowMs = useJourneyClock(true);
  const tone = journeyTone(journey, nowMs);
  // Realtime only refreshes; the counts below are already canonical.
  useJourneyRealtime({ sessionId: journey.id, watchContacts: true, enabled: tone !== "arrived" && tone !== "ended" });

  const remaining = durationUntilLabel(Date.parse(journey.expectedArrivalAt), nowMs);
  const summary = contactCoverageSummary({
    acceptedCount: journey.acceptedCount,
    invitedCount: journey.invitedCount
  });

  return (
    <CardShell tone={tone}>
      <StatusLine tone={tone} />

      <div className="mt-2 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 text-base font-semibold">
            <MapPin className={cn("h-4 w-4 shrink-0", TONE_TEXT[tone])} aria-hidden="true" />
            <span className="min-w-0 truncate">Heading to {journey.destinationLabel}</span>
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Expected by {journeyTime(journey.expectedArrivalAt)}
          </p>
        </div>
        <p className={cn("shrink-0 text-xs font-semibold tabular-nums", TONE_TEXT[tone])}>
          {remaining ? `${remaining} left` : tone === "overdue" ? "Not checked in" : "Time reached"}
        </p>
      </div>

      <JourneyRail journey={journey} nowMs={nowMs} tone={tone} />

      <div className="mt-3.5 flex items-center gap-2.5 border-t border-border/50 pt-3">
        <ContactAvatars contacts={journey.contacts} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs font-semibold">
            {journey.acceptedCount === 0 ? summary.headline : "Checking in on you"}
          </p>
          {/* Straight from canonical status: an invitation is never counted as
              confirmed cover. */}
          <p className="truncate text-[0.6875rem] text-muted-foreground">{summary.detail}</p>
        </div>
      </div>

      <ViewJourneyLink />
    </CardShell>
  );
}

// ---------------------------------------------------------------------------
// Accepted contact
// ---------------------------------------------------------------------------

export function ContactJourneyHomeCard({ journey }: { journey: SafeArrivalJourney }) {
  const nowMs = useJourneyClock(true);
  const tone = journeyTone(journey, nowMs);
  useJourneyRealtime({ sessionId: journey.id, watchContacts: false, enabled: tone !== "arrived" && tone !== "ended" });

  const remaining = durationUntilLabel(Date.parse(journey.expectedArrivalAt), nowMs);
  const firstName = journey.travellerName.split(" ")[0];

  return (
    <CardShell tone={tone}>
      <StatusLine tone={tone} />

      <div className="mt-2 flex items-start gap-3">
        <UserAvatar src={journey.travellerAvatarUrl} name={journey.travellerName} size="sm" decorative />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold">Checking in on {firstName}</p>
          <p className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
            <MapPin className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            {/* The destination LABEL the traveller chose to share. Nothing more. */}
            <span className="min-w-0 truncate">Heading to {journey.destinationLabel}</span>
          </p>
          <p className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
            <Clock className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            Expected by {journeyTime(journey.expectedArrivalAt)}
            {remaining ? <span className={cn("font-semibold", TONE_TEXT[tone])}>· {remaining} left</span> : null}
          </p>
        </div>
      </div>

      <JourneyRail journey={journey} nowMs={nowMs} tone={tone} />

      <p className="mt-3 border-t border-border/50 pt-3 text-[0.6875rem] leading-5 text-muted-foreground">
        {tone === "arrived"
          ? `${firstName} arrived safely.`
          : tone === "overdue"
            ? `${firstName} hasn't checked in yet.`
            : `We'll let you know when ${firstName} checks in.`}
      </p>

      <ViewJourneyLink />
    </CardShell>
  );
}

// ---------------------------------------------------------------------------
// Pending invitation
// ---------------------------------------------------------------------------

/**
 * A pending invitation, visually distinct from an accepted journey.
 *
 * The response is persisted server-side FIRST; only once the action reports
 * success does the card leave the invitation state. Accepting swaps it straight
 * to the accepted presentation using the journey the server returned, so it never
 * lingers as an unanswered invite.
 */
export function ContactInvitationHomeCard({ journey }: { journey: SafeArrivalJourney }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [resolved, setResolved] = useState<SafeArrivalJourney | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const firstName = journey.travellerName.split(" ")[0];

  function respond(response: "watching" | "declined") {
    setError(null);
    startTransition(async () => {
      const result = await acknowledgeSafeArrivalAction(journey.id, response);
      if (!result.ok) {
        setError(result.message);
        return;
      }
      if (response === "declined") setDismissed(true);
      else setResolved(result.journey ?? null);
      router.refresh();
    });
  }

  if (dismissed) return null;
  // Accepted: show the real accepted card immediately, from canonical data.
  if (resolved) return <ContactJourneyHomeCard journey={resolved} />;

  return (
    <div className="rounded-[1.25rem] border border-orange-400/30 bg-orange-400/[0.08] p-4">
      <p className="text-[0.625rem] font-bold uppercase tracking-[0.1em] text-orange-600 dark:text-orange-300">
        Safe Arrival request
      </p>

      <div className="mt-2 flex items-start gap-3">
        <UserAvatar src={journey.travellerAvatarUrl} name={journey.travellerName} size="sm" decorative />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold">Can you check on {firstName}?</p>
          <p className="mt-0.5 text-xs leading-5 text-muted-foreground">
            {firstName} wants you as a Safe Arrival contact. We&apos;ll let you know when they arrive or if they
            don&apos;t check in on time.
          </p>
        </div>
      </div>

      <dl className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs">
        <div className="flex items-center gap-1.5">
          <dt className="text-muted-foreground">Heading to</dt>
          <dd className="font-semibold">{journey.destinationLabel}</dd>
        </div>
        <div className="flex items-center gap-1.5">
          <dt className="text-muted-foreground">Expected arrival</dt>
          <dd className="font-semibold tabular-nums">{journeyTime(journey.expectedArrivalAt)}</dd>
        </div>
      </dl>

      {error ? (
        <p role="alert" className="mt-2 text-xs font-medium text-red-600 dark:text-red-300">
          {error}
        </p>
      ) : null}

      <div className="mt-3 flex gap-2">
        <Button type="button" size="sm" className="flex-1" disabled={isPending} onClick={() => respond("watching")}>
          {isPending ? "Saving…" : "Count me in"}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="flex-1"
          disabled={isPending}
          onClick={() => respond("declined")}
        >
          Not this time
        </Button>
      </div>
    </div>
  );
}
