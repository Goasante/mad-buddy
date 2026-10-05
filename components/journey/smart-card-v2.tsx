"use client";

import { useFeatureAvailability } from "@/components/features/feature-availability-context";
import { availableSmartCard } from "@/lib/smart-card/availability";

import type { Route } from "next";
import Link from "next/link";
import { ArrowRight, CalendarDays, CircleHelp, Clock, MapPin, ShieldCheck, UsersRound } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";

import { openDirectConversationAction } from "@/app/(app)/messaging-actions";
import { acknowledgeSmartCardAction } from "@/app/(app)/smart-card-actions";
import { useReducedMotion } from "@/hooks/use-reduced-motion";
import { conversationHref } from "@/lib/messaging/open-conversation";
import type { SmartCard } from "@/lib/smart-card/smart-card";
import { cn } from "@/lib/utils";
import { UserAvatar } from "@/components/ui/user-avatar";
import { SmartCardArtwork } from "@/components/journey/smart-card-artwork";

/** Compact Now panel. Providers retain content, priority and action authority.
 * Artwork illustrates a scenario; a display name is never a gender authority.
 * Neither real user photos nor activity photography become a card background. */
const MAX_BROWSER_TIMEOUT_MS = 2_147_000_000;
const HEARTBEAT_BOUNDARY_GRACE_MS = 2_000;
const HEARTBEAT_REFRESH_RETRIES = 2;
const HEARTBEAT_RETRY_MS = 5_000;

/** Which states describe a PLACE, so the metadata line gets a pin. */
const LOCATION_META_IDS = new Set<SmartCard["id"]>([
  "event_live",
  "event_starting",
  "event_commitment_starting",
  "nearby_muddies"
]);

function MetadataIcon({ card }: { card: SmartCard }) {
  if (card.metaKind === "location" || LOCATION_META_IDS.has(card.id)) {
    return <MapPin className="h-4 w-4 shrink-0" aria-hidden="true" />;
  }
  if (card.metaKind === "decision") {
    return <CircleHelp className="h-4 w-4 shrink-0" aria-hidden="true" />;
  }
  if (card.metaKind === "time" || card.metaKind === "status") {
    return <Clock className="h-4 w-4 shrink-0" aria-hidden="true" />;
  }
  if (card.id === "safe_arrival") {
    return <ShieldCheck className="h-4 w-4 shrink-0" aria-hidden="true" />;
  }
  return <CalendarDays className="h-4 w-4 shrink-0" aria-hidden="true" />;
}

