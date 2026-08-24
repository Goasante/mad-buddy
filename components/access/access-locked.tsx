import Link from "next/link";
import { Check, Radio, Coffee, ArrowRight } from "lucide-react";

import { Button } from "@/components/ui/button";

/**
 * THE LOCKED STATE FOR LINKR AND UPFOR.
 *
 * The feature is not hidden and the nav item stays put. Somebody whose access
 * ended should be able to walk back to the thing they lost and read a straight
 * answer, rather than find the button gone and wonder whether they broke
 * something.
 *
 * Four things, in the order a person actually asks them:
 *
 *   1. what this feature does          (they may have never used it)
 *   2. why it stopped                  (welcome access ended / needs Access)
 *   3. WHAT THEY STILL HAVE            (the part that prevents panic)
 *   4. how to get it back              (one honest action)
 *
 * Point 3 is not padding. Without it "your access has ended" reads as "Mad
 * Buddy has ended", and the overwhelming majority of this product is free
 * forever. Leading with what survives is the difference between an honest
 * boundary and a scare.
 *
 * WHAT THIS COMPONENT DELIBERATELY DOES NOT DO -- each is a named dark pattern
 * in the monetization constitution:
 *
 *   no countdown timer, and no urgency the clock does not genuinely justify
 *   no "N people are waiting for you" -- fabricated demand
 *   no fake scarcity, no "limited spots"
 *   no guilt copy about friends missing you
 *   no hidden or disguised dismissal
 *   no interstitial over the free app -- this renders INSIDE the paid surface
 *
 * It also never says "upgrade your account". There is one boundary, not a
 * ladder of tiers, and the free part of the account is not being upgraded away.
 */

export type AccessLockedProps = {
  surface: "linkr" | "upfor";
  /**
   * True when this person previously held Welcome Access. It changes the
   * headline from an introduction to an ending, which is the difference
   * between "here is a feature" and "here is a feature you had".
   */
  hadWelcomeAccess: boolean;
};

const COPY = {
  linkr: {
    name: "Linkr",
    icon: Radio,
    does: "Linkr is how you meet people you don't know yet — nearby, and only while you have a session switched on.",
    keeps: "Everyone you have already connected with, and every conversation you have with them, stays exactly where it is."
  },
  upfor: {
    name: "UpFor",
    icon: Coffee,
    does: "UpFor is how you say what you're open to — coffee, a walk, a match — and find people nearby who are up for the same thing.",
    keeps: "Plans you already made are still yours, with their chat and everyone in them. You can still see what your own Muddies are up for."
  }
} as const;

/** Free forever. Named individually because a category label reassures nobody. */
const STAYS_FREE = [
  "Muddies and your existing connections",
  "Messages and every conversation you already have",
  "Plans, Plan chat and Events",
  "Glow and proximity with your Muddies",
  "Safe Arrival"
];

export function AccessLocked({ surface, hadWelcomeAccess }: AccessLockedProps) {
  const copy = COPY[surface];
  const Icon = copy.icon;

  return (
    <section
      className="mx-auto w-full max-w-xl px-4 py-8 sm:py-10"
      aria-labelledby="access-locked-title"
    >
      <div className="rounded-[1.35rem] border border-border bg-card/60 p-5 sm:p-7">
        <span className="grid h-11 w-11 place-items-center rounded-full bg-primary/10 text-primary">
          <Icon className="h-5 w-5" aria-hidden="true" />
        </span>

        <h1 id="access-locked-title" className="mt-4 text-xl font-semibold tracking-tight sm:text-2xl">
          {hadWelcomeAccess
            ? `Your Welcome Access has ended`
            : `${copy.name} needs Mad Buddy Access`}
        </h1>

        {/* WHY, stated plainly. No payment was ever taken, and saying so is
            not a nicety: people who do not remember entering card details
            deserve to be told they did not. */}
        <p className="mt-3 text-sm leading-6 text-muted-foreground">
          {hadWelcomeAccess
            ? `Your 14 days with ${copy.name} and UpFor are up. Nothing was charged — you never added a payment method, and nothing renewed on its own.`
            : `${copy.name} is part of Mad Buddy Access.`}
        </p>

        {/* WHAT IT DOES — they may be meeting the feature for the first time. */}
        <p className="mt-3 text-sm leading-6 text-muted-foreground">{copy.does}</p>

        {/* WHAT SURVIVES — the reassurance, given real estate, not a footnote. */}
        <div className="mt-5 rounded-2xl border border-emerald-500/20 bg-emerald-500/[0.06] p-4">
          <p className="text-sm font-semibold">Mad Buddy itself stays free</p>
          <ul className="mt-3 grid gap-2">
            {STAYS_FREE.map((item) => (
              <li key={item} className="flex items-start gap-2 text-xs leading-5 text-muted-foreground sm:text-sm">
                <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
                {item}
              </li>
            ))}
          </ul>
          <p className="mt-3 text-xs leading-5 text-muted-foreground">{copy.keeps}</p>
        </div>

        {/* HOW TO GET IT BACK — one action, no pressure, and a way to simply
            read about it rather than being funnelled straight at a payment. */}
        <div className="mt-6 flex flex-col gap-3 sm:flex-row">
          <Button asChild size="lg">
            <Link href="/settings/access">
              Get Mad Buddy Access
              <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </Link>
          </Button>
          <Button asChild size="lg" variant="outline">
            <Link href="/settings/access">See what&rsquo;s included</Link>
          </Button>
        </div>
      </div>
    </section>
  );
}
