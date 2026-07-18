"use client";

import Image from "next/image";
import Link from "next/link";
import {
  ArrowRight,
  Battery,
  Bell,
  CalendarCheck2,
  Check,
  Eye,
  Ghost,
  GraduationCap,
  Hand,
  Lock,
  MapPinOff,
  Music2,
  Radio,
  ShieldCheck,
  Sparkles,
  Users,
  UserPlus
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { BrandMark } from "@/components/brand/brand-mark";
import { LandingNav, useLandingActiveSection } from "@/components/landing/landing-nav";
import { cn } from "@/lib/utils";

const railFeatures = [
  {
    title: "See who's around",
    description: "Know when approved Muddies are nearby.",
    icon: Radio
  },
  {
    title: "Wave and connect",
    description: "Start a conversation when the feeling is mutual.",
    icon: Hand
  },
  {
    title: "Make plans",
    description: "Create plans and invite your Muddies.",
    icon: CalendarCheck2
  },
  {
    title: "Meet in real life",
    description: "Turn nearby connections into real moments.",
    icon: Users
  }
];

const trustPoints = ["Mutual approval required", "No maps or exact locations", "You control when you're visible"];

const howItWorksSteps = [
  {
    title: "Add your Muddies",
    description: "You both approve before either of you appears nearby.",
    icon: UserPlus
  },
  {
    title: "Choose when you're visible",
    description: "Turn visibility on whenever you want your Muddies to know you're nearby.",
    icon: Eye
  },
  {
    title: "See them glow",
    description: "Nearby Muddies appear as glowing profile cards.",
    icon: Sparkles
  }
];

const useCases = [
  {
    title: "Campus catch-ups",
    description:
      "You’re walking across campus and notice an approved university friend is nearby — enough to say hello, without tracking each other all day.",
    icon: GraduationCap
  },
  {
    title: "Same event, same city",
    description:
      "At a concert or meet-up, Mad Buddy can show when trusted friends from your circle are in the area — no need to share live maps.",
    icon: Music2
  },
  {
    title: "Close friends, on your terms",
    description:
      "Stay loosely aware of people you trust without broadcasting your exact location or checking in constantly.",
    icon: Users
  }
];

const privacyCards = [
  {
    title: "No maps or pins",
    description: "No streets, routes, or map positions.",
    icon: MapPinOff
  },
  {
    title: "No exact distances",
    description: "Friends only see Very close, Nearby, or Around.",
    icon: Radio
  },
  {
    title: "Only approved friends",
    description: "You both approve before either of you appears nearby.",
    icon: ShieldCheck
  },
  {
    title: "You're in control",
    description: "Pause visibility, use Ghost Mode, or delete your data at any time.",
    icon: Lock
  }
];

const featureItems = [
  {
    title: "Nearby signals",
    description: "See clear labels: Very close, Nearby, or Around.",
    icon: Radio
  },
  {
    title: "Nearby alerts",
    description: "Get optional alerts when selected Muddies are nearby.",
    icon: Bell
  },
  {
    title: "Glow styles",
    description: "Personalise your profile without sharing more location detail.",
    icon: Sparkles
  },
  {
    title: "Circles",
    description: "Organise your Muddies into groups that make sense to you.",
    icon: Users
  },
  {
    title: "Ghost Mode",
    description: "Pause visibility whenever you want.",
    icon: Ghost
  },
  {
    title: "Battery-friendly",
    description: "Designed to minimise battery use.",
    icon: Battery
  }
];

export function LandingPage() {
  const [activeSection, setActiveSection] = useLandingActiveSection();

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
        <FeatureRail />
        <HowGlowWorks />
        <UseCasesSection />
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
      id="top"
      className="relative scroll-mt-[4.25rem] overflow-hidden px-4 pb-16 pt-[calc(4.25rem+2rem)] sm:scroll-mt-[4.5rem] sm:px-6 sm:pb-20 sm:pt-[calc(4.5rem+2.5rem)] lg:flex lg:min-h-[680px] lg:items-center lg:pb-24"
    >
      <div
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_20%_20%,rgba(249,115,22,0.16),transparent_42%),radial-gradient(circle_at_80%_30%,rgba(251,146,60,0.12),transparent_40%),radial-gradient(circle_at_50%_90%,rgba(234,88,12,0.14),transparent_45%)]"
        aria-hidden="true"
      />
      <div className="relative mx-auto grid w-full max-w-7xl items-center gap-10 lg:grid-cols-[0.85fr_1.15fr] lg:gap-14">
        <div className="max-w-2xl">
          <h1 className="text-4xl font-semibold leading-[1.08] tracking-tight sm:text-5xl lg:text-[3.25rem]">
            When your Muddies are close,{" "}
            <span className="text-primary">they glow.</span>
          </h1>
          <p className="mt-5 max-w-xl text-base leading-7 text-muted-foreground sm:text-lg">
            A <strong className="font-semibold text-foreground">Muddy</strong> is a friend you both
            approve. Know when your Muddies are nearby&mdash;without maps or exact locations.
          </p>
          <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
            <Button asChild size="lg">
              <Link href="/signup" aria-label="Get started — create a Mad Buddy account">
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
          {/* Trust points live here now, as a compact inline line under the
              CTAs, instead of their own full-width strip below the hero. */}
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
              rather than on a separate backdrop. Lighter on small screens,
              fuller on desktop. */}
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-[-4%] rounded-full bg-orange-500/6 blur-[100px] lg:inset-[-8%] lg:bg-orange-500/9 lg:blur-[150px]"
          />
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-[14%] rounded-full bg-orange-400/10 blur-[60px] lg:inset-[12%] lg:bg-orange-400/15 lg:blur-[95px]"
          />
          {/* A soft, irregular (not circular) orange haze — deliberately
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
              mask) — the phones and glow lines are the only opaque pixels,
              so nothing here can read as a rectangle. A slight contrast/
              saturation lift keeps the devices reading as sharp as the
              surrounding text without touching the source file. Sized up
              and let to sit close to the hero's bottom edge so the feature
              rail overlapping beneath reads as a continuation of the same
              composition rather than a new section. */}
          <Image
            src="/brand/mad-buddy-hero-mockup-v2.png"
            alt="Mad Buddy showing nearby Muddies, plans, and privacy controls"
            width={617}
            height={405}
            priority
            sizes="(max-width: 1024px) 75vw, 42vw"
            className="relative z-10 h-auto w-full max-w-[620px] object-contain [filter:contrast(1.06)_saturate(1.08)]"
          />
        </div>
      </div>
    </section>
  );
}

