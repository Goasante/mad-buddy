"use client";

import type { Route } from "next";
import Image from "next/image";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { useEffect, useState, useTransition } from "react";
import { acknowledgeSmartCardAction } from "@/app/(app)/smart-card-actions";
import { GlareHover } from "@/components/ui/glare-hover";
import type { SmartCard, SmartCardIllustration } from "@/lib/smart-card/smart-card";

/**
 * Home's canonical Smart Card.
 *
 * There is exactly one of these on Home, always. It never becomes a carousel
 * and never disappears — only its content changes, driven entirely by the
 * server-selected card. Nothing here is hardcoded per state: title, subtitle,
 * CTA, destination, artwork and the optional progress meter all arrive as
 * data, so a new card type plugs in as a provider without touching this file.
 *
 * The frame itself — radius, gradient, padding, type scale, shadow, artwork
 * geometry — is fixed. That consistency is the point: the card should read as
 * the same object across every state, not as ten different cards.
 */

/**
 * The component owns the artwork, so a provider can only pick from this set —
 * it cannot point Home at an arbitrary path or a missing file.
 *
 * Only the Journey target cut-out has been produced so far, so every slot
 * currently resolves to it. The indirection is deliberate: dropping in a real
 * `celebration` or `birthday` cut-out is a one-line change here, and no
 * provider, test, or server code has to move. Until then the card still reads
 * correctly — the artwork is a background accent, and title/subtitle/CTA are
 * what actually distinguish the states.
 */
const FALLBACK_ILLUSTRATION = "/brand/journey-target.webp";

const ILLUSTRATIONS: Record<SmartCardIllustration, string> = {
  target: FALLBACK_ILLUSTRATION,
  celebration: FALLBACK_ILLUSTRATION,
  birthday: FALLBACK_ILLUSTRATION,
  calendar: FALLBACK_ILLUSTRATION,
  people: FALLBACK_ILLUSTRATION,
  premium: FALLBACK_ILLUSTRATION,
  trophy: FALLBACK_ILLUSTRATION
};

/**
 * Cards whose state is important enough to earn the taller treatment.
 *
 * THIS IS THE OPPOSITE OF A HEIGHT CAP. The hero was compacted to make room
 * for ranked Events on Home, but compacting every state equally would have
 * squeezed the two that exist precisely to be noticed: a live Safe Arrival
 * journey, and the Journey itself. Those keep the roomier padding and the
 * larger title; the routine states (membership, buddy progress, suggestions,
 * birthday, weekend) take the compact one.
 *
 * Note what does NOT change between the two: the radius, the gradient, the
 * artwork geometry, the CTA. The card reads as the same object either way --
 * only its breathing room and title scale respond to how much the state
 * matters. A new card id defaults to compact, which is the safe direction.
 */
const PROMINENT_CARD_IDS = new Set<SmartCard["id"]>(["safe_arrival", "journey"]);

