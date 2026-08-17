"use client";

import Link from "next/link";
import type { Route } from "next";
import { Lock, ShieldCheck, UserRound } from "lucide-react";
import { GlowAvatar } from "@/components/glow/glow-avatar";
import { Button } from "@/components/ui/button";
import { useReducedMotion } from "@/hooks/use-reduced-motion";
import { cn } from "@/lib/utils";

/**
 * The first Muddy, and the Glow it makes possible.
 *
 * THE MOMENT, THEN THE MECHANISM. Before this, Home went straight from "you
 * have a Muddy" to "turn on location" -- functionally right, emotionally flat,
 * and it made an operating-system permission the headline of the best thing
 * that had happened in the product so far. The relationship is acknowledged
 * first, and the capability is offered second.
 *
 * GLOW IS THE HERO, NOT A PIN. The dominant visual is the person, wrapped in
 * the app's real Glow treatment -- the same GlowAvatar every proximity surface
 * uses, so the first time somebody actually glows nearby the language is
 * already familiar. A map pin would teach the wrong metaphor on the exact
 * screen where the metaphor is being introduced.
 */

export function FirstMuddyCard({
  muddy,
  /** True when the OS permission has not produced a usable fix yet. */
  needsLocation,
  className
}: {
  muddy: { displayName: string; avatarUrl: string | null };
  needsLocation: boolean;
  className?: string;
}) {
  const reducedMotion = useReducedMotion();

  return (
    <section
      aria-labelledby="first-muddy-headline"
      className={cn(
        "relative overflow-hidden rounded-[1.25rem] border border-border/70 bg-card/60 px-5 py-5 sm:px-6",
        className
      )}
    >
      <div className="flex items-start gap-4">
        {/* The real avatar, in the real Glow ring. GlowAvatar owns the fallback
            when somebody has no photo, so nothing is fabricated here. */}
        <GlowAvatar
          name={muddy.displayName}
          src={muddy.avatarUrl}
          proximityLevel="near"
          glowStrength={0.55}
          confidence="low"
          size="lg"
          reducedMotion={reducedMotion}
          className="shrink-0"
        />

        <div className="min-w-0 flex-1">
          <h2 id="first-muddy-headline" className="text-balance text-xl font-semibold tracking-tight">
            Your first Muddy is here
          </h2>
          {/* Warm, and specific to a person. No confetti, no points, no
              "achievement unlocked" -- the news is that somebody real said
              yes, and that is worth more than a badge. */}
          <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
            {muddy.displayName} is now one of your Muddies.
          </p>
        </div>
      </div>

      {needsLocation ? (
        <>
          <hr className="my-4 border-border/60" />

          <h3 className="text-base font-semibold tracking-tight">Turn on Glow</h3>
          {/* Names the Mad Buddy capability, not the OS mechanism. Avoids "they
              see your area", which invites the question "how big an area?" --
              the honest promise is simply that the exact place is never
              shown. */}
          {/* The privacy promise is made ONCE, by the guarantee below. Saying
              "never your exact location" here and again three lines down read
              as the app reassuring itself. */}
          <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
            Mad Buddy uses your location privately to know when approved Muddies are close by.
          </p>

          {/* Three short guarantees, stated once. Icons carry no meaning alone
              -- each has its label beside it. */}
          <ul className="mt-3 grid gap-2 text-xs text-muted-foreground sm:grid-cols-3">
            <li className="flex items-center gap-2">
              <ShieldCheck className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
              Only approved Muddies
            </li>
            <li className="flex items-center gap-2">
              <Lock className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
              Never your exact location
            </li>
            <li className="flex items-center gap-2">
              <UserRound className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
              You stay in control
            </li>
          </ul>

          {/* The OS prompt fires only after this tap, from the existing
              settings flow -- never automatically on render. */}
          <Button asChild size="lg" className="mt-4 w-full sm:w-auto sm:min-w-[12rem]">
            <Link href={"/settings" as Route}>Turn on Glow</Link>
          </Button>
        </>
      ) : null}
    </section>
  );
}