export function SmartCardHeroV2({ card: inputCard, deferred = false }: { card: SmartCard; deferred?: boolean }) {
  const [pending, startTransition] = useTransition();
  const availability = useFeatureAvailability();
  const eligible = availability ? availableSmartCard(inputCard, availability) : inputCard;
  const card = eligible ?? inputCard;
  const [animatedPercent, setAnimatedPercent] = useState(0);
  const [intentPending, setIntentPending] = useState(false);
  const [intentError, setIntentError] = useState<string | null>(null);
  const router = useRouter();
  const reducedMotion = useReducedMotion();
  const percent = card.progress?.percent ?? 0;
  const quiet = deferred;
  const safety = card.id === "safe_arrival";

  useEffect(() => {
    if (reducedMotion) return;
    const frame = requestAnimationFrame(() => setAnimatedPercent(percent));
    return () => cancelAnimationFrame(frame);
  }, [percent, reducedMotion]);

  /**
   * The heartbeat must change while Home is OPEN, not only after a manual
   * refresh. Providers stamp the instant their fact stops being true (an Event
   * starts, a poll closes, an UpFor ends, etc.). At that boundary, ask the
   * server to choose the next truthful card.
   *
   * Two edge cases matter here:
   *   1. browser timeouts cap at ~24.8 days, so a distant Plan invitation must
   *      WAIT in chunks rather than refresh early and lose its timer;
   *   2. the phone clock can be a little ahead of the server. A small bounded
   *      retry window prevents the same expired-looking card from sticking if
   *      the first refresh lands just before the server's boundary.
   */
  useEffect(() => {
    if (card.expiresAt === undefined) return;

    let timer: number | null = null;
    let cancelled = false;
    let retries = 0;

    const refreshWithRetry = () => {
      if (cancelled) return;
      router.refresh();
      if (retries >= HEARTBEAT_REFRESH_RETRIES) return;
      retries += 1;
      timer = window.setTimeout(refreshWithRetry, HEARTBEAT_RETRY_MS);
    };

    const scheduleUntilBoundary = () => {
      if (cancelled) return;
      const remaining = card.expiresAt! - Date.now();

      if (remaining <= 0) {
        timer = window.setTimeout(refreshWithRetry, HEARTBEAT_BOUNDARY_GRACE_MS);
        return;
      }

      if (remaining > MAX_BROWSER_TIMEOUT_MS) {
        /* Do not refresh a still-valid card merely because setTimeout cannot
           hold the whole duration. Wake up at the ceiling and keep waiting. */
        timer = window.setTimeout(scheduleUntilBoundary, MAX_BROWSER_TIMEOUT_MS);
        return;
      }

      timer = window.setTimeout(
        refreshWithRetry,
        remaining + HEARTBEAT_BOUNDARY_GRACE_MS
      );
    };

    scheduleUntilBoundary();

    return () => {
      cancelled = true;
      if (timer !== null) window.clearTimeout(timer);
    };
  }, [card.expiresAt, router]);

  function acknowledgeIfNeeded() {
    if (!card.dismissible) return;
    startTransition(() => {
      void acknowledgeSmartCardAction(card.acknowledgementKey ?? card.id);
    });
  }

  async function runPrimaryIntent() {
    const intent = card.primaryIntent;
    if (!intent || intentPending) return;

    setIntentPending(true);
    setIntentError(null);
    try {
      const result = await openDirectConversationAction(intent.targetUserId);
      if (result.ok && result.conversationId) {
        acknowledgeIfNeeded();
        router.push(conversationHref(result.conversationId));
        return;
      }
      setIntentError(result.message || "That didn't work. Try again.");
    } catch {
      setIntentError("That didn't work. Try again.");
    } finally {
      setIntentPending(false);
    }
  }

  const primaryClassName = cn(
    "focus-ring inline-flex min-h-11 items-center min-w-0 max-w-full justify-center gap-1.5 rounded-xl bg-[#ed8924] px-3 py-2.5 text-xs font-semibold sm:gap-2 sm:px-4 sm:text-sm text-[#291507] transition-colors hover:bg-[#f09a3c] disabled:opacity-60"
  );
  const secondaryClassName = "focus-ring inline-flex min-h-11 min-w-0 max-w-full items-center rounded-xl px-2 py-2 text-sm font-medium text-muted-foreground underline-offset-4 hover:text-foreground hover:underline";
  const displayedPercent = reducedMotion ? percent : animatedPercent;
  if (!eligible) return null;

  return (
    <section aria-label="Now" className="space-y-2.5">
      <p className="text-base font-semibold tracking-tight text-foreground">Now</p>
      <article
        aria-busy={pending || intentPending || undefined}
        data-smart-card-visual={safety ? "safety" : quiet ? "quiet" : "illustrated"}
        data-smart-card-editorial="true"
        data-smart-card-id={card.id}
        className={cn(
          "relative rounded-[1.25rem] border border-[#ebdfcf] bg-[#fffaf2] p-4 text-foreground dark:border-white/10 dark:bg-[#211e19] sm:p-6",
          safety && "border-[#d8b896] dark:border-[#99724d]/50",
          quiet && "bg-background dark:bg-background"
        )}
      >
        <div className="grid grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] items-center gap-3 sm:gap-6">
          <div className="min-w-0">
            {card.eyebrow ? (
              <p className="mb-2 text-[0.65rem] font-semibold uppercase tracking-[0.1em] text-[#806449] dark:text-[#d7b28b]">{card.eyebrow}</p>
            ) : null}
            {card.person ? (
              <div className="mb-2 flex min-w-0 items-center gap-2">
                <UserAvatar src={card.person.avatarUrl} name={card.person.displayName} size="sm" decorative />
                <span className="break-words text-sm font-semibold">{card.person.displayName}</span>
              </div>
            ) : null}
            <h2 className="break-words text-balance text-base font-bold leading-tight tracking-[-0.025em] sm:text-2xl">{card.title}</h2>
            <p className="mt-2 break-words text-[0.8125rem] leading-relaxed text-muted-foreground sm:text-sm">{card.subtitle}</p>

            {card.meta || card.socialProof ? (
              <div className="mt-3 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2 text-xs font-medium text-muted-foreground">
                {card.meta ? <span className="inline-flex min-w-0 items-center gap-1.5"><MetadataIcon card={card} /><span className="break-words">{card.meta}</span></span> : null}
                {card.socialProof ? <span className="inline-flex min-w-0 items-center gap-1.5"><UsersRound className="h-4 w-4 shrink-0" aria-hidden="true" /><span className="break-words">{card.socialProof}</span></span> : null}
              </div>
            ) : null}

            {card.progress ? (
              <div className="mt-3">
                <div className="flex flex-wrap items-baseline justify-between gap-2 text-xs text-muted-foreground">
                  <span className="font-semibold tabular-nums text-foreground">{card.progress.percent}%</span>
                  <span>{card.progress.label}</span>
                </div>
                <div role="progressbar" aria-label={card.progress.label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={card.progress.percent} className="mt-2 h-1.5 overflow-hidden rounded-full bg-[#e9dfd1] dark:bg-white/10">
                  <div className="h-full origin-left rounded-full bg-[#ed8924] transition-transform duration-[700ms] ease-out motion-reduce:duration-0" style={{ transform: `scaleX(${displayedPercent / 100})` }} />
                </div>
              </div>
            ) : null}

            <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-2">
              {card.primaryIntent ? (
                <button type="button" onClick={runPrimaryIntent} disabled={intentPending} aria-busy={intentPending} className={primaryClassName}>
                  {intentPending ? "Opening…" : card.cta}
                  <ArrowRight className="h-4 w-4 shrink-0" aria-hidden="true" />
                </button>
              ) : (
                <Link href={card.destination as Route} onClick={acknowledgeIfNeeded} className={primaryClassName}>
                  <span className="break-words">{card.cta}</span><ArrowRight className="h-4 w-4 shrink-0" aria-hidden="true" />
                </Link>
              )}
              {card.secondaryAction ? <Link href={card.secondaryAction.destination as Route} className={secondaryClassName}>{card.secondaryAction.label}</Link> : null}
            </div>
            {intentError ? <p role="status" className="mt-2.5 text-xs font-medium text-foreground">{intentError}</p> : null}
          </div>
          <div className="pointer-events-none relative min-h-[10rem] w-full self-stretch [&>img]:absolute [&>img]:inset-0" aria-hidden="true" data-smart-card-artwork-frame="true">
            <SmartCardArtwork card={card} />
          </div>
        </div>
      </article>
    </section>
  );
}
