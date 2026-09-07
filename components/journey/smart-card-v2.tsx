"use client";

import type { Route } from "next";
import Image from "next/image";
import Link from "next/link";
import { CalendarDays, MapPin, ShieldCheck, UsersRound } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";

import { openDirectConversationAction } from "@/app/(app)/messaging-actions";
import { acknowledgeSmartCardAction } from "@/app/(app)/smart-card-actions";
import { useReducedMotion } from "@/hooks/use-reduced-motion";
import { conversationHref } from "@/lib/messaging/open-conversation";
import type { SmartCard } from "@/lib/smart-card/smart-card";
import { smartCardVisualTreatment } from "@/lib/smart-card/visuals";
import { cn } from "@/lib/utils";
import { homeCardBBackground } from "@/lib/visuals/registry";

/**
 * Smart Card B — editorial / cinematic Home presentation.
 *
 * Product authority is unchanged: providers decide WHAT matters and this
 * component decides only HOW to present it. Home still has Card A, Card B and
 * NearbyHero as separate authorities, so `deferred` remains a visual-volume
 * rule rather than a ranking change.
 *
 * PERSON ART RULE: a display name is never a gender authority. Truthful,
 * viewer-authorized person/event media wins whenever the card already carries
 * it. Otherwise the fallback art is deliberately mixed/neutral and represents
 * the social MOMENT, not the named person's appearance. A future explicit,
 * viewer-authorized presentation field may safely select gendered variants.
 */

const HOME_CARD_B_BACKGROUND = homeCardBBackground().path;

const PROMINENT_CARD_IDS = new Set<SmartCard["id"]>([
  "safe_arrival",
  "plan_rsvp",
  "plan_starting",
  "event_live",
  "nearby_muddies"
]);

/** Which states describe a PLACE, so the metadata line gets a pin. */
const LOCATION_META_IDS = new Set<SmartCard["id"]>([
  "event_live",
  "event_starting",
  "event_commitment_starting",
  "nearby_muddies"
]);

/* The five card-family id sets are gone with the atlas they served. Each one
   existed only to pick which of six illustrated scenes a card should crop --
   artwork chosen by state, which the fixed two-background system removes. The
   families themselves still live in the catalog, where they belong. */

/* The atlas position helpers are gone with the atlas. `fallbackAtlasPosition`
   cropped one of six scenes out of a sprite by card family, and `mediaPosition`
   honoured a photo's stored focal point -- both were ways of choosing artwork
   per state, which the fixed two-background system removes by design. */

function MetadataIcon({ card }: { card: SmartCard }) {
  if (card.id === "safe_arrival") return <ShieldCheck className="h-4 w-4 shrink-0" aria-hidden="true" />;
  if (LOCATION_META_IDS.has(card.id)) return <MapPin className="h-4 w-4 shrink-0" aria-hidden="true" />;
  return <CalendarDays className="h-4 w-4 shrink-0" aria-hidden="true" />;
}

