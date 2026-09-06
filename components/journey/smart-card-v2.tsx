"use client";

import type { Route } from "next";
import Image from "next/image";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { useEffect, useState, useTransition } from "react";

import { acknowledgeSmartCardAction } from "@/app/(app)/smart-card-actions";
import { useReducedMotion } from "@/hooks/use-reduced-motion";
import type { SmartCard, SmartCardIllustration } from "@/lib/smart-card/smart-card";
import { smartCardVisualTreatment } from "@/lib/smart-card/visuals";
import { cn } from "@/lib/utils";

/**
 * Smart Card V2 presentation.
 *
 * Home has TWO adaptive card families: the separate Activation / Relationship
 * card and this cross-product Smart Card. `deferred` is therefore a product
 * rule, not a dimming trick: when the Activation card owns the screen this card
 * becomes visually quiet so Home never shows two competing billboards.
 *
 * V2 is also not one giant link. It can present a real primary and secondary
 * action without nesting interactive elements.
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

const PROMINENT_CARD_IDS = new Set<SmartCard["id"]>([
  "safe_arrival",
  "plan_rsvp",
  "plan_starting",
  "event_live",
  "nearby_muddies"
]);

function cardTone(card: SmartCard) {
  if (card.id === "safe_arrival") {
    return "from-[#4e0401] via-[#64110c] to-[#852116]";
  }
  if (card.id === "plan_rsvp") {
    return "from-[#6a0b08] via-[#8f1c12] to-[#d56822]";
  }
  if (card.id === "event_live") {
    return "from-[#35110b] via-[#6f2412] to-[#d56c20]";
  }
  if (card.id === "nearby_muddies") {
    return "from-[#4e0401] via-[#7b1b12] to-[#e88c2b]";
  }
  if (card.id === "upfor_fallback") {
    return "from-[#4e0401] via-[#8c2d16] to-[#e88c2b]";
  }
  return "from-[#67100b] via-[#9a2e18] to-[#e88c2b]";
}

function mediaPosition(card: SmartCard): string {
  const x = card.media?.focalX;
  const y = card.media?.focalY;
  if (typeof x !== "number" && typeof y !== "number") return "50% 50%";
  const px = typeof x === "number" ? Math.round(Math.min(1, Math.max(0, x)) * 100) : 50;
  const py = typeof y === "number" ? Math.round(Math.min(1, Math.max(0, y)) * 100) : 50;
  return `${px}% ${py}%`;
}

export function SmartCardHeroV2({ card, deferred = false }: { card: SmartCard; deferred?: boolean }) {
  const [pending, startTransition] = useTransition();
  const [animatedPercent, setAnimatedPercent] = useState(0);
  const reducedMotion = useReducedMotion();
  const percent = card.progress?.percent ?? 0;
  const prominent = PROMINENT_CARD_IDS.has(card.id);
  const treatment = smartCardVisualTreatment(card, deferred);
  const showHeroMedia = treatment === "media";
  const showQuietMedia = treatment === "quiet" && Boolean(card.media?.url);
  const showFallbackArt = treatment === "branded";
  const quiet = treatment === "quiet";
  const safety = treatment === "safety";

  /**
   * The bar fills from 0 on mount through a real state transition; a plain CSS
   * transition would race its own initial value and never animate.
   *
   * Reduced motion is handled by DERIVING the rendered width rather than
   * setting state for it. Calling setState synchronously inside the effect --
   * which the reduced-motion branch used to do -- triggers a cascading render
   * on every mount for exactly the viewers who asked for less movement, and
   * ESLint flags it. Reduced motion may remove movement; it must not cost a
   * render pass, and it must never remove the progress itself.
   */
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
      className={cn(
        "safe-motion relative isolate overflow-hidden rounded-[1.75rem] border",
        quiet
          ? "border-border/70 bg-card/82 text-foreground shadow-sm"
          : "border-white/10 bg-gradient-to-br text-white shadow-[0_14px_34px_hsl(var(--shadow)/0.20)]",
        !quiet && cardTone(card),
        prominent && !quiet ? "min-h-[15rem]" : "min-h-[12rem]"
      )}
    >
      {showHeroMedia ? (
        <div className="pointer-events-none absolute inset-y-0 right-0 z-0 w-[60%]" aria-hidden="true">
          <Image
            src={card.media!.url}
            alt=""
            fill
            sizes="(max-width: 768px) 62vw, 360px"
            className="object-cover"
            style={{ objectPosition: mediaPosition(card) }}
          />
          <span className="absolute inset-0 bg-[linear-gradient(90deg,rgba(30,5,3,0.98)_0%,rgba(30,5,3,0.70)_38%,rgba(30,5,3,0.20)_100%)]" />
        </div>
      ) : null}

      {showQuietMedia ? (
        <div
          className="pointer-events-none absolute right-4 top-4 z-0 h-[4.75rem] w-[4.75rem] overflow-hidden rounded-[1.15rem] border border-border/50 opacity-80"
          aria-hidden="true"
        >
          <Image
            src={card.media!.url}
            alt=""
            fill
            sizes="76px"
            className="object-cover"
            style={{ objectPosition: mediaPosition(card) }}
          />
          <span className="absolute inset-0 bg-gradient-to-t from-background/20 to-transparent" />
        </div>
      ) : null}

      {showFallbackArt ? (
        <div
          className="pointer-events-none absolute -bottom-6 -right-7 z-0 h-[11rem] w-[11rem] opacity-[0.34] sm:h-[12rem] sm:w-[12rem]"
          aria-hidden="true"
        >
          <span className="absolute inset-[16%] rounded-full bg-[#ffc247]/25 blur-2xl" />
          <Image
            src={ILLUSTRATIONS[card.illustration]}
            alt=""
            fill
            sizes="192px"
            className="object-contain"
          />
        </div>
      ) : null}

      {/* Safety stays calm: branded tone and a restrained glow, never a photo,
          prism or decorative animation. */}
      {safety ? (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute -right-16 -top-20 z-0 h-56 w-56 rounded-full bg-[#e88c2b]/10 blur-3xl"
        />
      ) : null}

      {!quiet && !safety ? (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 z-0 bg-[radial-gradient(circle_at_12%_0%,rgba(255,194,71,0.18),transparent_38%)]"
        />
      ) : null}

      <div className={cn("relative z-10 flex h-full flex-col", prominent && !quiet ? "p-5" : "p-4.5 sm:p-5")}>
        {card.eyebrow ? (
          <div>
            <span
              className={cn(
                "inline-flex min-h-7 items-center rounded-full px-3 py-1 text-[0.6875rem] font-bold tracking-[0.09em]",
                quiet
                  ? "bg-primary/10 text-primary"
                  : "border border-white/15 bg-black/20 text-[#ffe0a3] backdrop-blur-sm"
              )}
            >
              {card.eyebrow}
            </span>
          </div>
        ) : null}

        <div
          className={cn(
            "mt-3",
            showHeroMedia ? "max-w-[63%]" : showQuietMedia ? "max-w-[72%]" : "max-w-[70%]"
          )}
        >
          <h2
            className={cn(
              "font-bold leading-[1.08] tracking-[-0.02em]",
              prominent && !quiet ? "text-[1.65rem]" : "text-[1.4rem]",
              quiet ? "text-foreground" : "text-white"
            )}
          >
            {card.title}
          </h2>
          <p
            className={cn(
              "mt-2 text-[0.875rem] leading-[1.45]",
              quiet ? "text-muted-foreground" : "text-white/90"
            )}
          >
            {card.subtitle}
          </p>

          {card.meta || card.socialProof ? (
            <div className="mt-3 space-y-1">
              {card.meta ? (
                <p className={cn("text-xs font-semibold", quiet ? "text-foreground/80" : "text-white/85")}>
                  {card.meta}
                </p>
              ) : null}
              {card.socialProof ? (
                <p className={cn("text-xs", quiet ? "text-muted-foreground" : "text-white/75")}>
                  {card.socialProof}
                </p>
              ) : null}
            </div>
          ) : null}
        </div>

        {card.progress ? (
          <div className="mt-4 max-w-[72%]">
            <div className="flex items-baseline justify-between gap-3">
              <span className={cn("text-sm font-bold tabular-nums", quiet ? "text-foreground" : "text-white")}>
                {card.progress.percent}%
              </span>
              <span className={cn("text-xs", quiet ? "text-muted-foreground" : "text-white/75")}>
                {card.progress.label}
              </span>
            </div>
            <div className={cn("mt-2 h-1.5 overflow-hidden rounded-full", quiet ? "bg-muted" : "bg-white/20")}>
              <div
                className="h-full origin-left rounded-full bg-[#ffc247] transition-transform duration-[700ms] ease-out motion-reduce:duration-0"
                style={{ transform: `scaleX(${displayedPercent / 100})` }}
              />
            </div>
          </div>
        ) : null}

        <div className="mt-auto flex flex-wrap items-center gap-2 pt-5">
          <Link
            href={card.destination as Route}
            onClick={acknowledgeIfNeeded}
            className={cn(
              "focus-ring inline-flex min-h-11 items-center justify-center gap-2 rounded-full px-4 py-2.5 text-sm font-bold transition-transform active:scale-[0.98] motion-reduce:active:scale-100",
              quiet
                ? "bg-primary text-primary-foreground"
                : "bg-[#f7a01f] text-[#4e0401] shadow-[0_8px_20px_rgba(232,140,43,0.26)]"
            )}
          >
            {card.cta}
            <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </Link>

          {card.secondaryAction ? (
            <Link
              href={card.secondaryAction.destination as Route}
              className={cn(
                "focus-ring inline-flex min-h-11 items-center justify-center rounded-full border px-4 py-2.5 text-sm font-semibold",
                quiet
                  ? "border-border bg-background/70 text-foreground"
                  : "border-white/35 bg-black/10 text-white backdrop-blur-sm"
              )}
            >
              {card.secondaryAction.label}
            </Link>
          ) : null}
        </div>
      </div>
    </article>
  );
}
