"use client";

import Image from "next/image";
import { Loader2, Radar } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * The Socialize hero.
 *
 * ONE surface at the top of the page, in two states that share an identical
 * skeleton — heading, supporting line, insight row, primary action — so
 * switching Socializing on does not reflow the screen underneath the user's
 * thumb.
 *
 * The OFF state is deliberately ASPIRATIONAL rather than diagnostic. A hero
 * that leads with "Socialize is off" spends the most valuable space on the
 * page restating a setting; this one says what the feature is for and makes
 * turning it on the obvious next tap. The disabled state is communicated by
 * the CTA itself ("Turn On Socialize"), which is the only place it needs to
 * appear — the empty state beneath never repeats it.
 *
 * The activation control IS this CTA. There is no separate floating pill, so
 * there is exactly one entry point into the experience and the two can never
 * drift apart.
 */

export type SocializeHeroProps = {
  active: boolean;
  /** An activation or change request is in flight. */
  busy?: boolean;
  /** Counts from the already-authorised discovery array. No new queries. */
  total: number;
  activeNow: number;
  newToday: number;
  /**
   * The activation trigger, supplied by the page so the existing Popover keeps
   * owning the prerequisite flow. Rendered as this hero's primary action.
   */
  activationTrigger: ReactNode;
  /** Clears filters and search, then scrolls to the feed. */
  onExplore: () => void;
  /** Who can see you — the question the control has to answer. */
  visibilityNote?: ReactNode;
  /** Reach, adjustable while live. Absent when not discoverable. */
  reachControl?: ReactNode;
};

