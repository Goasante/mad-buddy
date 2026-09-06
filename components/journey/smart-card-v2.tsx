"use client";

import type { Route } from "next";
import Image from "next/image";
import Link from "next/link";
import {
  ArrowRight,
  CalendarDays,
  MapPin,
  ShieldCheck,
  UsersRound
} from "lucide-react";
import { useEffect, useState, useTransition } from "react";

import { acknowledgeSmartCardAction } from "@/app/(app)/smart-card-actions";
import { useReducedMotion } from "@/hooks/use-reduced-motion";
import type { SmartCard, SmartCardIllustration } from "@/lib/smart-card/smart-card";
import { smartCardVisualTreatment } from "@/lib/smart-card/visuals";
import { cn } from "@/lib/utils";

/**
 * Smart Card V2 — editorial / cinematic presentation.
 *
 * The engine still decides WHAT matters. This component only decides HOW that
 * truth is presented. The visual target is a compact social moment rather than
 * a dashboard tile: dark photographic/illustrated canvas, warm orange context
 * chip, strong white hierarchy and one obvious next action.
 *
 * IMPORTANT PERSON-ART RULE. A display name is never a gender authority. When
 * a card carries authorised person media (for example a Linkr mutual), that
 * truthful media wins. Otherwise the renderer uses neutral branded artwork —
 * it never guesses "male" or "female" from a name and risks showing the wrong
 * person. A future explicit, viewer-authorised presentation hint can safely
 * select gendered illustration variants without changing this component.
 *
 * Home still has TWO adaptive card families plus NearbyHero. `deferred` remains
 * a product rule: beside Card A this card keeps the same visual language but
 * becomes shorter/quieter so Home never presents two competing billboards.
 */

const FALLBACK_ILLUSTRATION = "/brand/journey-target.webp";
const ILLUSTRATIONS: Record<SmartCardIllustration, string> = {
  target: FALLBACK_ILLUSTRATION,
  celebration: "/brand/journey-hero.webp",
  birthday: FALLBACK_ILLUSTRATION,
  calendar: FALLBACK_ILLUSTRATION,
  people: FALLBACK_ILLUSTRATION,
  trophy: FALLBACK_ILLUSTRATION
};

const SAFE_ARRIVAL_ART = "/visuals/safe-arrival/active.jpg";

const PROMINENT_CARD_IDS = new Set<SmartCard["id"]>([
  "safe_arrival",
  "plan_rsvp",
  "plan_starting",
  "event_live",
  "nearby_muddies"
]);

const LOCATION_META_IDS = new Set<SmartCard["id"]>([
  "event_live",
  "event_starting",
  "event_commitment_starting",
  "nearby_muddies"
]);

function mediaPosition(card: SmartCard): string {
  const x = card.media?.focalX;
  const y = card.media?.focalY;
  if (typeof x !== "number" && typeof y !== "number") return "50% 50%";
  const px = typeof x === "number" ? Math.round(Math.min(1, Math.max(0, x)) * 100) : 50;
  const py = typeof y === "number" ? Math.round(Math.min(1, Math.max(0, y)) * 100) : 50;
  return `${px}% ${py}%`;
}

function MetadataIcon({ card }: { card: SmartCard }) {
  if (card.id === "safe_arrival") return <ShieldCheck className="h-4 w-4" aria-hidden="true" />;
  if (LOCATION_META_IDS.has(card.id)) return <MapPin className="h-4 w-4" aria-hidden="true" />;
  return <CalendarDays className="h-4 w-4" aria-hidden="true" />;
}

