"use client";

import Image from "next/image";
import Link from "next/link";
import {
  ArrowRight,
  BadgeCheck,
  Bell,
  CalendarCheck2,
  Check,
  Eye,
  EyeOff,
  Ghost,
  GraduationCap,
  Hand,
  Heart,
  Lock,
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

const quadFeatures = [
  {
    title: "See Who's Around",
    description: "Discover Muddies nearby with broad, privacy-safe proximity — never a map or exact distance.",
    icon: Radio
  },
  {
    title: "Wave & Connect",
    description: "Send a Wave to say you're open to connect. When it's mutual, the chat opens.",
    icon: Hand
  },
  {
    title: "Make Plans",
    description: "Create plans, invite Muddies, and keep RSVPs organized in one place.",
    icon: CalendarCheck2
  },
  {
    title: "Meet in Real Life",
    description: "Turn digital connection into real memories, on your terms.",
    icon: Users
  }
];

const howItWorksSteps = [
  {
    title: "Glow",
    description: "See Muddies around you with broad, privacy-first proximity.",
    icon: Sparkles
  },
  {
    title: "Wave",
    description: "Send a Wave to say you're open to connect.",
    icon: Hand
  },
  {
    title: "Ping",
    description: "Chat and vibe. See if you're on the same page.",
    icon: MessageCircle
  },
  {
    title: "Plan",
    description: "Create a plan and invite the right people.",
    icon: CalendarCheck2
  },
  {
    title: "Meet",
    description: "Show up, have fun, and build real friendships.",
    icon: Users
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

const friendsMaySee = [
  "A privacy-safe proximity level (Very close, Nearby, or Around you)",
  "Your chosen profile name and image",
  "Whether you have chosen to be visible"
];

const friendsNeverSee = [
  "Exact coordinates",
  "A map pin",
  "Street address",
  "Direction of travel",
  "Exact distance"
];

const safetyItems = [
  {
    title: "Privacy Controls",
    description: "You decide what you share and with whom.",
    icon: Lock
  },
  {
    title: "Ghost Mode",
    description: "Browse and connect without revealing yourself.",
    icon: Ghost
  },
  {
    title: "Block & Report",
    description: "Easily block or report anyone who breaks the rules.",
    icon: ShieldAlert
  },
  {
    title: "Verified Community",
    description: "Real people, real profiles, and real accountability.",
    icon: BadgeCheck
  }
];

const primaryFeatures = [
  {
    title: "Privacy-safe proximity",
    description:
      "Friends see simple glow levels — Very close, Nearby, Around you, or no active signal — never a map or exact distance.",
    icon: MapPinOff
  },
  {
    title: "Mutual approval",
    description: "Only Muddies you have both approved can appear in each other’s nearby list.",
    icon: ShieldCheck
  },
  {
    title: "You control visibility",
    description: "Pause your glow, switch on Ghost Mode, or adjust alerts whenever you want.",
    icon: Lock
  }
];

const secondaryFeatures = [
  { title: "Optional nearby alerts", icon: Bell },
  { title: "Muddy circles", icon: Heart },
  { title: "Custom glow colours", icon: Sparkles },
  { title: "Ghost Mode", icon: Ghost },
  { title: "Web now, mobile next", icon: Radio }
];

const faqItems = [
  {
    question: "What is a Muddy?",
    answer:
      "A Muddy is a friend you have mutually approved on Mad Buddy. You both need to accept before either of you can appear nearby."
  },
  {
    question: "Can friends see my exact location?",
    answer:
      "No. Friends see privacy-safe proximity levels and your profile — not coordinates, maps, street addresses, direction of travel, or exact distance."
  },
  {
    question: "Do both people have to approve?",
    answer: "Yes. Mad Buddy requires mutual approval before anyone appears in a nearby list."
  },
  {
    question: "What's the difference between a Wave and a Plan?",
    answer:
      "A Wave is a quick signal that you're open to connect — when it's mutual, a chat opens. A Plan is a real event you create and invite Muddies to, with simple RSVPs."
  },
  {
    question: "Can I stop appearing nearby?",
    answer:
      "Yes. Pause your visibility from the dashboard or turn on Ghost Mode in settings whenever you want more privacy."
  },
  {
    question: "What does Ghost Mode do?",
    answer:
      "Ghost Mode pauses your visibility. Approved friends will not see your glow while it is on. You can turn it off again at any time."
  },
  {
    question: "Does Mad Buddy show a map?",
    answer: "No. Mad Buddy uses glowing profile cards and proximity levels — there is no map view."
  },
  {
    question: "Can I delete my data?",
    answer:
      "Yes. You can delete your account from settings, which removes your profile and associated data. Production deletion behaviour should be verified against your live deployment."
  },
  {
    question: "Is Mad Buddy free?",
    answer:
      "Yes. Mad Buddy has a free plan with nearby glow, up to 25 approved friends, and Ghost Mode. Paid plans add more friends and extras — see Pricing for details."
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
        <TrustStrip />
        <QuadFeatureSection />
        <HowGlowWorks />
        <UseCasesSection />
        <SafetySection />
        <FeatureSection />
        <FaqSection />
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
      className="relative scroll-mt-[4.25rem] overflow-hidden px-4 pb-10 pt-[calc(4.25rem+2rem)] sm:scroll-mt-[4.5rem] sm:px-6 sm:pb-12 sm:pt-[calc(4.5rem+2.5rem)] lg:pb-14"
    >
      <div
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_20%_20%,rgba(249,115,22,0.16),transparent_42%),radial-gradient(circle_at_80%_30%,rgba(251,146,60,0.12),transparent_40%),radial-gradient(circle_at_50%_90%,rgba(234,88,12,0.1),transparent_35%)]"
        aria-hidden="true"
      />
      <div className="relative mx-auto grid max-w-7xl items-center gap-10 lg:grid-cols-[0.85fr_1.15fr] lg:gap-14">
        <div className="max-w-2xl">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-primary/30 bg-primary/10 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-primary">
            <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
            Private. Social. Nearby.
          </span>
          <h1 className="mt-4 text-4xl font-semibold leading-[1.08] tracking-tight sm:text-5xl lg:text-[3.25rem]">
            When your Muddies are close,{" "}
            <span className="text-primary">they glow.</span>
          </h1>
          <p className="mt-5 max-w-xl text-base leading-7 text-muted-foreground sm:text-lg">
            A <strong className="font-semibold text-foreground">Muddy</strong> is a friend you both
            approve. See who&rsquo;s nearby, connect, and make plans&mdash;without sharing exact
            locations.
          </p>
          <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
            <Button asChild size="lg">
              <Link href="/signup">
                Get started
                <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </Link>
            </Button>
            <Button asChild variant="outline" size="lg">
              <a href="#how-it-works">See how it works</a>
            </Button>
          </div>
        </div>
        <div className="relative flex w-full items-center justify-center">
          {/* Ambient glow behind the mockup: a wide soft haze plus a tighter
              warm core centred on the middle phone, echoing the hero's own
              radial atmosphere so the devices sit in the same pool of light
              rather than on a separate backdrop. Lighter on small screens,
              fuller on desktop. */}
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-[-2%] rounded-full bg-orange-500/5 blur-[90px] lg:inset-[-6%] lg:bg-orange-500/8 lg:blur-[140px]"
          />
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-[16%] rounded-full bg-orange-400/10 blur-[55px] lg:inset-[14%] lg:bg-orange-400/14 lg:blur-[85px]"
          />
          {/* A soft, irregular (not circular) orange haze — deliberately
              blob-shaped rather than a perfect ring so it reads as ambient
              light, not a radar/tracking signal. */}
          <div
            aria-hidden="true"
            className="pointer-events-none absolute left-1/2 top-1/2 h-[65%] w-[65%] -translate-x-1/2 -translate-y-1/2 rounded-[62%_38%_55%_45%/45%_60%_40%_55%] bg-orange-500/10 blur-[60px] lg:blur-[90px]"
          />
          {/* A soft grounding shadow so the phones read as standing in the
              scene instead of floating with nothing beneath them. */}
          <div
            aria-hidden="true"
            className="pointer-events-none absolute bottom-[4%] left-1/2 h-10 w-[50%] -translate-x-1/2 rounded-[100%] bg-black/25 blur-xl lg:bottom-[6%] lg:h-16 lg:w-[55%] lg:bg-black/40 lg:blur-2xl"
          />
          {/* This asset has its background removed (true alpha, not a CSS
              mask) — the phones and glow lines are the only opaque pixels,
              so nothing here can read as a rectangle. A slight contrast/
              saturation lift keeps the devices reading as sharp as the
              surrounding text without touching the source file. */}
          <Image
            src="/brand/mad-buddy-hero-mockup-v2.png"
            alt="Mad Buddy app showing nearby Muddies, plans, and privacy controls"
            width={617}
            height={405}
            priority
            sizes="(max-width: 1024px) 65vw, 36vw"
            className="relative z-10 h-auto w-full max-w-[520px] object-contain [filter:contrast(1.06)_saturate(1.08)]"
          />
        </div>
      </div>
    </section>
  );
}

function TrustStrip() {
  return (
    <section aria-label="Trust highlights" className="border-t border-border/60 px-4 py-3 sm:px-6">
      <ul className="mx-auto flex max-w-7xl flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:justify-center sm:gap-x-8 sm:gap-y-2">
        {[
          "Mutual approval required",
          "No maps or exact locations",
          "You control when you’re visible"
        ].map((item) => (
          <li key={item} className="inline-flex items-center gap-2 text-sm text-muted-foreground">
            <Check className="h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function QuadFeatureSection() {
  return (
    <section aria-label="What you can do on Mad Buddy" className="px-4 py-14 sm:px-6 sm:py-16">
      <div className="mx-auto grid max-w-6xl gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {quadFeatures.map((feature) => (
          <div
            key={feature.title}
            className="rounded-2xl border border-border/80 bg-card/60 p-5 shadow-[0_12px_30px_hsl(var(--shadow)/0.06)]"
          >
            <span className="grid h-10 w-10 place-items-center rounded-full bg-primary/10 text-primary">
              <feature.icon className="h-5 w-5" aria-hidden="true" />
            </span>
            <h3 className="mt-4 text-base font-semibold">{feature.title}</h3>
            <p className="mt-1.5 text-sm leading-6 text-muted-foreground">{feature.description}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

function HowGlowWorks() {
  return (
    <section
      id="how-it-works"
      className="scroll-mt-[4.25rem] border-t border-border/60 px-4 py-16 sm:scroll-mt-[4.5rem] sm:px-6 sm:py-20"
    >
      <div className="mx-auto max-w-6xl">
        <SectionHeading
          eyebrow="How it works"
          title="Simple. Social. Human."
          description="Mad Buddy is built around approved friends and simple proximity signals — not live location tracking."
          align="center"
        />
        <ol className="mt-10 grid gap-8 sm:grid-cols-2 lg:grid-cols-5 lg:gap-6">
          {howItWorksSteps.map((step, index) => (
            <li key={step.title} className="relative lg:px-1">
              <div className="flex items-center gap-3">
                <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-primary/10 text-primary">
                  <step.icon className="h-5 w-5" aria-hidden="true" />
                </span>
                <span className="text-sm font-semibold text-muted-foreground" aria-hidden="true">
                  {index + 1}. {step.title}
                </span>
              </div>
              <p className="mt-3 text-sm leading-6 text-muted-foreground">{step.description}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

function UseCasesSection() {
  return (
    <section className="border-t border-border/60 bg-secondary/20 px-4 py-16 sm:px-6 sm:py-20">
      <div className="mx-auto max-w-6xl">
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

function SafetySection() {
  return (
    <section
      id="safety"
      className="scroll-mt-[4.25rem] px-4 py-16 sm:scroll-mt-[4.5rem] sm:px-6 sm:py-20"
    >
      <div className="mx-auto max-w-6xl">
        <SectionHeading
          eyebrow="Safety first"
          title="Your safety. Our priority."
          description="Mad Buddy is designed to keep you safe while you connect and meet — nearby, without giving away where."
          align="center"
        />
        <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {safetyItems.map((item) => (
            <div key={item.title} className="rounded-2xl border border-border/80 bg-card/60 p-5">
              <span className="grid h-10 w-10 place-items-center rounded-full bg-primary/10 text-primary">
                <item.icon className="h-5 w-5" aria-hidden="true" />
              </span>
              <h3 className="mt-4 text-base font-semibold">{item.title}</h3>
              <p className="mt-1.5 text-sm leading-6 text-muted-foreground">{item.description}</p>
            </div>
          ))}
        </div>
        <div className="mt-10 grid gap-8 lg:grid-cols-2">
          <PrivacyColumn title="What friends may see" tone="may" items={friendsMaySee} />
          <PrivacyColumn title="What friends never see" tone="never" items={friendsNeverSee} />
        </div>
        <p className="mt-6 text-sm text-muted-foreground">
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

function PrivacyColumn({
  title,
  tone,
  items
}: {
  title: string;
  tone: "may" | "never";
  items: string[];
}) {
  const Icon = tone === "may" ? Eye : EyeOff;

  return (
    <div className="rounded-2xl border border-border/80 bg-card/60 p-6">
      <div className="flex items-center gap-3">
        <span
          className={cn(
            "grid h-10 w-10 place-items-center rounded-full",
            tone === "may" ? "bg-emerald-400/12 text-emerald-700 dark:text-emerald-100" : "bg-red-400/10 text-red-700 dark:text-red-200"
          )}
        >
          <Icon className="h-5 w-5" aria-hidden="true" />
        </span>
        <h3 className="text-lg font-semibold">{title}</h3>
      </div>
      <ul className="mt-5 space-y-3">
        {items.map((item) => (
          <li key={item} className="flex gap-3 text-sm leading-6 text-muted-foreground">
            {tone === "may" ? (
              <Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
            ) : (
              <X className="mt-0.5 h-4 w-4 shrink-0 text-red-600 dark:text-red-300" aria-hidden="true" />
            )}
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function FeatureSection() {
  return (
    <section
      id="features"
      className="scroll-mt-[4.25rem] border-t border-border/60 bg-secondary/20 px-4 py-16 sm:scroll-mt-[4.5rem] sm:px-6 sm:py-20"
    >
      <div className="mx-auto max-w-6xl">
        <SectionHeading
          eyebrow="Features"
          title="Built for trust, not tracking"
          description="The essentials come first. Extras stay optional."
        />
        <div className="mt-10 grid gap-6 md:grid-cols-3">
          {primaryFeatures.map((feature) => (
            <article
              key={feature.title}
              className="rounded-2xl border border-border/80 bg-card p-6 shadow-[0_16px_40px_hsl(var(--shadow)/0.06)]"
            >
              <span className="grid h-10 w-10 place-items-center rounded-full bg-primary/10 text-primary">
                <feature.icon className="h-5 w-5" aria-hidden="true" />
              </span>
              <h3 className="mt-4 text-lg font-semibold">{feature.title}</h3>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">{feature.description}</p>
            </article>
          ))}
        </div>
        <div className="mt-8 flex flex-wrap gap-3">
          {secondaryFeatures.map((feature) => (
            <span
              key={feature.title}
              className="inline-flex items-center gap-2 rounded-full border border-border/80 bg-background/80 px-3 py-2 text-sm text-muted-foreground"
            >
              <feature.icon className="h-4 w-4 text-primary" aria-hidden="true" />
              {feature.title}
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}

function FaqSection() {
  return (
    <section id="faq" className="scroll-mt-[4.25rem] px-4 py-16 sm:scroll-mt-[4.5rem] sm:px-6 sm:py-20">
      <div className="mx-auto max-w-3xl">
        <SectionHeading eyebrow="FAQ" title="Common questions" align="center" />
        <dl className="mt-10 space-y-3">
          {faqItems.map((item) => (
            <div key={item.question} className="rounded-xl border border-border/70 bg-card/50 px-5 py-4">
              <dt className="text-base font-semibold">{item.question}</dt>
              <dd className="mt-2 text-sm leading-6 text-muted-foreground">{item.answer}</dd>
            </div>
          ))}
        </dl>
      </div>
    </section>
  );
}

function FinalCta() {
  return (
    <section className="px-4 pb-4 pt-4 sm:px-6">
      <div className="mx-auto max-w-6xl overflow-hidden rounded-2xl bg-primary px-6 py-10 sm:px-10 sm:py-12">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="text-3xl font-semibold tracking-tight text-primary-foreground sm:text-4xl">
            Your people are around. Go find them.
          </h2>
          <p className="mt-4 text-base leading-7 text-primary-foreground/85">
            Create a free account, approve a friend, and see the glow when you are nearby — on your
            terms.
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
              <a href="#how-it-works">See how it works</a>
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
      <div className="mx-auto max-w-6xl border-t border-border/70 pt-10">
        <div className="grid gap-10 lg:grid-cols-[1.7fr_0.8fr_0.8fr_0.8fr] lg:gap-12">
          <div className="max-w-sm">
            <Link href="#top" className="inline-flex items-center gap-3" aria-label="Mad Buddy home">
              <BrandMark className="h-9 w-9" />
              <span className="text-base font-semibold text-foreground">Mad Buddy</span>
            </Link>
            <p className="mt-4 text-sm leading-6 text-muted-foreground">
              When your Muddies are close, they glow — without sharing exact locations.
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
                <a href="#features" className="transition-colors hover:text-foreground">
                  Features
                </a>
              </li>
              <li>
                <a href="#safety" className="transition-colors hover:text-foreground">
                  Safety
                </a>
              </li>
              <li>
                <a href="#faq" className="transition-colors hover:text-foreground">
                  FAQ
                </a>
              </li>
            </ul>
          </nav>

          <nav aria-label="Account">
            <h2 className="text-sm font-semibold text-foreground">Account</h2>
            <ul className="mt-4 flex flex-col gap-3 text-sm text-muted-foreground">
              <li>
                <Link href="/signup" className="transition-colors hover:text-foreground">
                  Create free account
                </Link>
              </li>
              <li>
                <Link href="/login" className="transition-colors hover:text-foreground">
                  Log in
                </Link>
              </li>
              <li>
                <Link href="/pricing" className="transition-colors hover:text-foreground">
                  Premium
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
          <p>Private proximity for approved friends.</p>
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
