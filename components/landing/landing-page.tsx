"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect } from "react";
import {
  ArrowRight,
  Bell,
  CalendarDays,
  CalendarCheck2,
  Check,
  Coffee,
  Eye,
  EyeOff,
  Ghost,
  Hand,
  History,
  LockKeyhole,
  Map,
  MapPinOff,
  MessageCircle,
  Music2,
  Radio,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Users,
  X
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { BrandMark } from "@/components/brand/brand-mark";
import { LandingNav, useLandingActiveSection } from "@/components/landing/landing-nav";
import { cn } from "@/lib/utils";

const trustPoints = ["Mutual approval required", "No maps or exact locations", "You control when you're visible"];

const howItWorksSteps = [
  {
    title: "Glow",
    description: "See Muddies around you through broad proximity signals.",
    icon: Sparkles
  },
  {
    title: "Wave",
    description: "Show that you're open to connecting.",
    icon: Hand
  },
  {
    title: "Ping",
    description: "Start a conversation and see if the feeling is mutual.",
    icon: MessageCircle
  },
  {
    title: "Plan",
    description: "Create a plan and invite your Muddies.",
    icon: CalendarCheck2
  },
  {
    title: "Meet",
    description: "Turn nearby connections into real moments.",
    icon: Users
  }
];

const useCases = [
  {
    title: "Easy catch-ups",
    description: "Turn a quick break into a hello.",
    icon: Coffee
  },
  {
    title: "Same event",
    description: "Notice approved friends at the same venue.",
    icon: Music2
  },
  {
    title: "Everyday plans",
    description: "Coffee, food, walks, or spontaneous meetups.",
    icon: Users
  },
  {
    title: "Privacy-first",
    description: "Everything is designed around your privacy.",
    icon: ShieldCheck
  }
];

const momentSteps = [
  {
    title: "Glow",
    description: "See an approved Muddy nearby.",
    icon: Sparkles
  },
  {
    title: "Wave",
    description: "Start a simple conversation.",
    icon: Hand
  },
  {
    title: "Plan",
    description: "Agree on a place and time.",
    icon: CalendarDays
  },
  {
    title: "Meet",
    description: "Turn digital proximity into real moments.",
    icon: Users
  }
];

const momentTrustPoints = [
  { label: "Approved friends only", icon: LockKeyhole },
  { label: "No exact location", icon: MapPinOff },
  { label: "No maps", icon: Map },
  { label: "No location history", icon: History }
];

const muddiesMaySee = [
  "Very close, Nearby, or Around",
  "Your chosen profile name and image",
  "Whether you have chosen to be visible"
];

const muddiesNeverSee = [
  "Exact coordinates",
  "Map pins",
  "Street addresses",
  "Direction of travel",
  "Exact distance",
  "Location history"
];

const safetyControls = [
  {
    title: "Ghost Mode",
    description: "Pause your visibility whenever you need privacy.",
    icon: Ghost
  },
  {
    title: "Block and report",
    description: "Block or report anyone who makes you uncomfortable.",
    icon: ShieldAlert
  }
];

const featureItems = [
  {
    title: "Privacy-safe proximity",
    description: "See Very close, Nearby, or Around, never an exact distance.",
    icon: Radio
  },
  {
    title: "Mutual approval",
    description: "Only Muddies you both approve can appear nearby.",
    icon: ShieldCheck
  },
  {
    title: "Visibility controls",
    description: "Choose when your glow is visible.",
    icon: Eye
  },
  {
    title: "Nearby alerts",
    description: "Get optional alerts when selected Muddies are nearby.",
    icon: Bell
  },
  {
    title: "Circles",
    description: "Organise Muddies into groups that make sense to you.",
    icon: Users
  },
  {
    title: "Glow styles",
    description: "Personalise your profile without sharing additional location detail.",
    icon: Sparkles
  }
];

export function LandingPage() {
  const [activeSection, setActiveSection] = useLandingActiveSection();

  // Full-viewport scroll snapping lives on <html> (the real scroll
  // container) so the nav's window-scroll tracking keeps working. Scoped by
  // class so no other page inherits it; removed on unmount.
  useEffect(() => {
    document.documentElement.classList.add("landing-snap");
    return () => document.documentElement.classList.remove("landing-snap");
  }, []);

  // One restrained entry animation per section (opacity + small rise), not
  // per card. CSS keeps elements fully visible under prefers-reduced-motion,
  // so this observer only ever enhances.
  useEffect(() => {
    const elements = Array.from(document.querySelectorAll<HTMLElement>(".landing-reveal"));
    if (elements.length === 0) return;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            entry.target.classList.add("is-visible");
            observer.unobserve(entry.target);
          }
        }
      },
      { threshold: 0.15 }
    );
    for (const element of elements) observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return (
    <>
      <a
        href="#main-content"
        className="focus-ring sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-[100] focus:rounded-lg focus:bg-background focus:px-4 focus:py-2 focus:shadow-lg"
      >
        Skip to content
      </a>
      <LandingNav activeSection={activeSection} onSectionChange={setActiveSection} />
      <main id="main-content" className="min-h-screen bg-background text-foreground">
        <Hero />
        <HowItWorksSection />
        <RealLifeMomentsSection />
        <PrivacySection />
        <FeatureSection />
        <FinalCta />
        <Footer />
      </main>
    </>
  );
}

