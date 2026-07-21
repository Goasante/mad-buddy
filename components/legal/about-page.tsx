import Link from "next/link";
import {
  ArrowRight,
  Bell,
  CalendarCheck2,
  EyeOff,
  Ghost,
  Hand,
  Heart,
  MapPinOff,
  MessageCircle,
  ShieldCheck,
  Sparkles,
  Users
} from "lucide-react";
import { BrandMark } from "@/components/brand/brand-mark";
import { Button } from "@/components/ui/button";

const howItWorks = [
  { title: "Glow", description: "See approved friends nearby through soft proximity signals — never an exact spot.", icon: Sparkles },
  { title: "Wave", description: "Let a Muddy know you’re around and open to connecting.", icon: Hand },
  { title: "Ping", description: "Start a conversation and see if the moment is mutual.", icon: MessageCircle },
  { title: "Plan", description: "Turn a nearby hello into coffee, a walk, or a proper plan.", icon: CalendarCheck2 },
  { title: "Meet", description: "Bring the connection into real life, where it counts.", icon: Users }
];

const differentiators = [
  { title: "Approved friends only", description: "Nobody appears nearby unless you have both approved each other. No open discovery of strangers.", icon: ShieldCheck },
  { title: "No maps, no exact spots", description: "You see “Very close”, “Nearby”, or “Around” — never coordinates, pins, or precise distance.", icon: MapPinOff },
  { title: "Visible when you choose", description: "Your glow is yours to control. Turn it off any time and simply disappear from nearby.", icon: EyeOff }
];

const values = [
  { title: "People over followers", description: "Built for the friends you actually know, not an audience to perform for.", icon: Users },
  { title: "Privacy-first, always", description: "Every feature starts from the question: does this respect the person using it?", icon: ShieldCheck },
  { title: "Real life, encouraged", description: "The best outcome isn’t more time in the app — it’s more time together offline.", icon: Heart }
];

const safety = [
  { title: "Ghost Mode", description: "Pause your visibility instantly whenever you want a quiet moment.", icon: Ghost },
  { title: "Mutual approval", description: "Connections are two-way by design, so nearby is always consensual.", icon: ShieldCheck },
  { title: "Gentle alerts", description: "Optional nudges when chosen friends are around — never noisy, never automatic.", icon: Bell }
];

const faqs = [
  {
    q: "Does Mad Buddy show my exact location?",
    a: "No. Friends only ever see a soft proximity level like “Nearby”. Your exact location is never shared, mapped, or stored as history."
  },
  {
    q: "Can strangers find me?",
    a: "No. You only appear to people you have both approved as Muddies. There is no public discovery of individuals."
  },
  {
    q: "Can I disappear when I want to?",
    a: "Any time. Ghost Mode pauses your glow immediately, and you choose exactly when you’re visible again."
  },
  {
    q: "Is Mad Buddy free?",
    a: "Yes. The free plan includes nearby glow, approved friends, and Ghost Mode. Paid plans simply add more room and extras."
  }
];