export function SocializeHero({
  active,
  busy = false,
  total,
  activeNow,
  newToday,
  activationTrigger,
  onExplore,
  visibilityNote,
  reachControl
}: SocializeHeroProps) {
  return (
    <section
      aria-labelledby="socialize-hero-heading"
      className={cn(
        "relative isolate flex min-h-[16.5rem] flex-col justify-end overflow-hidden rounded-[1.75rem]",
        "border border-border/60 p-6 sm:min-h-[18rem] sm:p-8"
      )}
    >
      {/* Brand artwork. Decorative and aria-hidden: it carries atmosphere, not
          information, so a screen reader must not announce it.

          `object-cover` with `priority` off — the hero is above the fold but
          the artwork is not the content, so it must never delay the counts or
          the CTA rendering. */}
      <Image
        src="/brand/social background.png"
        alt=""
        aria-hidden="true"
        fill
        priority
        sizes="(max-width: 900px) 100vw, 900px"
        // Brighter and slightly saturated: the artwork was reading flat under
        // the scrim, and lifting it here is cheaper than a second image.
        className="pointer-events-none z-0 scale-105 object-cover opacity-95 saturate-[1.15]"
      />

      {/* Two ambient lights, drifting at different speeds and out of phase.
          Proximity and discovery WITHOUT a radar: no rings, no sweep, no
          concentric bands — just warmth moving slowly behind the glass. */}
      <span
        aria-hidden="true"
        className="socialize-hero-glow socialize-hero-drift pointer-events-none absolute -right-10 -top-12 z-[1] h-52 w-52 rounded-full bg-primary/20 blur-3xl"
      />
      <span
        aria-hidden="true"
        className="socialize-hero-drift-slow pointer-events-none absolute -bottom-16 -left-12 z-[1] h-44 w-44 rounded-full bg-amber-400/15 blur-3xl dark:bg-amber-300/12"
      />

      {/* Readability scrim. The artwork is busy and its brightness varies, so
          text over it needs a floor of contrast that does not depend on which
          part of the image happens to sit behind a given word. Warm-tinted
          rather than neutral grey, so it reads as part of the brand surface
          instead of a grey wash laid on top of it. */}
      <span
        aria-hidden="true"
        className={cn(
          "pointer-events-none absolute inset-0 z-[2]",
          // Keyed to --shadow (the maroon ink), NOT --background.
          //
          // --background is near-white in light mode, so the old scrim barely
          // darkened anything while the text below it stayed dark ink — dark
          // type on bright orange artwork, unreadable in exactly one theme.
          //
          // The artwork is dark and warm in BOTH themes, so the surface it
          // creates is dark in both and the text on it is light in both. The
          // hero is a photographic surface, not a page surface; it does not
          // flip with the theme.
          "bg-gradient-to-t from-[hsl(var(--shadow)/0.88)] via-[hsl(var(--shadow)/0.45)] to-[hsl(var(--shadow)/0.12)]"
        )}
      />
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 z-[2] bg-[radial-gradient(130%_150%_at_0%_0%,hsl(var(--primary)/0.14),transparent_62%)]"
      />

      {/* CONTENT LAYER. Explicitly above the scrim: without a z-index of
          its own it painted underneath, and the readability overlay that
          exists to protect the text was dimming it instead. */}
      <div className="relative z-10">
        <h2
          id="socialize-hero-heading"
          className={cn(
            "flex items-center gap-2.5 text-balance text-[1.5rem] font-bold leading-tight tracking-tight",
            // White in both themes: it sits on the dark scrim above, never on
            // the page surface, so it must not follow --foreground.
            "text-white [text-shadow:0_1px_14px_hsl(var(--shadow)/0.85)]"
          )}
        >
          <Radar className="h-[1.375rem] w-[1.375rem] shrink-0 text-primary" aria-hidden="true" />
          {active && total === 0 ? "You’re the first one here" : active ? "Around you" : "Discover people around you"}
        </h2>

        {/* The line under the heading. Both states fill it, so the block height
            is stable and the layout never jumps on activation. */}
        <p className={cn(
            "mt-2 max-w-[24rem] text-pretty text-sm leading-relaxed",
            "text-white/85 [text-shadow:0_1px_12px_hsl(var(--shadow)/0.8)]"
          )}>
          {/* "0 people nearby right now" reads as a broken feature rather than a
              quiet moment. Being early is not a failure state, so the empty case
              says what to do next instead of reporting a count of nothing. */}
          {!active
            ? "Turn on Linkr to meet people nearby who are open to connecting."
            : total === 0
              ? "Stay visible and we’ll let you know the moment someone nearby appears."
              : `${total} ${total === 1 ? "person" : "people"} nearby right now.`}
        </p>

        {/* Live insights, ON only. Each is hidden when zero — a row of zeroes
            reads as a dead room and says less than nothing. */}
        {active && (activeNow > 0 || newToday > 0) ? (
          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-white/80">
            {activeNow > 0 ? (
              <span className="inline-flex items-center gap-1.5">
                <span className="h-1.5 w-1.5 rounded-full bg-primary" aria-hidden="true" />
                {activeNow} active now
              </span>
            ) : null}
            {newToday > 0 ? <span>{newToday} new today</span> : null}
          </div>
        ) : null}

        <div className="mt-5 flex items-center gap-3">
          {active ? (
            <Button
              type="button"
              onClick={onExplore}
              disabled={busy}
              className={cn(
                "min-h-[3rem] min-w-[11.5rem] rounded-2xl text-[0.9375rem]",
                "shadow-[0_10px_30px_-12px_hsl(var(--primary)/0.65)]",
                "transition-[transform,box-shadow] duration-300 ease-out",
                "hover:-translate-y-0.5 hover:shadow-[0_16px_38px_-14px_hsl(var(--primary)/0.75)]",
                "active:translate-y-0 active:scale-[0.98]",
                "motion-reduce:transform-none motion-reduce:transition-none"
              )}
            >
              {busy ? (
                <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />
              ) : null}
              Discover Nearby
            </Button>
          ) : (
            // The page supplies the real trigger, so activation keeps running
            // through the existing prerequisite popover rather than a second
            // flow that could skip it.
            activationTrigger
          )}
        </div>

        {/* Visibility and reach form ONE block: the note states who can see
            you, the control changes how far that reaches. Separating them left
            the control reading as an unexplained row of chips. */}
        {visibilityNote || reachControl ? (
          <div className="linkr-hero-footer">
            {visibilityNote ? (
              <p className="linkr-hero-note">{visibilityNote}</p>
            ) : null}
            {reachControl}
          </div>
        ) : null}
      </div>
    </section>
  );
}
