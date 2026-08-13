"use client";

import Link from "next/link";
import {
  ArrowRight,
  BookUser,
  CalendarDays,
  Camera,
  Hand,
  MapPin,
  MessageCircle,
  ShieldCheck,
  Sparkles,
  Users,
  UsersRound
} from "lucide-react";

import { BrandSymbol } from "@/components/brand/brand-symbol";
import { Button } from "@/components/ui/button";
import { useHasScrolled } from "@/hooks/use-has-scrolled";
import { cn } from "@/lib/utils";

/**
 * About Mad Buddy.
 *
 * A PUBLIC page: no session, so it cannot use MobilePageHeader or PageHeader,
 * both of which carry notifications, Muddy requests and quick controls that
 * only exist for a signed-in person. It follows LandingNav's contract instead
 * -- fixed, full-bleed, safe-area padded, one fixed row height -- because that
 * is the canonical public header shape, and a third variant would be a fourth
 * way to build a header on this codebase.
 *
 * THE NOTCH BUG THIS FIXES. The previous header was `sticky top-0` with no
 * safe-area padding at all. The app sets `viewportFit: "cover"`, so the page
 * genuinely extends under the Dynamic Island, and the title sat beneath it.
 * The inset is now reserved EXACTLY ONCE, on the header, via
 * `pt-[env(safe-area-inset-top)]`. Content clears it with a single spacer
 * derived from the same numbers -- never a negative margin, and never a
 * device-specific constant.
 *
 * WHAT THE COPY IS FOR. This page is read by people deciding whether to trust
 * the product, so every claim on it has to be one the code actually keeps.
 * The previous version promised "no open discovery of strangers" and "you only
 * appear to people you have both approved", which Linkr has made untrue: Linkr
 * shows non-Muddies nearby while a session is running. Rather than soften that
 * into something vague, the page now names both models and says which applies
 * where.
 */

/** The header's own row, matching --app-header-content-height. */
const HEADER_ROW = "4.25rem";

const features = [
  {
    title: "Muddies",
    description: "Your people on Mad Buddy. Requests go both ways, and either side can end it.",
    icon: Users
  },
  {
    title: "Plans & Events",
    description: "Turn a message into something real — coffee, a walk, or a bigger gathering.",
    icon: CalendarDays
  },
  {
    title: "UpFor",
    description: "Say what you're up for right now, and see who else is free.",
    icon: Hand
  },
  {
    title: "Linkr",
    description:
      "Meet people you don't know yet. It only runs while you switch it on, and it stops when you stop it.",
    icon: Sparkles
  },
  {
    title: "Moments",
    description: "Share what you're doing with your Muddies, without building an audience.",
    icon: Camera
  },
  {
    title: "Groups & Messages",
    description: "Talk one to one or in a group, with the same privacy controls throughout.",
    icon: MessageCircle
  },
  {
    title: "Safe Arrival",
    description: "Ask Muddies to check on you, and let them know when you've got there.",
    icon: ShieldCheck
  },
  {
    title: "Find your Muddies",
    description:
      "Optionally check your contacts for people already here. It's off until you turn it on.",
    icon: BookUser
  }
];

const expectations = [
  "Treat people the way you would face to face.",
  "Ask before you assume — plans, photos and meeting up are all consent.",
  "Be yourself. Impersonating someone else is not allowed.",
  "No harassment, abuse, or pressure of any kind.",
  "Respect somebody's privacy settings, including when they go quiet."
];

const principles = [
  {
    title: "Connection, not popularity",
    description:
      "There is no follower count and no ranking of people. Nothing here rewards being seen by the most people."
  },
  {
    title: "Temporary means temporary",
    description:
      "Features that are meant to pass — a Linkr session, an UpFor — end when they say they will."
  },
  {
    title: "Your choices hold",
    description:
      "Turning something off turns it off. Privacy settings are not suggestions the app works around."
  }
];