function Hero() {
  return (
    <section
      id="hero"
      className="landing-section relative flex min-h-[100svh] items-center overflow-clip px-4 pb-10 pt-[calc(var(--header-height)+1.5rem)] sm:px-6 lg:px-10"
    >
      <div
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_20%_20%,rgba(249,115,22,0.16),transparent_42%),radial-gradient(circle_at_80%_30%,rgba(251,146,60,0.12),transparent_40%),radial-gradient(circle_at_50%_90%,rgba(234,88,12,0.14),transparent_45%)]"
        aria-hidden="true"
      />
      <div className="landing-reveal relative mx-auto grid w-full max-w-7xl items-center gap-10 lg:grid-cols-[0.85fr_1.15fr] lg:gap-14">
        <div className="max-w-2xl">
          <h1 className="text-4xl font-semibold leading-[1.08] tracking-tight sm:text-5xl lg:text-[3.25rem]">
            When your Muddies are close,{" "}
            <span className="text-primary">they glow.</span>
          </h1>
          <p className="mt-5 max-w-xl text-base leading-7 text-muted-foreground sm:text-lg">
            A <strong className="font-semibold text-foreground">Muddy</strong>{" "}is a friend you
            both approve. See who&rsquo;s nearby, connect, and make plans, without sharing exact
            locations.
          </p>
          <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
            <Button asChild size="lg">
              <Link href="/login" aria-label="Get started: create a Mad Buddy account">
                Get started
                <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </Link>
            </Button>
            <Button asChild variant="outline" size="lg">
              <a href="#how-it-works" aria-label="See how Mad Buddy works">
                See how it works
              </a>
            </Button>
          </div>
          {/* Trust points stay inside the hero as a compact inline line, not
              a separate strip. */}
          <ul className="mt-6 flex flex-col gap-2 text-xs text-muted-foreground sm:flex-row sm:flex-wrap sm:items-center sm:gap-x-5 sm:gap-y-1.5">
            {trustPoints.map((item) => (
              <li key={item} className="inline-flex items-center gap-1.5">
                <Check className="h-3.5 w-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </div>
        <div className="relative flex w-full items-center justify-center">
          {/* Ambient glow behind the mockup: a wide soft haze plus a tighter
              warm core centred on the middle phone, echoing the hero's own
              radial atmosphere so the devices sit in the same pool of light
              rather than on a separate backdrop. */}
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-[-4%] rounded-full bg-orange-500/6 blur-[100px] lg:inset-[-8%] lg:bg-orange-500/9 lg:blur-[150px]"
          />
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-[14%] rounded-full bg-orange-400/10 blur-[60px] lg:inset-[12%] lg:bg-orange-400/15 lg:blur-[95px]"
          />
          {/* A soft, irregular (not circular) orange haze, deliberately
              blob-shaped rather than a perfect ring so it reads as ambient
              light, not a radar/tracking signal. */}
          <div
            aria-hidden="true"
            className="pointer-events-none absolute left-1/2 top-1/2 h-[70%] w-[70%] -translate-x-1/2 -translate-y-1/2 rounded-[62%_38%_55%_45%/45%_60%_40%_55%] bg-orange-500/10 blur-[65px] lg:blur-[95px]"
          />
          {/* A soft grounding shadow so the phones read as standing in the
              scene instead of floating with nothing beneath them. */}
          <div
            aria-hidden="true"
            className="pointer-events-none absolute bottom-0 left-1/2 h-10 w-[55%] -translate-x-1/2 rounded-[100%] bg-black/25 blur-xl lg:bottom-[2%] lg:h-16 lg:w-[60%] lg:bg-black/40 lg:blur-2xl"
          />
          {/* This asset has its background removed (true alpha, not a CSS
              mask). The phones and glow lines are the only opaque pixels,
              so nothing here can read as a rectangle. A slight contrast/
              saturation lift keeps the devices reading as sharp as the
              surrounding text without touching the source file. */}
          <Image
            src="/brand/mad-buddy-hero-mockup-v2.png"
            alt="Mad Buddy showing nearby Muddies, plans, and privacy controls"
            width={617}
            height={405}
            priority
            sizes="(max-width: 1024px) 75vw, 42vw"
            className="relative z-10 h-auto w-full max-w-[560px] object-contain [filter:contrast(1.06)_saturate(1.08)]"
          />
        </div>
      </div>
    </section>
  );
}

function HowItWorksSection() {
  return (
    <section
      id="how-it-works"
      className="landing-section relative flex min-h-[calc(100svh-var(--header-height))] items-center overflow-clip px-4 py-10 sm:px-6 lg:px-10"
    >
      <div
        className="pointer-events-none absolute inset-x-0 top-0 h-72 bg-[radial-gradient(circle_at_50%_0%,rgba(249,115,22,0.1),transparent_65%)]"
        aria-hidden="true"
      />
      <div className="landing-reveal relative mx-auto w-full max-w-7xl">
        <SectionHeading
          eyebrow="How it works"
          title="Simple. Social. Human."
          description="Mad Buddy helps approved Muddies go from nearby to meeting in real life."
          align="center"
        />
        <ol className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          {howItWorksSteps.map((step, index) => (
            <li key={step.title} className="rounded-2xl border border-border/80 bg-card/60 p-5">
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-primary/10 text-primary">
                <step.icon className="h-5 w-5" aria-hidden="true" />
              </span>
              <p className="mt-3 text-sm font-semibold">
                {index + 1}. {step.title}
              </p>
              <p className="mt-1.5 text-sm leading-6 text-muted-foreground">{step.description}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

function RealLifeMomentsSection() {
  return (
    <section
      id="real-life-moments"
      className="landing-section relative flex min-h-[calc(100svh-var(--header-height))] items-center overflow-clip bg-secondary/20 px-4 py-16 sm:px-6 sm:py-20 lg:px-10"
    >
      <div
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_18%_42%,hsl(var(--primary)/0.08),transparent_30%),radial-gradient(circle_at_82%_58%,hsl(var(--primary)/0.05),transparent_28%)]"
        aria-hidden="true"
      />
      <div className="landing-reveal moment-story relative mx-auto w-full max-w-7xl">
        <SectionHeading
          eyebrow="Real-life moments"
          title="Made for moments that happen offline."
          description="See who's around. Say hello. Make plans. Meet in real life."
          align="center"
        />
        <div className="mx-auto mt-12 grid max-w-6xl items-start gap-8 lg:grid-cols-[1.08fr_0.92fr] lg:gap-10">
          <div className="rounded-[1.75rem] border border-border/70 bg-card/45 p-5 shadow-[0_24px_70px_hsl(var(--shadow)/0.1)] sm:p-7">
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-primary">Nearby to real life</p>
            <ol className="mt-6" aria-label="How a nearby moment becomes a real-life meeting">
              {momentSteps.map((step, index) => (
                <li key={step.title} className="moment-step relative flex gap-4 pb-5 last:pb-0 sm:gap-5">
                  <div className="relative z-10 flex w-11 shrink-0 justify-center">
                    <span className="grid h-11 w-11 place-items-center rounded-full border border-primary/35 bg-primary/10 text-primary shadow-[0_0_24px_hsl(var(--primary)/0.12)]">
                      <step.icon className="h-5 w-5" aria-hidden="true" />
                    </span>
                  </div>
                  <article className="group min-h-[104px] flex-1 rounded-2xl border border-border/70 bg-background/60 p-4 transition-[transform,border-color,box-shadow] duration-300 hover:-translate-y-1 hover:border-primary/40 hover:shadow-[0_18px_40px_hsl(var(--primary)/0.1)] sm:p-5">
                    <div className="flex items-center gap-3">
                      <span className="text-xs font-semibold tabular-nums text-primary">0{index + 1}</span>
                      <h3 className="text-base font-semibold">{step.title}</h3>
                    </div>
                    <p className="mt-2 text-sm leading-6 text-muted-foreground">{step.description}</p>
                  </article>
                </li>
              ))}
            </ol>

            <div className="moment-trust mt-6 rounded-2xl border border-emerald-500/20 bg-emerald-500/[0.06] p-4">
              <div className="flex items-center gap-2 text-sm font-semibold">
                <ShieldCheck className="h-4 w-4 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
                Privacy built in
              </div>
              <ul className="mt-3 grid gap-2 sm:grid-cols-2">
                {momentTrustPoints.map((point) => (
                  <li key={point.label} className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Check className="h-3.5 w-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
                    {point.label}
                  </li>
                ))}
              </ul>
            </div>
          </div>

          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-primary">Made for everyday connection</p>
            <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
              {useCases.map((item) => (
                <article
                  key={item.title}
                  className="moment-benefit group relative min-h-[156px] overflow-hidden rounded-2xl border border-border/70 bg-card/60 p-5 transition-[transform,border-color,box-shadow] duration-300 hover:-translate-y-1 hover:border-primary/35 hover:shadow-[0_18px_45px_hsl(var(--primary)/0.1)]"
                >
                  <div className="pointer-events-none absolute -right-8 -top-8 h-24 w-24 rounded-full border border-primary/10 transition-transform duration-500 group-hover:scale-125" aria-hidden="true" />
                  <span className="grid h-10 w-10 place-items-center rounded-xl bg-primary/10 text-primary transition-colors duration-300 group-hover:bg-primary group-hover:text-primary-foreground">
                    <item.icon className="h-5 w-5" aria-hidden="true" />
                  </span>
                  <h3 className="mt-4 text-base font-semibold">{item.title}</h3>
                  <p className="mt-1.5 text-sm leading-6 text-muted-foreground">{item.description}</p>
                </article>
              ))}
            </div>
          </div>
        </div>

        <ul className="moment-trust mx-auto mt-8 flex max-w-5xl flex-wrap items-center justify-center gap-x-6 gap-y-3 border-y border-border/60 py-4" aria-label="Mad Buddy privacy protections">
          {momentTrustPoints.map((point) => (
            <li key={point.label} className="inline-flex items-center gap-2 text-xs font-medium text-muted-foreground sm:text-sm">
              <point.icon className="h-4 w-4 text-primary" aria-hidden="true" />
              {point.label}
            </li>
          ))}
        </ul>

        <div className="moment-cta mx-auto mt-10 flex max-w-3xl flex-col items-center text-center">
          <h3 className="text-2xl font-semibold tracking-tight sm:text-3xl">Ready to meet naturally?</h3>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-muted-foreground sm:text-base">
            Join Mad Buddy and turn nearby moments into real connections.
          </p>
          <div className="mt-6 flex w-full flex-col justify-center gap-3 sm:w-auto sm:flex-row">
            <Button asChild size="lg">
              <Link href="/login" aria-label="Join Mad Buddy">
                Join Mad Buddy
                <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </Link>
            </Button>
            <Button asChild size="lg" variant="outline">
              <a href="#how-it-works" aria-label="See how Mad Buddy works">See how it works</a>
            </Button>
          </div>
        </div>
      </div>
    </section>
  );
}

function PrivacySection() {
  return (
    <section
      id="privacy"
      className="landing-section relative flex min-h-[calc(100svh-var(--header-height))] items-center overflow-clip px-4 py-10 sm:px-6 lg:px-10"
    >
      <div className="landing-reveal mx-auto w-full max-w-7xl">
        <SectionHeading
          eyebrow="Privacy and safety"
          title="Nearby, without giving away where."
          description="Only approved friends can see when you're nearby. No exact location is shared."
          align="center"
        />
        <div className="mx-auto mt-8 grid max-w-5xl gap-4 lg:grid-cols-2">
          <div className="rounded-2xl border border-border/80 bg-card/60 p-5">
            <div className="flex items-center gap-3">
              <span className="grid h-9 w-9 place-items-center rounded-full bg-emerald-400/12 text-emerald-700 dark:text-emerald-100">
                <Eye className="h-4 w-4" aria-hidden="true" />
              </span>
              <h3 className="text-base font-semibold">What Muddies may see</h3>
            </div>
            <ul className="mt-4 space-y-2">
              {muddiesMaySee.map((item) => (
                <li key={item} className="flex gap-2.5 text-sm leading-6 text-muted-foreground">
                  <Check className="mt-1 h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </div>
          <div className="rounded-2xl border border-border/80 bg-card/60 p-5">
            <div className="flex items-center gap-3">
              <span className="grid h-9 w-9 place-items-center rounded-full bg-red-400/10 text-red-700 dark:text-red-200">
                <EyeOff className="h-4 w-4" aria-hidden="true" />
              </span>
              <h3 className="text-base font-semibold">What Muddies never see</h3>
            </div>
            <ul className="mt-4 grid gap-x-4 gap-y-2 sm:grid-cols-2">
              {muddiesNeverSee.map((item) => (
                <li key={item} className="flex gap-2.5 text-sm leading-6 text-muted-foreground">
                  <X className="mt-1 h-4 w-4 shrink-0 text-red-600 dark:text-red-300" aria-hidden="true" />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
        <div className="mx-auto mt-4 grid max-w-5xl gap-4 sm:grid-cols-2">
          {safetyControls.map((item) => (
            <div key={item.title} className="flex items-start gap-3 rounded-2xl border border-border/80 bg-card/60 p-5">
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-primary/10 text-primary">
                <item.icon className="h-4 w-4" aria-hidden="true" />
              </span>
              <div>
                <h3 className="text-base font-semibold">{item.title}</h3>
                <p className="mt-1 text-sm leading-6 text-muted-foreground">{item.description}</p>
              </div>
            </div>
          ))}
        </div>
        <p className="mt-6 text-center text-sm text-muted-foreground">
          Read the full{" "}
          <Link href="/privacy" className="font-medium text-primary underline-offset-4 hover:underline">
            privacy policy
          </Link>{" "}
          for details on data handling.
        </p>
      </div>
    </section>
  );
}

function FeatureSection() {
  return (
    <section
      id="features"
      className="landing-section relative flex min-h-[calc(100svh-var(--header-height))] items-center overflow-clip bg-secondary/20 px-4 py-10 sm:px-6 lg:px-10"
    >
      <div className="landing-reveal mx-auto w-full max-w-7xl">
        <SectionHeading
          eyebrow="Features"
          title="Built for connection, not tracking."
          align="center"
        />
        <div className="mx-auto mt-10 grid max-w-5xl gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {featureItems.map((feature) => (
            <article key={feature.title} className="rounded-2xl border border-border/80 bg-card p-5">
              <span className="grid h-10 w-10 place-items-center rounded-full bg-primary/10 text-primary">
                <feature.icon className="h-5 w-5" aria-hidden="true" />
              </span>
              <h3 className="mt-3 text-base font-semibold">{feature.title}</h3>
              <p className="mt-1.5 text-sm leading-6 text-muted-foreground">{feature.description}</p>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

function FinalCta() {
  return (
    <section
      id="get-started"
      className="landing-section relative flex min-h-[calc(100svh-var(--header-height))] items-center overflow-clip px-4 py-10 sm:px-6 lg:px-10"
    >
      <div className="landing-reveal mx-auto w-full max-w-7xl">
        <div className="mx-auto overflow-hidden rounded-2xl bg-primary px-6 py-12 sm:px-10 sm:py-16">
          <div className="mx-auto max-w-2xl text-center">
            <h2 className="text-3xl font-semibold tracking-tight text-primary-foreground sm:text-4xl">
              Your Muddies are closer than you think.
            </h2>
            <p className="mt-4 text-base leading-7 text-primary-foreground/85">
              Create an account, approve a friend, and choose when to glow.
            </p>
            <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row">
              <Button asChild size="lg" className="bg-background text-primary hover:bg-background/90">
                <Link href="/login" aria-label="Get started: create a Mad Buddy account">
                  Get started
                  <ArrowRight className="h-4 w-4" aria-hidden="true" />
                </Link>
              </Button>
              <Button
                asChild
                variant="outline"
                size="lg"
                className="border-primary-foreground/30 bg-transparent text-primary-foreground hover:bg-primary-foreground/10 hover:text-primary-foreground"
              >
                <Link href="/login" aria-label="Log in to Mad Buddy">
                  Log in
                </Link>
              </Button>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function Footer() {
  return (
    <footer className="landing-section flex min-h-[calc(100svh-var(--header-height))] items-center px-4 py-10 sm:px-6 lg:px-10">
      <div className="mx-auto w-full max-w-7xl border-t border-border/70 pt-10">
        <div className="grid gap-10 lg:grid-cols-[1.7fr_0.8fr_0.8fr_0.8fr] lg:gap-12">
          <div className="max-w-sm">
            <Link href="#hero" className="inline-flex items-center gap-3" aria-label="Mad Buddy home" title="Mad Buddy home">
              <BrandMark className="h-9 w-9" />
              <span className="text-base font-semibold text-foreground">Mad Buddy</span>
            </Link>
            <p className="mt-4 text-sm leading-6 text-muted-foreground">
              When your friends are close, they glow.
            </p>
          </div>

          <nav aria-label="Explore">
            <h2 className="text-sm font-semibold text-foreground">Explore</h2>
            <ul className="mt-4 flex flex-col gap-3 text-sm text-muted-foreground">
              <li>
                <a href="#how-it-works" className="transition-colors hover:text-foreground">
                  How it works
                </a>
              </li>
              <li>
                <Link href="/privacy" className="transition-colors hover:text-foreground">
                  Privacy
                </Link>
              </li>
              <li>
                <Link href="/about" className="transition-colors hover:text-foreground">
                  About
                </Link>
              </li>
              <li>
                <a href="#features" className="transition-colors hover:text-foreground">
                  Features
                </a>
              </li>
              <li>
                <Link href="/pricing" className="transition-colors hover:text-foreground">
                  Pricing
                </Link>
              </li>
              <li>
                <Link href="/faq" className="transition-colors hover:text-foreground">
                  FAQ
                </Link>
              </li>
            </ul>
          </nav>

          <nav aria-label="Account">
            <h2 className="text-sm font-semibold text-foreground">Account</h2>
            <ul className="mt-4 flex flex-col gap-3 text-sm text-muted-foreground">
              <li>
                <Link href="/login" className="transition-colors hover:text-foreground">
                  Get started
                </Link>
              </li>
              <li>
                <Link href="/login" className="transition-colors hover:text-foreground">
                  Log in
                </Link>
              </li>
            </ul>
          </nav>

          <nav aria-label="Legal">
            <h2 className="text-sm font-semibold text-foreground">Legal</h2>
            <ul className="mt-4 flex flex-col gap-3 text-sm text-muted-foreground">
              <li>
                <Link href="/privacy" className="transition-colors hover:text-foreground">
                  Privacy policy
                </Link>
              </li>
              <li>
                <Link href="/terms" className="transition-colors hover:text-foreground">
                  Terms of use
                </Link>
              </li>
            </ul>
          </nav>
        </div>

        <div className="mt-10 flex flex-col gap-3 border-t border-border/70 pt-6 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
          <p>&copy; {new Date().getFullYear()} Mad Buddy. All rights reserved.</p>
        </div>
      </div>
    </footer>
  );
}

function SectionHeading({
  eyebrow,
  title,
  description,
  align = "left"
}: {
  eyebrow: string;
  title: string;
  description?: string;
  align?: "left" | "center";
}) {
  return (
    <div className={cn("max-w-3xl", align === "center" && "mx-auto text-center")}>
      <p className="text-xs font-semibold uppercase tracking-[0.22em] text-primary">{eyebrow}</p>
      <h2 className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">{title}</h2>
      {description ? (
        <p className="mt-4 text-base leading-7 text-muted-foreground">{description}</p>
      ) : null}
    </div>
  );
}