function FeatureRail() {
  return (
    <div className="relative z-10 px-4 sm:px-6">
      <div className="mx-auto mt-4 max-w-7xl overflow-hidden rounded-2xl border border-border/70 bg-card/90 shadow-[0_24px_70px_hsl(var(--shadow)/0.28)] backdrop-blur-xl sm:-mt-14 lg:-mt-20">
        <div className="grid divide-y divide-border/60 sm:grid-cols-2 sm:divide-x sm:divide-y-0 lg:grid-cols-4">
          {railFeatures.map((feature) => (
            <div key={feature.title} className="flex items-start gap-3 p-[18px] sm:p-5">
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-primary/10 text-primary">
                <feature.icon className="h-4 w-4" aria-hidden="true" />
              </span>
              <div className="min-w-0">
                <h3 className="text-sm font-semibold">{feature.title}</h3>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">{feature.description}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function HowGlowWorks() {
  return (
    <section
      id="how-it-works"
      className="relative scroll-mt-[4.25rem] overflow-hidden px-4 pb-16 pt-14 sm:scroll-mt-[4.5rem] sm:px-6 sm:pb-20 sm:pt-16"
    >
      {/* Echoes the hero's own orange radial glow, faded in from the top, so
          the seam where the feature rail overlaps reads as one continuous
          lighting scheme instead of a new section starting cold. */}
      <div
        className="pointer-events-none absolute inset-x-0 top-0 h-72 bg-[radial-gradient(circle_at_50%_0%,rgba(249,115,22,0.12),transparent_65%)]"
        aria-hidden="true"
      />
      <div className="relative mx-auto max-w-7xl">
        <SectionHeading eyebrow="How it works" title="Simple. Social. Human." align="center" />
        <ol className="mx-auto mt-10 grid max-w-5xl gap-6 sm:grid-cols-3">
          {howItWorksSteps.map((step, index) => (
            <li key={step.title} className="rounded-2xl border border-border/80 bg-card/60 p-5">
              <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-primary/10 text-primary">
                <step.icon className="h-5 w-5" aria-hidden="true" />
              </span>
              <p className="mt-3 text-sm font-semibold" aria-hidden="true">
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

function UseCasesSection() {
  return (
    <section className="border-t border-border/60 bg-secondary/20 px-4 py-12 sm:px-6 sm:py-16">
      <div className="mx-auto max-w-7xl">
        <SectionHeading
          eyebrow="Real-life moments"
          title="Why people use Mad Buddy"
          description="For trusted circles who want to feel nearby — not surveilled."
        />
        <div className="mt-10 grid gap-8 md:grid-cols-3">
          {useCases.map((item) => (
            <article key={item.title}>
              <span className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-card text-primary shadow-[inset_0_0_0_1px_hsl(var(--border))]">
                <item.icon className="h-5 w-5" aria-hidden="true" />
              </span>
              <h3 className="mt-4 text-lg font-semibold">{item.title}</h3>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">{item.description}</p>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

function PrivacySection() {
  return (
    <section
      id="privacy"
      className="scroll-mt-[4.25rem] px-4 py-12 sm:scroll-mt-[4.5rem] sm:px-6 sm:py-16"
    >
      <div className="mx-auto max-w-7xl">
        <SectionHeading eyebrow="Privacy" title="Your privacy. Our priority." align="center" />
        <p className="mx-auto mt-2 max-w-2xl text-center text-sm font-medium text-primary">
          Nearby, without giving away where.
        </p>
        <p className="mx-auto mt-3 max-w-2xl text-center text-base leading-7 text-muted-foreground">
          Only approved friends can see when you&rsquo;re nearby, and no exact location is shared.
        </p>
        <div className="mx-auto mt-10 grid max-w-5xl gap-4 sm:grid-cols-2">
          {privacyCards.map((item) => (
            <div key={item.title} className="rounded-2xl border border-border/80 bg-card/60 p-5">
              <span className="grid h-10 w-10 place-items-center rounded-full bg-primary/10 text-primary">
                <item.icon className="h-5 w-5" aria-hidden="true" />
              </span>
              <h3 className="mt-4 text-base font-semibold">{item.title}</h3>
              <p className="mt-1.5 text-sm leading-6 text-muted-foreground">{item.description}</p>
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
      className="scroll-mt-[4.25rem] border-t border-border/60 bg-secondary/20 px-4 py-12 sm:scroll-mt-[4.5rem] sm:px-6 sm:py-16"
    >
      <div className="mx-auto max-w-7xl">
        <SectionHeading
          eyebrow="Features"
          title="Simple features. Private by design."
          description="The essentials come first. Extras stay optional."
        />
        <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
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
    <section className="px-4 pb-4 pt-4 sm:px-6">
      <div className="mx-auto max-w-7xl overflow-hidden rounded-2xl bg-primary px-6 py-10 sm:px-10 sm:py-12">
        <div className="mx-auto max-w-2xl text-center">
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-primary-foreground/80">
            Ready to glow?
          </p>
          <h2 className="mt-3 text-3xl font-semibold tracking-tight text-primary-foreground sm:text-4xl">
            Start with your first Muddy.
          </h2>
          <p className="mt-4 text-base leading-7 text-primary-foreground/85">
            Create an account, approve a friend, and choose when to glow.
          </p>
          <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row">
            <Button asChild size="lg" className="bg-background text-primary hover:bg-background/90">
              <Link href="/signup">
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
              <Link href="/login">Log in</Link>
            </Button>
          </div>
        </div>
      </div>
    </section>
  );
}

function Footer() {
  return (
    <footer className="px-4 pb-8 pt-12 sm:px-6 sm:pt-16">
      <div className="mx-auto max-w-7xl border-t border-border/70 pt-10">
        <div className="grid gap-10 lg:grid-cols-[1.7fr_0.8fr_0.8fr_0.8fr] lg:gap-12">
          <div className="max-w-sm">
            <Link href="#top" className="inline-flex items-center gap-3" aria-label="Mad Buddy home" title="Mad Buddy home">
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
                <a href="#privacy" className="transition-colors hover:text-foreground">
                  Privacy
                </a>
              </li>
              <li>
                <Link href="/pricing" className="transition-colors hover:text-foreground">
                  Pricing
                </Link>
              </li>
            </ul>
          </nav>

          <nav aria-label="Account">
            <h2 className="text-sm font-semibold text-foreground">Account</h2>
            <ul className="mt-4 flex flex-col gap-3 text-sm text-muted-foreground">
              <li>
                <Link href="/signup" className="transition-colors hover:text-foreground">
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
          <p>© {new Date().getFullYear()} Mad Buddy. All rights reserved.</p>
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