export function SmartCardHero({ card }: { card: SmartCard }) {
  const [animatedPercent, setAnimatedPercent] = useState(0);
  const [pending, startTransition] = useTransition();
  const percent = card.progress?.percent ?? 0;
  const prominent = PROMINENT_CARD_IDS.has(card.id);

  // The bar fills from 0 on mount via a real state transition — a plain CSS
  // transition would race its own initial value and never animate.
  useEffect(() => {
    const frame = requestAnimationFrame(() => setAnimatedPercent(percent));
    return () => cancelAnimationFrame(frame);
  }, [percent]);

  // A dismissible card is retired by the same tap that follows its CTA:
  // acting on it IS the acknowledgement, so there is no separate dismiss
  // affordance to clutter the card.
  const handleClick = () => {
    if (!card.dismissible) return;
    startTransition(() => {
      void acknowledgeSmartCardAction(card.id);
    });
  };

  const ariaLabel = card.progress
    ? `${card.title}. ${card.subtitle} ${card.progress.percent}% complete, ${card.progress.label.toLowerCase()}.`
    : `${card.title}. ${card.subtitle}`;

  return (
    <Link
      href={card.destination as Route}
      onClick={handleClick}
      aria-label={ariaLabel}
      aria-busy={pending || undefined}
      className={`focus-ring safe-motion group relative block overflow-hidden rounded-[1.75rem] bg-[linear-gradient(118deg,#9d1268_0%,#b81a5c_32%,#cc2f44_60%,#d9482c_100%)] shadow-[0_10px_30px_hsl(var(--shadow)/0.18)] transition-transform duration-200 ease-out active:scale-[0.99] motion-reduce:active:scale-100 ${
        prominent ? "px-5 pb-5 pt-5" : "px-5 pb-4 pt-4"
      }`}
    >
      {/* Decorative sheen on ROUTINE states only.
          A Safe Arrival or active Journey card is the one thing on Home the
          viewer may need to read quickly, and a sweep of light crossing that
          copy is a decoration competing with safety information. Safety state
          outranks visual effect, so the prominent states render no glare at
          all -- and because the effect is purely decorative, removing it
          changes nothing about what the card says or does. */}
      {prominent ? null : (
        <GlareHover
          width="100%"
          height="100%"
          background="transparent"
          borderRadius="inherit"
          borderColor="transparent"
          glareOpacity={0.18}
          glareAngle={-30}
          glareSize={300}
          transitionDuration={800}
          triggerOnParent
          autoOnTouch
          autoDelay={1800}
          autoInterval={8500}
          className="pointer-events-none absolute inset-0 z-[2]"
        />
      )}
      {/* Cut-out illustration (feathered alpha edges) sitting ON the gradient.
          Pushed right and below centre so it reads as a background accent
          rather than competing with the text column. */}
      <div
        className={`pointer-events-none absolute -right-12 top-[66%] -translate-y-1/2 opacity-90 ${
          prominent ? "h-[10.5rem] w-[10.5rem]" : "h-[9rem] w-[9rem]"
        }`}
        aria-hidden="true"
      >
        <span className="journey-target-glow absolute inset-[12%] rounded-full bg-white/25 blur-2xl" />
        <Image
          src={ILLUSTRATIONS[card.illustration]}
          alt=""
          fill
          priority
          sizes="168px"
          className="journey-hero-artwork relative object-contain"
        />
      </div>

      {/* Text column stays well clear of the illustration so a two-line title
          can never collide with it. */}
      <div className="relative z-[1] max-w-[58%]">
        {/* Stronger hierarchy at the compact size rather than a smaller copy
            of the same thing: the title stays bold and dominant, and the gap
            below it closes. */}
        <p
          className={`font-bold leading-[1.15] text-white ${
            prominent ? "text-[1.375rem]" : "text-[1.25rem]"
          }`}
        >
          {card.title}
        </p>
        {/* Solid white, not white/90 — at this size the alpha variant measured
            4.23:1 against the gradient, just under the 4.5:1 AA floor. */}
        <p
          className={`text-[0.8125rem] font-normal leading-[1.45] text-white ${
            prominent ? "mt-2" : "mt-1.5"
          }`}
        >
          {card.subtitle}
        </p>
      </div>

      {/* Progress + CTA run the full card width, below the illustration, so
          they get the whole measure rather than being squeezed beside it. */}
      <div className={`relative z-[1] ${prominent ? "mt-5" : "mt-3.5"}`}>
        {card.progress ? (
          <>
            {/* Percentage and label on ONE line at the compact size. They are
                a single fact -- "62% Complete, 3 steps left" -- and stacking
                them cost a whole line of height to say it twice as slowly.
                The progress meter itself is never dropped. */}
            <div className="flex flex-wrap items-baseline gap-x-2">
              <p className="text-[0.9375rem] font-semibold tabular-nums text-white">
                {card.progress.percent}% Complete
              </p>
              {/* Supporting text, so it recedes. Still clears AA at this size
                  against the gradient's dark left end. */}
              <p className={`text-xs font-normal text-white/85 ${prominent ? "w-full mt-0.5" : ""}`}>
                {card.progress.label}
              </p>
            </div>
            {/* 70% of the card, keeping the bar clear of the illustration. */}
            <div
              className={`h-[0.375rem] w-[70%] overflow-hidden rounded-full bg-white/20 ${
                prominent ? "mt-2.5" : "mt-2"
              }`}
            >
              <div
                className="h-full origin-left rounded-full bg-[#ffc247] shadow-[0_0_10px_rgba(255,194,71,0.5)] transition-transform duration-[900ms] ease-out motion-reduce:duration-0"
                style={{ transform: `scaleX(${animatedPercent / 100})` }}
              />
            </div>
          </>
        ) : null}

        {/* White, not amber: amber on this gradient measured ~2.2:1, well below
            the 4.5:1 AA floor. Amber survives as the progress fill, where it is
            decorative and carries no text. */}
        <span
          className={`inline-flex items-center gap-2 text-[0.9375rem] font-bold text-white ${
            card.progress ? (prominent ? "mt-4" : "mt-3") : "mt-1"
          }`}
        >
          {card.cta}
          <ArrowRight className="journey-cta-arrow h-[1.05rem] w-[1.05rem]" aria-hidden="true" />
        </span>
      </div>
    </Link>
  );
}