export function AboutPage() {
  return (
    <main className="min-h-screen bg-background text-foreground">
      {/* Header */}
      <header className="sticky top-0 z-40 border-b border-border/60 bg-background/85 backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6">
          <Link href="/" className="focus-ring flex items-center gap-3 rounded-lg font-semibold" aria-label="Mad Buddy home">
            <BrandMark className="h-9 w-9" priority />
            <span>Mad Buddy</span>
          </Link>
          <div className="flex items-center gap-2">
            <Button asChild size="sm" variant="ghost" className="hidden sm:inline-flex">
              <Link href="/privacy">Privacy</Link>
            </Button>
            <Button asChild size="sm">
              <Link href="/login">Get started</Link>
            </Button>
          </div>
        </div>
      </header>

      {/* Hero */}
      <section className="relative overflow-clip px-4 pb-16 pt-16 sm:px-6 sm:pt-20">
        <div
          className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_20%_15%,rgba(249,115,22,0.14),transparent_45%),radial-gradient(circle_at_85%_25%,rgba(251,146,60,0.10),transparent_42%)]"
          aria-hidden="true"
        />
        <div className="relative mx-auto max-w-3xl text-center">
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-primary">Our story</p>
          <h1 className="mt-4 text-4xl font-semibold leading-[1.1] tracking-tight sm:text-5xl">
            Built for real friends and <span className="text-primary">real life.</span>
          </h1>
          <p className="mx-auto mt-5 max-w-2xl text-base leading-7 text-muted-foreground sm:text-lg">
            Mad Buddy helps the friends you already have find each other when they’re nearby — and turn
            those small moments into real ones. All of it privacy-first, all of it on your terms.
          </p>
          <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row">
            <Button asChild size="lg">
              <Link href="/login">
                Get started
                <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </Link>
            </Button>
            <Button asChild size="lg" variant="outline">
              <Link href="/#how-it-works">See how it works</Link>
            </Button>
          </div>
        </div>
      </section>

      <div className="mx-auto max-w-5xl space-y-20 px-4 pb-24 sm:px-6">
        {/* What is Mad Buddy + Mission (alternating) */}
        <section className="grid items-center gap-8 md:grid-cols-2">
          <div>
            <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">What is Mad Buddy?</h2>
            <p className="mt-4 text-base leading-7 text-muted-foreground">
              Mad Buddy is a gentle way to know when your approved friends — your Muddies — are close by.
              Instead of maps and exact spots, people simply <span className="font-medium text-foreground">glow</span> when
              they’re nearby. A wave, a quick message, and a spontaneous plan is all it takes to turn a passing
              moment into time together.
            </p>
          </div>
          <div className="rounded-3xl border border-border/70 bg-card/50 p-6 backdrop-blur-sm">
            <span className="grid h-11 w-11 place-items-center rounded-2xl bg-primary/10 text-primary">
              <Sparkles className="h-5 w-5" aria-hidden="true" />
            </span>
            <p className="mt-4 text-lg font-semibold">Our mission</p>
            <p className="mt-2 text-sm leading-7 text-muted-foreground">
              To help people spend less time scrolling and more time together — by making it effortless to
              notice the friends already around you, without ever giving away where you are.
            </p>
          </div>
        </section>

        {/* Why we built it + Privacy first (alternating) */}
        <section className="grid items-center gap-8 md:grid-cols-2">
          <div className="order-2 rounded-3xl border border-emerald-400/25 bg-emerald-400/[0.06] p-6 backdrop-blur-sm md:order-1">
            <span className="grid h-11 w-11 place-items-center rounded-2xl bg-emerald-400/15 text-emerald-300">
              <ShieldCheck className="h-5 w-5" aria-hidden="true" />
            </span>
            <p className="mt-4 text-lg font-semibold">Privacy comes first</p>
            <p className="mt-2 text-sm leading-7 text-muted-foreground">
              We designed Mad Buddy backwards from privacy. Your exact location is never shared, there are no
              maps or pins, and you’re only ever visible to friends you’ve both approved — when you choose to be.
            </p>
          </div>
          <div className="order-1 md:order-2">
            <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">Why we built it</h2>
            <p className="mt-4 text-base leading-7 text-muted-foreground">
              We kept missing each other in the same places — the same café, the same campus, the same part of
              town — and only finding out later. We wanted something that quietly closes that gap for real
              friends, without the discomfort of broadcasting a live location to anyone.
            </p>
          </div>
        </section>

        {/* How Mad Buddy works */}
        <section>
          <div className="text-center">
            <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">How Mad Buddy works</h2>
            <p className="mx-auto mt-3 max-w-2xl text-sm leading-7 text-muted-foreground">
              Five small steps, from a soft glow to a real hello.
            </p>
          </div>
          <ol className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
            {howItWorks.map((step, index) => (
              <li key={step.title} className="rounded-2xl border border-border/70 bg-card/50 p-5">
                <span className="grid h-10 w-10 place-items-center rounded-full bg-primary/10 text-primary">
                  <step.icon className="h-5 w-5" aria-hidden="true" />
                </span>
                <p className="mt-3 text-sm font-semibold">
                  <span className="mr-1.5 text-muted-foreground">{index + 1}.</span>
                  {step.title}
                </p>
                <p className="mt-1 text-xs leading-6 text-muted-foreground">{step.description}</p>
              </li>
            ))}
          </ol>
        </section>

        {/* Why we're different */}
        <section>
          <div className="text-center">
            <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">Why we’re different</h2>
          </div>
          <div className="mt-8 grid gap-4 md:grid-cols-3">
            {differentiators.map((item) => (
              <div key={item.title} className="rounded-2xl border border-border/70 bg-card/50 p-6">
                <span className="grid h-11 w-11 place-items-center rounded-2xl bg-primary/10 text-primary">
                  <item.icon className="h-5 w-5" aria-hidden="true" />
                </span>
                <h3 className="mt-4 text-base font-semibold">{item.title}</h3>
                <p className="mt-1.5 text-sm leading-6 text-muted-foreground">{item.description}</p>
              </div>
            ))}
          </div>
        </section>

        {/* Community values */}
        <section>
          <div className="text-center">
            <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">Community values</h2>
          </div>
          <div className="mt-8 grid gap-4 md:grid-cols-3">
            {values.map((value) => (
              <div key={value.title} className="rounded-2xl border border-border/70 bg-card/50 p-6">
                <span className="grid h-11 w-11 place-items-center rounded-2xl bg-primary/10 text-primary">
                  <value.icon className="h-5 w-5" aria-hidden="true" />
                </span>
                <h3 className="mt-4 text-base font-semibold">{value.title}</h3>
                <p className="mt-1.5 text-sm leading-6 text-muted-foreground">{value.description}</p>
              </div>
            ))}
          </div>
        </section>

        {/* Safety & privacy */}
        <section className="rounded-3xl border border-border/70 bg-card/40 p-6 sm:p-8">
          <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">Safety &amp; privacy</h2>
          <p className="mt-3 max-w-2xl text-sm leading-7 text-muted-foreground">
            Staying in control should be simple, so the safety tools are always one tap away.
          </p>
          <div className="mt-6 grid gap-4 md:grid-cols-3">
            {safety.map((item) => (
              <div key={item.title} className="flex gap-3">
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-primary/10 text-primary">
                  <item.icon className="h-5 w-5" aria-hidden="true" />
                </span>
                <div>
                  <h3 className="text-sm font-semibold">{item.title}</h3>
                  <p className="mt-1 text-xs leading-6 text-muted-foreground">{item.description}</p>
                </div>
              </div>
            ))}
          </div>
          <p className="mt-6 text-sm text-muted-foreground">
            Read the full{" "}
            <Link href="/privacy" className="font-medium text-primary underline-offset-4 hover:underline">
              privacy policy
            </Link>{" "}
            for the details.
          </p>
        </section>

        {/* FAQ */}
        <section>
          <div className="text-center">
            <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">Frequently asked questions</h2>
          </div>
          <div className="mx-auto mt-8 max-w-3xl divide-y divide-border/60 rounded-2xl border border-border/70 bg-card/40">
            {faqs.map((faq) => (
              <details key={faq.q} className="group px-5 py-4">
                <summary className="focus-ring flex cursor-pointer list-none items-center justify-between gap-4 text-sm font-medium">
                  {faq.q}
                  <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-90" aria-hidden="true" />
                </summary>
                <p className="mt-2 text-sm leading-7 text-muted-foreground">{faq.a}</p>
              </details>
            ))}
          </div>
        </section>

        {/* CTA */}
        <section className="relative overflow-hidden rounded-3xl border border-border/70 bg-card/50 p-8 text-center sm:p-12">
          <div
            className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_0%,rgba(249,115,22,0.16),transparent_60%)]"
            aria-hidden="true"
          />
          <div className="relative">
            <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">Ready when your friends are near?</h2>
            <p className="mx-auto mt-3 max-w-xl text-sm leading-7 text-muted-foreground">
              Join Mad Buddy and turn nearby moments into real connections — privately, and on your terms.
            </p>
            <Button asChild size="lg" className="mt-6">
              <Link href="/login">
                Get started
                <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </Link>
            </Button>
          </div>
        </section>
      </div>

      {/* Footer */}
      <footer className="border-t border-border/60 px-4 py-8 sm:px-6">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 text-sm text-muted-foreground sm:flex-row">
          <Link href="/" className="flex items-center gap-2.5 font-semibold text-foreground">
            <BrandMark className="h-7 w-7" />
            Mad Buddy
          </Link>
          <nav className="flex flex-wrap items-center justify-center gap-x-5 gap-y-2" aria-label="Footer">
            <Link href="/#how-it-works" className="hover:text-foreground">How it works</Link>
            <Link href="/privacy" className="hover:text-foreground">Privacy</Link>
            <Link href="/pricing" className="hover:text-foreground">Pricing</Link>
            <Link href="/faq" className="hover:text-foreground">FAQ</Link>
            <Link href="/login" className="hover:text-foreground">Log in</Link>
          </nav>
          <p>&copy; {new Date().getFullYear()} Mad Buddy</p>
        </div>
      </footer>
    </main>
  );
}