export function AboutPage() {
  // The divider appears only once content is passing beneath the header, so
  // the bar reads as part of the page at rest. Same hook and same threshold as
  // every other header in the app, so they cannot drift apart.
  const scrolled = useHasScrolled();

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/*
        FULL-BLEED AND FIXED, with the safe-area inset applied here and nowhere
        else. `inset-x-0` rather than a max-width wrapper means the blurred
        surface reaches both edges on every device; the inner nav is what gets
        centred and constrained.
      */}
      <header
        className={cn(
          "fixed inset-x-0 top-0 z-50 bg-background/85 pt-[env(safe-area-inset-top)] backdrop-blur-md transition-shadow",
          scrolled
            ? "border-b border-border/60 shadow-[0_1px_20px_-12px_hsl(var(--shadow)/0.6)]"
            : "border-b border-transparent"
        )}
      >
        <nav
          className="mx-auto flex h-[4.25rem] max-w-5xl items-center justify-between gap-3 px-4 sm:px-6"
          aria-label="About navigation"
        >
          <Link
            href="/"
            className="focus-ring flex min-h-11 items-center gap-2.5 rounded-lg font-semibold"
            aria-label="Mad Buddy home"
          >
            <BrandSymbol className="h-8 w-8" priority />
            <span>Mad Buddy</span>
          </Link>
          <Button asChild size="sm" className="min-h-11">
            <Link href="/login">Get started</Link>
          </Button>
        </nav>
      </header>

      {/*
        THE ONE SPACER. Content begins below the header by exactly the header's
        own row plus the inset -- the same two numbers the header itself uses,
        so the two cannot disagree. A second source of top padding anywhere
        below this is what produced the doubled gap.
      */}
      <div
        aria-hidden="true"
        style={{ height: `calc(env(safe-area-inset-top, 0px) + ${HEADER_ROW})` }}
      />

      <main className="mx-auto max-w-3xl px-4 pb-16 sm:px-6">
        <section className="pt-8 sm:pt-12">
          <h1 className="text-3xl font-semibold leading-tight tracking-tight sm:text-4xl">
            About Mad Buddy
          </h1>
          <p className="mt-4 text-base leading-7 text-muted-foreground">
            Mad Buddy is for seeing the people you know, meeting people you don&rsquo;t, and turning both into
            time spent together. It is built around one idea: what happens offline matters more than what
            happens in the app.
          </p>
        </section>

        <section aria-labelledby="what-heading" className="mt-12 border-t border-border/60 pt-10">
          <h2 id="what-heading" className="text-xl font-semibold tracking-tight">
            What Mad Buddy is
          </h2>
          <ul className="mt-6 grid gap-4 sm:grid-cols-2">
            {features.map((feature) => (
              <li key={feature.title} className="rounded-2xl border border-border/70 bg-card/50 p-5">
                <span className="grid h-10 w-10 place-items-center rounded-full bg-primary/10 text-primary">
                  <feature.icon className="h-5 w-5" aria-hidden="true" />
                </span>
                <h3 className="mt-3 text-sm font-semibold">{feature.title}</h3>
                <p className="mt-1 text-sm leading-6 text-muted-foreground">{feature.description}</p>
              </li>
            ))}
          </ul>
        </section>

        <section aria-labelledby="expect-heading" className="mt-12 border-t border-border/60 pt-10">
          <h2 id="expect-heading" className="text-xl font-semibold tracking-tight">
            How we expect people to use it
          </h2>
          <ul className="mt-5 space-y-3">
            {expectations.map((line) => (
              <li key={line} className="flex gap-3 text-sm leading-6 text-muted-foreground">
                <span aria-hidden="true" className="mt-2 h-1 w-1 shrink-0 rounded-full bg-primary" />
                {line}
              </li>
            ))}
          </ul>
          {/*
            A SUMMARY, not the rulebook. There is no Community Guidelines route
            in the product yet, so this deliberately links to nothing rather
            than inventing a destination -- see the report accompanying this
            change.
          */}
          <p className="mt-5 text-sm leading-6 text-muted-foreground">
            Accounts that break these expectations can be limited or removed. The{" "}
            <Link
              href="/terms"
              className="focus-ring rounded font-medium text-foreground underline underline-offset-4"
            >
              Terms
            </Link>{" "}
            set out the formal version.
          </p>
        </section>

        <section aria-labelledby="identity-heading" className="mt-12 border-t border-border/60 pt-10">
          <h2 id="identity-heading" className="text-xl font-semibold tracking-tight">
            Trust &amp; identity
          </h2>
          <p className="mt-3 text-sm leading-6 text-muted-foreground">
            Three separate marks. Someone may have any combination of them, and none of them is a promise
            that a person is safe &mdash; use your own judgement when you meet anyone.
          </p>
          <dl className="mt-5 space-y-4">
            <div>
              <dt className="text-sm font-semibold">Verified Account</dt>
              <dd className="mt-1 text-sm leading-6 text-muted-foreground">
                Mad Buddy has verified this account through its verification process.
              </dd>
            </div>
            <div>
              <dt className="text-sm font-semibold">Trusted Member</dt>
              <dd className="mt-1 text-sm leading-6 text-muted-foreground">
                Standing earned through the product and reviewed by our team. It is not an identity check.
              </dd>
            </div>
            <div>
              <dt className="text-sm font-semibold">Premium</dt>
              <dd className="mt-1 text-sm leading-6 text-muted-foreground">
                A Plus or Pro subscription. It says nothing about identity or standing.
              </dd>
            </div>
          </dl>
        </section>

        <section aria-labelledby="privacy-heading" className="mt-12 border-t border-border/60 pt-10">
          <h2 id="privacy-heading" className="text-xl font-semibold tracking-tight">
            Safety &amp; privacy
          </h2>

          <h3 className="mt-5 text-sm font-semibold">Two ways people find each other</h3>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            {/*
              THE CORRECTION. The previous page said there was "no open
              discovery of strangers", which Linkr has made untrue. Both models
              are named, and which one applies where.
            */}
            With your Muddies, proximity is mutual: you each see a rough sense of how close the other is
            &mdash; close, near or far &mdash; never a map, a pin or a distance. With Linkr, you can be seen
            by people you don&rsquo;t know yet, but only while you have a session switched on, and only at
            that same rough level.
          </p>

          <h3 className="mt-6 text-sm font-semibold">Your controls</h3>
          <ul className="mt-2 space-y-3">
            <li className="flex gap-3 text-sm leading-6 text-muted-foreground">
              <MapPin className="mt-1 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
              Your exact location is never shown to anyone, and no location history is kept.
            </li>
            <li className="flex gap-3 text-sm leading-6 text-muted-foreground">
              <UsersRound className="mt-1 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
              Ghost mode hides you from nearby immediately, and Linkr can be switched off at any point.
            </li>
            <li className="flex gap-3 text-sm leading-6 text-muted-foreground">
              <ShieldCheck className="mt-1 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
              You can block or report anyone. Blocking is mutual and takes effect everywhere.
            </li>
            <li className="flex gap-3 text-sm leading-6 text-muted-foreground">
              <BookUser className="mt-1 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
              Contact discovery is optional and off by default. Your number is never shown on your profile,
              and letting people find you by it is a separate choice from checking your own contacts.
            </li>
          </ul>
        </section>

        <section aria-labelledby="principles-heading" className="mt-12 border-t border-border/60 pt-10">
          <h2 id="principles-heading" className="text-xl font-semibold tracking-tight">
            Our principles
          </h2>
          <dl className="mt-5 space-y-4">
            {principles.map((principle) => (
              <div key={principle.title}>
                <dt className="text-sm font-semibold">{principle.title}</dt>
                <dd className="mt-1 text-sm leading-6 text-muted-foreground">{principle.description}</dd>
              </div>
            ))}
          </dl>
        </section>

        <section aria-labelledby="more-heading" className="mt-12 border-t border-border/60 pt-10">
          <h2 id="more-heading" className="text-xl font-semibold tracking-tight">
            Read more
          </h2>
          {/* Every destination here is a real route. */}
          <nav className="mt-4 grid gap-2 sm:grid-cols-3" aria-labelledby="more-heading">
            {[
              { href: "/privacy" as const, label: "Privacy Policy" },
              { href: "/terms" as const, label: "Terms" },
              { href: "/faq" as const, label: "FAQ" }
            ].map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className="focus-ring flex min-h-11 items-center justify-between gap-2 rounded-xl border border-border/70 px-4 text-sm font-medium hover:bg-secondary/40"
              >
                {link.label}
                <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              </Link>
            ))}
          </nav>
        </section>
      </main>

      {/* Bottom safe area, so the last row never sits under a home indicator. */}
      <footer className="border-t border-border/60 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-6">
        <div className="mx-auto flex max-w-3xl flex-col gap-3 px-4 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <Link href="/" className="focus-ring flex items-center gap-2 rounded font-semibold text-foreground">
            <BrandSymbol className="h-6 w-6" />
            Mad Buddy
          </Link>
          <p>&copy; {new Date().getFullYear()} Mad Buddy</p>
        </div>
      </footer>
    </div>
  );
}