export function SmartCardHeroV2({ card, deferred = false }: { card: SmartCard; deferred?: boolean }) {
  const [pending, startTransition] = useTransition();
  const [animatedPercent, setAnimatedPercent] = useState(0);
  const reducedMotion = useReducedMotion();
  const percent = card.progress?.percent ?? 0;
  const prominent = PROMINENT_CARD_IDS.has(card.id);
  const treatment = smartCardVisualTreatment(card, deferred);
  const quiet = treatment === "quiet";
  const safety = treatment === "safety";
  const hasTruthfulMedia = Boolean(card.media?.url);

  /* Safety may use only the already-approved abstract in-transit artwork. It
     never borrows a person, map, route or generic Event image. */
  const backdrop = hasTruthfulMedia ? card.media!.url : safety ? SAFE_ARRIVAL_ART : null;

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

  const displayedPercent = reducedMotion ? percent : animatedPercent;

  return (
    <article
      aria-busy={pending || undefined}
      data-smart-card-visual={treatment}
      data-smart-card-editorial="true"
      className={cn(
        "safe-motion relative isolate overflow-hidden rounded-[1.45rem] border bg-[#0b0a09] text-white",
        quiet
          ? "min-h-[11.25rem] border-white/[0.08] shadow-[0_8px_22px_rgba(20,8,3,0.10)]"
          : "border-white/[0.10] shadow-[0_18px_42px_rgba(35,12,4,0.24)]",
        prominent && !quiet ? "min-h-[15.75rem]" : !quiet ? "min-h-[14.25rem]" : null
      )}
    >
      {/* Truthful media becomes the stage, not a thumbnail. It deliberately
          occupies the right side so copy can sit in a stable dark reading zone. */}
      {backdrop ? (
        <div className="pointer-events-none absolute inset-0 z-0" aria-hidden="true">
          <Image
            src={backdrop}
            alt=""
            fill
            priority={prominent}
            sizes="(max-width: 768px) 100vw, 420px"
            className={cn("object-cover", quiet ? "opacity-55" : safety ? "opacity-58" : "opacity-95")}
            style={{ objectPosition: hasTruthfulMedia ? mediaPosition(card) : "62% 50%" }}
          />
          <span className="absolute inset-0 bg-[linear-gradient(90deg,rgba(7,7,6,0.98)_0%,rgba(7,7,6,0.94)_30%,rgba(7,7,6,0.66)_56%,rgba(7,7,6,0.24)_100%)]" />
          <span className="absolute inset-0 bg-[linear-gradient(0deg,rgba(7,7,6,0.78)_0%,rgba(7,7,6,0.08)_48%,rgba(7,7,6,0.30)_100%)]" />
        </div>
      ) : (
        <div className="pointer-events-none absolute inset-0 z-0" aria-hidden="true">
          <span className="absolute inset-0 bg-[radial-gradient(circle_at_80%_24%,rgba(232,140,43,0.24),transparent_30%),radial-gradient(circle_at_98%_88%,rgba(78,4,1,0.72),transparent_42%),linear-gradient(135deg,#090807_0%,#100c09_55%,#1b0d08_100%)]" />
          <div className={cn("absolute -bottom-8 -right-6 h-[14rem] w-[14rem]", quiet ? "opacity-20" : "opacity-38")}>
            <Image
              src={ILLUSTRATIONS[card.illustration]}
              alt=""
              fill
              sizes="224px"
              className="object-contain object-bottom"
            />
          </div>
          <span className="absolute inset-0 bg-[linear-gradient(90deg,rgba(7,7,6,0.98)_0%,rgba(7,7,6,0.91)_48%,rgba(7,7,6,0.42)_100%)]" />
        </div>
      )}

      {/* A tiny warm halo is enough to keep the brand present. The old card
          used the orange/maroon gradient as the entire object; this rebuild
          makes orange an accent and lets people/content carry the moment. */}
      {!safety ? (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute -left-20 -top-24 z-0 h-56 w-56 rounded-full bg-[#e88c2b]/10 blur-3xl"
        />
      ) : null}

      <div className={cn("relative z-10 flex h-full flex-col", quiet ? "p-4" : "p-5")}>
        {card.eyebrow ? (
          <div>
            <span
              className={cn(
                "inline-flex min-h-7 items-center rounded-full border border-[#e88c2b]/75 bg-[#130d09]/70 px-3 py-1 text-[0.6875rem] font-extrabold uppercase tracking-[0.065em] text-[#ff9f32] backdrop-blur-sm",
                quiet && "border-[#e88c2b]/45 text-[#e99a45]"
              )}
            >
              {card.eyebrow}
            </span>
          </div>
        ) : null}

        <div className={cn("mt-4", backdrop ? "max-w-[68%]" : "max-w-[76%]", quiet && "max-w-[78%]")}>
          <h2
            className={cn(
              "font-extrabold leading-[1.06] tracking-[-0.035em] text-white text-balance",
              prominent && !quiet ? "text-[1.62rem]" : quiet ? "text-[1.28rem]" : "text-[1.48rem]"
            )}
          >
            {card.title}
          </h2>
          <p className={cn("mt-2.5 leading-[1.45] text-white/84", quiet ? "text-[0.82rem]" : "text-[0.89rem]")}>
            {card.subtitle}
          </p>
        </div>

        {card.meta || card.socialProof ? (
          <div className={cn("mt-4 flex max-w-[92%] flex-wrap items-center gap-x-3 gap-y-2", quiet && "mt-3")}>
            {card.meta ? (
              <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-white/88">
                <MetadataIcon card={card} />
                <span>{card.meta}</span>
              </span>
            ) : null}
            {card.meta && card.socialProof ? <span className="h-1 w-1 rounded-full bg-[#e88c2b]" aria-hidden="true" /> : null}
            {card.socialProof ? (
              <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-white/82">
                <UsersRound className="h-4 w-4" aria-hidden="true" />
                <span>{card.socialProof}</span>
              </span>
            ) : null}
          </div>
        ) : null}

        {card.progress ? (
          <div className="mt-4 max-w-[76%]">
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-sm font-extrabold tabular-nums text-white">{card.progress.percent}%</span>
              <span className="text-xs text-white/68">{card.progress.label}</span>
            </div>
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/16">
              <div
                className="h-full origin-left rounded-full bg-[#ff7a16] transition-transform duration-[700ms] ease-out motion-reduce:duration-0"
                style={{ transform: `scaleX(${displayedPercent / 100})` }}
              />
            </div>
          </div>
        ) : null}

        <div className={cn("mt-auto grid gap-2 pt-5", card.secondaryAction ? "grid-cols-2" : "grid-cols-1")}>
          <Link
            href={card.destination as Route}
            onClick={acknowledgeIfNeeded}
            className="focus-ring inline-flex min-h-11 items-center justify-center gap-2 rounded-full bg-[#ff7417] px-4 py-2.5 text-center text-sm font-extrabold text-white shadow-[0_8px_20px_rgba(255,116,23,0.22)] transition-transform active:scale-[0.985] motion-reduce:active:scale-100"
          >
            <span className="truncate">{card.cta}</span>
            <ArrowRight className="h-4 w-4 shrink-0" aria-hidden="true" />
          </Link>

          {card.secondaryAction ? (
            <Link
              href={card.secondaryAction.destination as Route}
              className="focus-ring inline-flex min-h-11 items-center justify-center rounded-full border border-white/55 bg-black/28 px-4 py-2.5 text-center text-sm font-bold text-white backdrop-blur-sm transition-colors hover:bg-white/10"
            >
              <span className="truncate">{card.secondaryAction.label}</span>
            </Link>
          ) : null}
        </div>
      </div>
    </article>
  );
}
