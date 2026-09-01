"use client";

import type { Route } from "next";
import Image from "next/image";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { useEffect, useState, useTransition } from "react";
import { acknowledgeSmartCardAction } from "@/app/(app)/smart-card-actions";
import { GlareHover } from "@/components/ui/glare-hover";
import { PrismBackground } from "@/components/ui/prism-background";
import { useReducedMotion } from "@/hooks/use-reduced-motion";
import {
  isStagedJourneyCard,
  journeyStageForPercent,
  type SmartCard,
  type SmartCardIllustration
} from "@/lib/smart-card/smart-card";

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

/**
 * Which cards render the animated prism instead of the sheen.
 *
 * Deliberately ONE id, not a category. `suggestions` is the always-available
 * fallback -- the card most people see most often -- and it carries nothing
 * time-critical, so an animated background competes with no information.
 *
 * Scoping by id rather than by "not prominent" keeps safe_arrival excluded by
 * construction, so the rule that safety outranks decoration holds without
 * needing to be re-stated here.
 *
 * `journey` is NOT listed here and must not be added. It reaches the prism by
 * a different authority -- an EARNED progression stage (see `journeyStage`) --
 * because the two are different ideas: this set is "this card always looks
 * like that", the stage is "this viewer has got this far". Adding journey here
 * would give a 0% card the advanced treatment on day one.
 */
const PRISM_CARD_IDS = new Set<SmartCard["id"]>(["suggestions"]);

