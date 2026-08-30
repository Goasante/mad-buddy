"use client";

import Link from "next/link";
import { UserAvatar } from "@/components/ui/user-avatar";
import type { Route } from "next";
import { Lock, ShieldCheck, UserRound } from "lucide-react";
import { Button } from "@/components/ui/button";
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

/** "Ama Serwaa" -> "Ama". The CTA speaks to a person, not a record. */
function firstNameOf(name: string): string {
  return name.trim().split(/\s+/)[0] || name;
}

export function FirstMuddyCard({
  muddy,
  /** True when the OS permission has not produced a usable fix yet. */
  needsLocation,
  onSayHi,
  sayHiPending = false,
  className
}: {
  muddy: { id: string; displayName: string; avatarUrl: string | null };
  needsLocation: boolean;
  /**
   * Opens the direct conversation with this person (MB-GOD-050).
   *
   * Passed in rather than performed here, so this card keeps using Home's
   * canonical `runRelationshipAction` -- `openDirectConversationAction` then
   * `conversationHref` -- instead of growing a second path to a conversation.
   * Nothing is auto-sent: the door opens and the person writes their own
   * words.
   */
  onSayHi?: (muddyId: string) => void;
  sayHiPending?: boolean;
  className?: string;
}) {

  return (
    <section
      aria-labelledby="first-muddy-headline"
      className={cn(
        "relative overflow-hidden rounded-[1.25rem] border border-border/70 bg-card/60 px-5 py-5 sm:px-6",
        className
      )}
    >
      <div className="flex items-start gap-4">
        {/* The real avatar, with NO Glow.
            This card used to hardcode a "near" proximity state, which drew a
            proximity state for somebody whose data carries none -- the `muddy`
            prop is {id, displayName, avatarUrl}. A Glow is a claim about where
            a person is; inventing one to decorate an activation card is the
            one thing the proximity system must never do. */}
        <UserAvatar
          name={muddy.displayName}
          src={muddy.avatarUrl}
          size="lg"
          decorative
          className="shrink-0 border-2 border-background shadow-[inset_0_0_0_1px_hsl(var(--border)),0_8px_24px_hsl(var(--shadow)/0.16)]"
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

      {/* ONE next action at a time, and never two CTAs (MB-GOD-050).
        *
        * This card marked the moment `first_muddy_added` completes and then
        * offered nothing -- every visible control was global chrome. The
        * product's own definition of first value
        * (lib/activation/home-maturity.ts) is `first_muddy_added` AND a social
        * act, so the screen celebrating the first half was the screen best
        * placed to drive the second, and it sent people to the bottom
        * navigation to work it out.
        *
        * The two states are MUTUALLY EXCLUSIVE, which is why this is an
        * if/else rather than two independent blocks. While Glow is still off,
        * turning it on is the honest next step and the card says so; once it
        * is on, the next step is the social act. Rendering both would put
        * "Say hi" beside "Turn on Glow" and make the person choose between the
        * warm thing and the useful thing -- and `first-muddy.test.ts` already
        * holds the line that this card offers ONE primary action.
        *
        * "Say hi" rather than Wave: a wave is a nudge, and the milestone that
        * completes first value is a conversation. It is also the verb Home
        * already uses for a nearby Muddy, so the vocabulary does not fork. */}
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
          <Button asChild size="lg" className="mt-4 w-full sm:w-auto sm:min-w-[min(12rem,100%)]">
            <Link href={"/settings" as Route}>Turn on Glow</Link>
          </Button>
        </>
      ) : onSayHi ? (
        <Button
          type="button"
          size="lg"
          className="mt-4 w-full sm:w-auto sm:min-w-[min(12rem,100%)]"
          onClick={() => onSayHi(muddy.id)}
          disabled={sayHiPending}
        >
          {sayHiPending ? "Opening…" : `Say hi to ${firstNameOf(muddy.displayName)}`}
        </Button>
      ) : null}
    </section>
  );
}