export function SmartCardHeroV2({ card, deferred = false }: { card: SmartCard; deferred?: boolean }) {
  const [pending, startTransition] = useTransition();
  const [animatedPercent, setAnimatedPercent] = useState(0);
  const [intentPending, setIntentPending] = useState(false);
  const [intentError, setIntentError] = useState<string | null>(null);
  const router = useRouter();
  const reducedMotion = useReducedMotion();
  const percent = card.progress?.percent ?? 0;
  const prominent = PROMINENT_CARD_IDS.has(card.id);
  const treatment = smartCardVisualTreatment(card, deferred);
  const quiet = treatment === "quiet";
  const safety = treatment === "safety";
  const hasTruthfulMedia = Boolean(card.media?.url) && !safety;

  useEffect(() => {
    if (reducedMotion) return;
    const frame = requestAnimationFrame(() => setAnimatedPercent(percent));
    return () => cancelAnimationFrame(frame);
  }, [percent, reducedMotion]);

  function acknowledgeIfNeeded() {
    if (!card.dismissible) return;
    startTransition(() => {
      void acknowledgeSmartCardAction(card.id);
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
    "focus-ring inline-flex min-h-11 items-center min-w-0 flex-1 justify-center rounded-full px-4 py-2.5 text-sm font-extrabold transition-transform active:scale-[0.985] motion-reduce:active:scale-100 sm:flex-none sm:min-w-[9.5rem]",
    quiet
      ? "bg-[#e88c2b] text-white shadow-[0_8px_18px_rgba(232,140,43,0.18)]"
      : "bg-[#e88c2b] text-white shadow-[0_10px_24px_rgba(232,140,43,0.30)] hover:bg-[#f09a3c]"
  );

  const secondaryClassName = cn(
    "focus-ring inline-flex min-h-11 items-center min-w-0 flex-1 justify-center rounded-full border px-4 py-2.5 text-sm font-bold backdrop-blur-sm sm:flex-none sm:min-w-[8.75rem]",
    quiet
      ? "border-white/30 bg-black/20 text-white"
      : "border-white/60 bg-black/20 text-white hover:bg-black/30"
  );

  const displayedPercent = reducedMotion ? percent : animatedPercent;

  return (
    <article
      aria-busy={pending || undefined}
      data-smart-card-visual={treatment}
      data-smart-card-editorial="true"
      data-smart-card-id={card.id}
      className={cn(
        "safe-motion relative isolate overflow-hidden rounded-[1.35rem] border bg-[#090908] text-white",
        quiet
          ? "min-h-[11.25rem] border-white/[0.08] shadow-[0_8px_22px_rgba(20,8,3,0.12)]"
          : "border-white/[0.10] shadow-[0_18px_42px_rgba(35,12,4,0.25)]",
        prominent && !quiet ? "min-h-[15.5rem]" : !quiet ? "min-h-[14.25rem]" : null
      )}
    >
      {/* CARD B'S ONE GROUND, for every state it renders.
       *
       * This used to choose between two things by state: a truthful photo when
       * the card had one, otherwise a tile cropped out of a six-scene editorial
       * atlas keyed to the card family. Both are gone.
       *
       * Home now uses two fixed grounds -- Card A wears one, Card B wears the
       * other -- and neither is ever chosen by state. Rotating the art as the
       * card updates makes the same surface look like a different one every
       * time, which is the opposite of what an adaptive card needs: the person
       * should notice the WORDS changed, not the wallpaper. It also removed the
       * last way illustrated people could sit behind a named person's card.
       *
       * Only the content layer varies now -- eyebrow, headline, subtitle,
       * metadata, actions -- plus the scrim strength below, which still adapts
       * for legibility because a quiet card and a safety card need different
       * contrast over the same image. */}
      <div className="pointer-events-none absolute inset-0 z-0" aria-hidden="true">
        <Image
          src={HOME_CARD_B_BACKGROUND}
          alt=""
          fill
          priority={prominent}
          sizes="(max-width: 768px) 100vw, 430px"
          className={cn("object-cover object-center", quiet ? "opacity-45" : safety ? "opacity-72" : "opacity-88")}
        />

        {/* THE SCRIM IS PART OF THE FIXED TREATMENT.
            One ground has to work for every headline this card can render, so
            the contrast is tuned once rather than per state. Safety keeps its
            own maroon cast -- the one place the tone itself carries meaning --
            and the vertical pass below lifts the copy off the art at both
            edges. */}
        <span
          className={cn(
            "absolute inset-0",
            safety
              ? "bg-[linear-gradient(90deg,rgba(31,3,2,0.97)_0%,rgba(45,6,4,0.91)_34%,rgba(30,7,5,0.58)_62%,rgba(10,9,8,0.30)_100%)]"
              : "bg-[linear-gradient(90deg,rgba(7,7,6,0.98)_0%,rgba(7,7,6,0.93)_31%,rgba(7,7,6,0.65)_58%,rgba(7,7,6,0.18)_100%)]"
          )}
        />
        <span className="absolute inset-0 bg-[linear-gradient(0deg,rgba(7,7,6,0.80)_0%,rgba(7,7,6,0.10)_48%,rgba(7,7,6,0.32)_100%)]" />
      </div>

      <span
        aria-hidden="true"
        className={cn(
          "pointer-events-none absolute -left-20 -top-24 z-0 h-56 w-56 rounded-full blur-3xl",
          safety ? "bg-[#4e0401]/24" : "bg-[#e88c2b]/12"
        )}
      />

      <div className={cn("relative z-10 flex h-full flex-col", quiet ? "p-4" : "p-5")}>
        {card.eyebrow ? (
          <div>
            <span
              className={cn(
                "inline-flex min-h-7 items-center rounded-full border bg-[#120d09]/74 px-3 py-1 text-[0.6875rem] font-extrabold uppercase tracking-[0.065em] backdrop-blur-sm",
                safety
                  ? "border-[#e88c2b]/55 text-[#ffad58]"
                  : "border-[#e88c2b]/78 text-[#ff9f32]",
                quiet && "opacity-90"
              )}
            >
              {card.eyebrow}
            </span>
          </div>
        ) : null}

        <div className={cn("mt-4", hasTruthfulMedia || !quiet ? "max-w-[72%]" : "max-w-[80%]")}>
          <h2
            className={cn(
              "font-extrabold leading-[1.06] tracking-[-0.028em] text-white",
              prominent && !quiet ? "text-[1.65rem]" : "text-[1.42rem]"
            )}
          >
            {card.title}
          </h2>

          <p className={cn("mt-2.5 text-[0.875rem] leading-[1.45] text-white/90", quiet && "text-white/80")}>
            {card.subtitle}
          </p>
        </div>

        {card.meta || card.socialProof ? (
          <div className="mt-4 flex max-w-[92%] flex-wrap items-center gap-x-3 gap-y-2 text-[0.78rem] font-semibold text-white/85">
            {card.meta ? (
              <span className="inline-flex min-h-6 items-center gap-1.5">
                <MetadataIcon card={card} />
                <span>{card.meta}</span>
              </span>
            ) : null}
            {card.meta && card.socialProof ? <span className="text-[#e88c2b]">•</span> : null}
            {card.socialProof ? (
              <span className="inline-flex min-h-6 items-center gap-1.5">
                <UsersRound className="h-4 w-4 shrink-0" aria-hidden="true" />
                <span>{card.socialProof}</span>
              </span>
            ) : null}
          </div>
        ) : null}

        {card.progress ? (
          <div className="mt-4 max-w-[72%]">
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-sm font-extrabold tabular-nums text-white">{card.progress.percent}%</span>
              <span className="text-xs text-white/75">{card.progress.label}</span>
            </div>
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/20">
              <div
                className="h-full origin-left rounded-full bg-[#e88c2b] transition-transform duration-[700ms] ease-out motion-reduce:duration-0"
                style={{ transform: `scaleX(${displayedPercent / 100})` }}
              />
            </div>
          </div>
        ) : null}

        <div className="mt-auto flex w-full flex-wrap items-center gap-2 pt-5">
          {card.primaryIntent ? (
            <button
              type="button"
              onClick={runPrimaryIntent}
              disabled={intentPending}
              aria-busy={intentPending}
              className={cn(primaryClassName, intentPending && "opacity-70")}
            >
              {intentPending ? "Opening…" : card.cta}
            </button>
          ) : (
            <Link
              href={card.destination as Route}
              onClick={acknowledgeIfNeeded}
              className={primaryClassName}
            >
              {card.cta}
            </Link>
          )}

          {card.secondaryAction ? (
            <Link href={card.secondaryAction.destination as Route} className={secondaryClassName}>
              {card.secondaryAction.label}
            </Link>
          ) : null}
        </div>

        {intentError ? (
          <p role="status" className="mt-2.5 text-xs font-medium text-white/85">
            {intentError}
          </p>
        ) : null}
      </div>
    </article>
  );
}