export function SmartCardHero({
  card,
  /**
   * Something more urgent already owns the screen.
   *
   * On a brand-new account the activation hero is the one thing that matters,
   * and this card's saturated full-bleed gradient was the most vivid object on
   * Home -- so the eye landed on it first and the actual next step read as
   * secondary. Deferring keeps the card and everything it says, and only
   * lowers its visual volume so the hierarchy matches the priority.
   *
   * SAFETY STATES ARE NEVER DEFERRED. The caller decides, and it does not pass
   * this when a prominent (Safe Arrival / active Journey) card is showing --
   * those outrank activation by design.
   */
  deferred = false
}: {
  card: SmartCard;
  deferred?: boolean;
}) {
  const [animatedPercent, setAnimatedPercent] = useState(0);
  const [pending, startTransition] = useTransition();
  const percent = card.progress?.percent ?? 0;
  const prominent = PROMINENT_CARD_IDS.has(card.id);
  const reducedMotion = useReducedMotion();

  /**
   * Three independent questions, deliberately not collapsed into one boolean:
   *
   *   1. what stage has been EARNED    -> journeyStage
   *   2. what IDENTITY does it render  -> prism (stage-driven, motion-blind)
   *   3. may it MOVE                   -> animated (motion-driven only)
   *
   * Keeping (2) and (3) apart is the fix for a real defect: identity used to
   * be gated on `!reducedMotion`, so a viewer who prefers reduced motion was
   * silently demoted to the ordinary card instead of getting a still version
   * of the card they had earned. Reduced motion may remove movement. It may
   * not remove status.
   */
  const journeyStage = isStagedJourneyCard(card.id) ? journeyStageForPercent(percent) : null;
  const showPrism = PRISM_CARD_IDS.has(card.id) || journeyStage === "advanced";
  const prismAnimated = showPrism && !reducedMotion;

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
      className={`focus-ring safe-motion group relative block overflow-hidden rounded-[1.75rem] ${
        // The prism IS the background on its card, so the gradient would only
        // sit on top of it. A near-black ground stays behind, so the card is
        // still a solid, readable object before WebGL paints -- and remains
        // one if WebGL never paints at all.
        deferred
          ? // Yielding to the activation hero: the app's own card surface with
            // a warm accent edge instead of a full-bleed gradient. Same card,
            // same copy, same destination -- a quieter voice.
            "border border-border/70 bg-card/70"
          : showPrism
            ? "bg-[#12060f]"
            : journeyStage === "progressing"
              ? // PROGRESSING: the same gradient, travelled further along.
                // Not a different palette -- the identical four stops at a
                // steeper angle with the warm end pulled in earlier, so the
                // card reads as the early card advanced rather than as a
                // second design. The prism is still withheld until 70%.
                "bg-[linear-gradient(126deg,#8d0f6b_0%,#b81a5c_26%,#cc2f44_52%,#e2542a_100%)]"
              : "bg-[linear-gradient(118deg,#9d1268_0%,#b81a5c_32%,#cc2f44_60%,#d9482c_100%)]"
      } ${
        deferred
          ? "shadow-none"
          : "shadow-[0_10px_30px_hsl(var(--shadow)/0.18)]"
      } transition-transform duration-200 ease-out active:scale-[0.99] motion-reduce:active:scale-100 ${
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
      {/* Exactly one animated background, never two. The prism replaces the
          sheen on its card rather than layering over it -- two live visual
          systems on one card is twice the cost for a muddier result. */}
      {prismAnimated ? (
        <PrismBackground
          // Tuned as a BACKGROUND, not an overlay: full opacity and no blend
          // mode, because there is no longer a gradient underneath for it to
          // blend with. Still far calmer than the reference defaults -- real
          // copy sits on top of this, so it has to read as a slow moving
          // light rather than as artwork.
          animationType="rotate"
          timeScale={0.12}
          noise={0}
          glow={0.9}
          bloom={0.8}
          colorFrequency={0.35}
          // Hue rotation alone CANNOT brand this shader, so it is no longer
          // asked to. Measured across a full 2*PI sweep the palette only ever
          // travels cyan -> green -> olive -> cyan: `hueRotation` is applied
          // after `tanh4` has already compressed the dynamic range, so every
          // value lands in the same narrow, desaturated band and none of them
          // reaches magenta. The brand colour comes from the tint layer below
          // instead; this value is kept only for the cool base it produces.
          hueShift={-0.5}
          scale={3.2}
          // Pushed right so the bright core sits in the empty half of the
          // card. The copy occupies the left ~58%, and a light sweeping
          // under it is what made the title hard to read.
          offsetX={150}
          suspendWhenOffscreen
          className="z-0"
        />
      ) : null}
      {/* Brand tint over the moving prism.
          The shader cannot be hue-rotated into the Mad Buddy palette (see
          above), and an advanced Journey card that reads cyan is a different
          design system from the early and progressing cards it is supposed to
          be the endpoint of. A multiply pass pulls the whole animation into
          the card's magenta while leaving its movement and structure intact:
          the light still sweeps, it simply sweeps in the brand's colour.
          Scoped to the Journey stage so the `suggestions` card, whose look was
          signed off as it is, is untouched. */}
      {prismAnimated && journeyStage === "advanced" ? (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 z-0 mix-blend-color bg-[linear-gradient(118deg,#d4177a_0%,#d62268_38%,#e03a4e_68%,#ec5330_100%)]"
        />
      ) : null}
      {/* Still prism identity for reduced motion.
          The card has EARNED the prism look, so reduced motion freezes it
          rather than removing it: a fixed multi-stop wash in the same hues
          the canvas moves through, painted on the same near-black ground at
          the same z-0. A viewer who prefers reduced motion sees the advanced
          card they earned, simply holding still. */}
      {showPrism && !prismAnimated ? (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 z-0 bg-[radial-gradient(120%_95%_at_82%_18%,rgba(233,64,142,0.62)_0%,rgba(196,36,120,0.42)_34%,rgba(120,20,88,0.24)_62%,rgba(18,6,15,0)_100%)]"
        />
      ) : null}
      {/* Readability scrim over the prism ground — animated OR still.
          The gradient it replaced had a known, fixed luminance behind the
          copy; a prism does not, so its bright passes would otherwise wash
          out the title as they swept under it. Weighted to the left, where
          the text column sits, and fading out to the right so the artwork
          keeps the full colour. Applied to the still variant too, so the
          reduced-motion card clears the same contrast floor. */}
      {showPrism ? (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 z-0 bg-[linear-gradient(100deg,rgba(10,4,9,0.72)_0%,rgba(10,4,9,0.40)_50%,rgba(10,4,9,0.05)_82%,rgba(10,4,9,0)_100%)]"
        />
      ) : null}
      {showPrism && deferred ? (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 z-0 bg-[linear-gradient(100deg,rgba(254,251,243,0.96)_0%,rgba(254,251,243,0.90)_54%,rgba(254,251,243,0.48)_80%,rgba(254,251,243,0.12)_100%)] dark:bg-transparent"
        />
      ) : null}
      {prominent || showPrism ? null : (
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
        // z-[1] so the artwork stays above the prism canvas, which renders at
        // z-0 as the card's ground.
        //
        // Hidden entirely on the prism card: the animation IS the visual
        // interest there, and a cut-out illustration on top of it makes two
        // focal points competing in the same corner.
        // The Journey target is pulled back in from the shared -right-12
        // bleed. Measured at 168px with that offset, only 68.5% of the
        // artwork stayed inside the card and the crop fell exactly across the
        // arrow -- removing the one element that carries "aim at a
        // destination", which is the whole point of the early state. A
        // smaller, less-bled target keeps the arrow and the rings intact.
        // Other illustrations keep the original framing: they are abstract
        // enough that a bleed costs them nothing.
        className={`pointer-events-none absolute top-[66%] z-[1] -translate-y-1/2 opacity-90 ${
          journeyStage ? "-right-5" : "-right-12"
        } ${showPrism ? "hidden" : ""} ${
          journeyStage
            ? "h-[8.25rem] w-[8.25rem]"
            : prominent
              ? "h-[10.5rem] w-[10.5rem]"
              : "h-[9rem] w-[9rem]"
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
          className={`font-bold leading-[1.15] ${deferred ? "text-foreground" : "text-white"} ${
            prominent ? "text-[1.375rem]" : "text-[1.25rem]"
          }`}
        >
          {card.title}
        </p>
        {/* Solid white, not white/90 — at this size the alpha variant measured
            4.23:1 against the gradient, just under the 4.5:1 AA floor. */}
        <p
          className={`text-[0.8125rem] font-normal leading-[1.45] ${deferred ? "text-muted-foreground" : "text-white"} ${
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
              <p className={`text-[0.9375rem] font-semibold tabular-nums ${deferred ? "text-foreground" : "text-white"}`}>
                {card.progress.percent}% Complete
              </p>
              {/* Supporting text, so it recedes. Still clears AA at this size
                  against the gradient's dark left end. */}
              <p className={`text-xs font-normal ${deferred ? "text-muted-foreground" : "text-white/85"} ${prominent ? "w-full mt-0.5" : ""}`}>
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
          className={`inline-flex items-center gap-2 text-[0.9375rem] font-bold ${deferred ? "text-primary" : "text-white"} ${
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
