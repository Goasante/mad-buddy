import Image from "next/image";
import Link from "next/link";
import {
  ArrowRight,
  CalendarCheck2,
  CalendarDays,
  Check,
  Coffee,
  Eye,
  EyeOff,
  Ghost,
  Hand,
  MessageCircle,
  MessagesSquare,
  Radio,
  RadioTower,
  ShieldCheck,
  UsersRound,
  X
} from "lucide-react";
import { LandingNav } from "@/components/landing/landing-nav";

const trustPoints = [
  "Rough proximity, never a map",
  "Visibility stays on your terms",
  "Muddies require mutual approval"
];

const flowSteps = [
  {
    title: "Notice",
    product: "Glow",
    description: "A Muddy becomes more present as they get closer, without exposing an exact distance.",
    icon: RadioTower
  },
  {
    title: "Signal",
    product: "Wave or Ping",
    description: "Show you are open to a hello, or ask whether meeting up sounds good.",
    icon: Hand
  },
  {
    title: "Make it real",
    product: "Plan",
    description: "Turn the moment into an actual commitment instead of another chat that goes nowhere.",
    icon: CalendarCheck2
  }
];

const connectionModes = [
  {
    label: "Muddies",
    title: "People you already trust.",
    description:
      "A Muddy is a friendship both people approve. Once connected, Glow can give you a rough sense that they are around — never a map, pin or exact distance.",
    icon: UsersRound,
    points: ["Mutual approval first", "Privacy-safe proximity", "Ghost Mode whenever you want out"]
  },
  {
    label: "Linkr",
    title: "People you might want to know.",
    description:
      "Switch on a Linkr session when you want to discover someone new. You choose when discovery is active, and a real connection still requires mutual choice.",
    icon: Radio,
    points: ["You choose when discovery is on", "No exact-location reveal", "Connection happens only by mutual choice"]
  }
];

const privacyCanKnow = [
  "That someone you trust is roughly nearby",
  "Whether they have chosen to be visible",
  "Whether they are open to doing something"
];

const privacyNeverGet = [
  "Exact GPS coordinates",
  "A live map or map pin",
  "Street names or addresses",
  "Exact numerical distance",
  "Direction of travel",
  "Location history"
];

const supportingFeatures = [
  {
    title: "Events",
    detail: "Shared experiences people can discover or attend together.",
    icon: CalendarDays
  },
  {
    title: "Circles",
    detail: "Organise the Muddies who belong together.",
    icon: UsersRound
  },
  {
    title: "Messaging",
    detail: "Keep the conversation attached to the people and plans that matter.",
    icon: MessagesSquare
  },
  {
    title: "Safe Arrival",
    detail: "A safety-focused arrival experience without turning friends into trackers.",
    icon: ShieldCheck
  }
];

export function LandingPage() {
  return (
    <div className="min-h-screen bg-[#FEFBF3] text-[#311712] selection:bg-[#E88C2B]/25 selection:text-[#4E0401] dark:bg-[#100807] dark:text-[#FFF8F1]">
      <a
        href="#main-content"
        className="focus-ring sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[100] focus:rounded-xl focus:bg-[#FEFBF3] focus:px-4 focus:py-2 focus:text-[#4E0401] focus:shadow-lg dark:focus:bg-[#1B0E0B] dark:focus:text-[#FFF8F1]"
      >
        Skip to content
      </a>
      <LandingNav />
      <main id="main-content">
        <Hero />
        <FeelingSection />
        <ConnectionSection />
        <MomentumSection />
        <PrivacySection />
        <FinalCta />
      </main>
      <Footer />
    </div>
  );
}

function Hero() {
  return (
    <section
      id="hero"
      className="relative isolate overflow-hidden px-4 pb-16 pt-[calc(env(safe-area-inset-top,0px)+6.75rem)] sm:px-6 sm:pb-20 sm:pt-[calc(env(safe-area-inset-top,0px)+7.5rem)] lg:min-h-[760px] lg:px-10 lg:pb-24"
    >
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[680px] bg-[radial-gradient(circle_at_18%_14%,rgba(232,140,43,0.20),transparent_38%),radial-gradient(circle_at_82%_24%,rgba(78,4,1,0.10),transparent_34%)] dark:bg-[radial-gradient(circle_at_18%_14%,rgba(232,140,43,0.16),transparent_38%),radial-gradient(circle_at_82%_24%,rgba(232,140,43,0.08),transparent_34%)]"
      />
      <div aria-hidden="true" className="pointer-events-none absolute -left-20 top-28 -z-10 h-64 w-64 rounded-full border border-[#E88C2B]/10" />
      <div aria-hidden="true" className="pointer-events-none absolute -right-24 top-40 -z-10 h-80 w-80 rounded-full border border-[#4E0401]/8 dark:border-white/[0.05]" />

      <div className="mx-auto grid w-full max-w-7xl items-center gap-12 lg:grid-cols-[0.86fr_1.14fr] lg:gap-16">
        <div className="max-w-2xl">
          <p className="inline-flex min-h-9 items-center gap-2 rounded-full border border-[#E88C2B]/25 bg-[#E88C2B]/[0.08] px-3.5 text-xs font-bold uppercase tracking-[0.14em] text-[#8E4B12] dark:text-[#F0AE68]">
            <ShieldCheck className="h-4 w-4" aria-hidden="true" /> Privacy-first proximity
          </p>
          <h1 className="mt-5 max-w-2xl text-[2.7rem] font-semibold leading-[1.01] tracking-[-0.045em] text-[#4E0401] sm:text-6xl sm:leading-[0.98] lg:text-[4.4rem] dark:text-[#FFF8F1]">
            When your Muddies are close, <span className="text-[#E88C2B]">they glow.</span>
          </h1>
          <p className="mt-6 max-w-xl text-base leading-7 text-[#4E0401]/68 sm:text-lg sm:leading-8 dark:text-[#FFF8F1]/68">
            Know when the right people are around. Turn a quick wave into coffee, a plan, or something spontaneous — without broadcasting exactly where you are.
          </p>

          <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
            <Link
              href="/login"
              className="focus-ring inline-flex min-h-12 items-center justify-center gap-2 rounded-full bg-[#4E0401] px-6 text-sm font-bold text-white shadow-[0_14px_35px_rgba(78,4,1,0.18)] transition-[transform,box-shadow] hover:-translate-y-0.5 hover:shadow-[0_18px_42px_rgba(78,4,1,0.24)] active:translate-y-0 dark:bg-[#E88C2B] dark:text-[#2B120A]"
            >
              Get started <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </Link>
            <a
              href="#how-it-works"
              className="focus-ring inline-flex min-h-12 items-center justify-center rounded-full border border-[#4E0401]/14 bg-white/55 px-6 text-sm font-bold text-[#4E0401] transition-colors hover:bg-white/85 dark:border-white/14 dark:bg-white/[0.04] dark:text-[#FFF8F1] dark:hover:bg-white/[0.08]"
            >
              See how it works
            </a>
          </div>

          <ul className="mt-7 grid gap-2.5 text-sm text-[#4E0401]/62 sm:grid-cols-3 sm:gap-3 dark:text-[#FFF8F1]/60">
            {trustPoints.map((point) => (
              <li key={point} className="flex items-start gap-2">
                <Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-650 dark:text-emerald-400" aria-hidden="true" />
                <span>{point}</span>
              </li>
            ))}
          </ul>
        </div>

        <div className="relative mx-auto w-full max-w-[680px] lg:max-w-none">
          <div aria-hidden="true" className="pointer-events-none absolute left-1/2 top-1/2 h-[78%] w-[76%] -translate-x-1/2 -translate-y-1/2 rounded-[48%] bg-[#E88C2B]/14 blur-3xl motion-safe:animate-pulse dark:bg-[#E88C2B]/10" />
          <div aria-hidden="true" className="pointer-events-none absolute bottom-[4%] left-1/2 h-12 w-[58%] -translate-x-1/2 rounded-[100%] bg-[#4E0401]/16 blur-2xl dark:bg-black/45" />
          <Image
            src="/brand/mad-buddy-hero-mockup-v2.png"
            alt="Mad Buddy product screens showing privacy-safe proximity and social planning"
            width={617}
            height={405}
            priority
            quality={82}
            sizes="(max-width: 639px) 92vw, (max-width: 1023px) 74vw, 46vw"
            className="relative z-10 h-auto w-full object-contain [filter:contrast(1.035)_saturate(1.04)]"
          />

          <div className="absolute -left-1 top-[10%] z-20 hidden max-w-[180px] rounded-2xl border border-[#4E0401]/10 bg-[#FEFBF3]/94 p-3 shadow-[0_18px_50px_rgba(78,4,1,0.12)] backdrop-blur sm:block lg:-left-4 dark:border-white/10 dark:bg-[#1A0D0A]/92">
            <div className="flex items-center gap-2">
              <span className="grid h-9 w-9 place-items-center rounded-full bg-[#E88C2B]/14 text-[#A45A18]"><RadioTower className="h-4 w-4" aria-hidden="true" /></span>
              <div><p className="text-xs font-bold text-[#4E0401] dark:text-[#FFF8F1]">Ama is around</p><p className="mt-0.5 text-[10px] text-[#4E0401]/55 dark:text-[#FFF8F1]/55">Enough to say hello. Not enough to track.</p></div>
            </div>
          </div>

          <div className="absolute -bottom-3 right-0 z-20 hidden max-w-[190px] rounded-2xl border border-[#4E0401]/10 bg-[#4E0401] p-3.5 text-white shadow-[0_20px_55px_rgba(78,4,1,0.25)] sm:block lg:right-3 dark:bg-[#F7E9DE] dark:text-[#3B1711]">
            <p className="text-[10px] font-bold uppercase tracking-[0.13em] text-[#F2B16F] dark:text-[#A45A18]">UpFor now</p>
            <p className="mt-1 text-sm font-bold">Coffee after class?</p>
            <p className="mt-1 text-[11px] text-white/68 dark:text-[#3B1711]/62">A quick intention can become a real plan.</p>
          </div>
        </div>
      </div>
    </section>
  );
}

function FeelingSection() {
  return (
    <section id="how-it-works" className="scroll-mt-24 border-y border-[#4E0401]/7 bg-[#4E0401]/[0.025] px-4 py-20 sm:px-6 sm:py-24 lg:px-10 lg:py-28 dark:border-white/[0.06] dark:bg-white/[0.018]">
      <div className="mx-auto grid w-full max-w-7xl items-center gap-12 lg:grid-cols-[1.04fr_0.96fr] lg:gap-16">
        <div>
          <SectionHeading
            eyebrow="The feeling"
            title="Not a map. A sense that someone is around."
            description="Mad Buddy turns proximity into a softer social signal. People feel more present as they get closer, while the geography stays private."
          />

          <ol className="mt-9 grid gap-3">
            {flowSteps.map((step, index) => (
              <li key={step.product} className="group flex gap-4 rounded-2xl border border-[#4E0401]/9 bg-[#FEFBF3]/72 p-4 transition-[transform,border-color,background-color] hover:-translate-y-0.5 hover:border-[#E88C2B]/35 hover:bg-white/75 dark:border-white/[0.08] dark:bg-white/[0.025] dark:hover:bg-white/[0.045]">
                <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-[#E88C2B]/12 text-[#A45A18]">
                  <step.icon className="h-5 w-5" aria-hidden="true" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="text-[10px] font-bold uppercase tracking-[0.16em] text-[#4E0401]/46 dark:text-[#FFF8F1]/45">0{index + 1} · {step.title}</span>
                    <span className="text-sm font-bold text-[#E88C2B]">{step.product}</span>
                  </div>
                  <p className="mt-1.5 text-sm leading-6 text-[#4E0401]/64 dark:text-[#FFF8F1]/62">{step.description}</p>
                </div>
              </li>
            ))}
          </ol>
        </div>

        <div className="relative mx-auto w-full max-w-[520px] rounded-[2rem] border border-[#4E0401]/10 bg-[#FEFBF3] p-5 shadow-[0_28px_80px_rgba(78,4,1,0.10)] sm:p-7 dark:border-white/10 dark:bg-[#180C09]">
          <div className="mb-7 flex items-center justify-between gap-4">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-[#A45A18]">Around you</p>
              <h3 className="mt-1 text-xl font-bold tracking-[-0.02em] text-[#4E0401] dark:text-[#FFF8F1]">Your friends become more present.</h3>
            </div>
            <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-[#E88C2B]/12 text-[#A45A18]"><RadioTower className="h-5 w-5" aria-hidden="true" /></span>
          </div>

          <div className="relative min-h-[300px] overflow-hidden rounded-[1.5rem] border border-[#4E0401]/8 bg-[radial-gradient(circle_at_50%_45%,rgba(232,140,43,0.13),transparent_23%),radial-gradient(circle_at_50%_45%,transparent_0,transparent_29%,rgba(232,140,43,0.10)_30%,transparent_31%),radial-gradient(circle_at_50%_45%,transparent_0,transparent_47%,rgba(232,140,43,0.07)_48%,transparent_49%)] dark:border-white/[0.07] dark:bg-[radial-gradient(circle_at_50%_45%,rgba(232,140,43,0.12),transparent_23%),radial-gradient(circle_at_50%_45%,transparent_0,transparent_29%,rgba(232,140,43,0.10)_30%,transparent_31%),radial-gradient(circle_at_50%_45%,transparent_0,transparent_47%,rgba(232,140,43,0.07)_48%,transparent_49%)]">
            <MuddyAvatar initials="AM" name="Ama" className="left-[42%] top-[33%]" intensity="strong" />
            <MuddyAvatar initials="KB" name="Kojo" className="left-[13%] top-[17%]" intensity="medium" />
            <MuddyAvatar initials="NA" name="Nana" className="bottom-[14%] right-[13%]" intensity="soft" />
            <div className="absolute bottom-4 left-4 right-4 rounded-2xl border border-[#4E0401]/8 bg-[#FEFBF3]/92 p-3.5 backdrop-blur dark:border-white/10 dark:bg-[#1C0E0B]/92">
              <p className="text-sm font-bold text-[#4E0401] dark:text-[#FFF8F1]">You know enough to act.</p>
              <p className="mt-1 text-xs leading-5 text-[#4E0401]/58 dark:text-[#FFF8F1]/56">No coordinates. No route. No “147 metres away.” Just a privacy-safe cue that a real-world moment might be possible.</p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function ConnectionSection() {
  return (
    <section id="connect" className="scroll-mt-24 px-4 py-20 sm:px-6 sm:py-24 lg:px-10 lg:py-28">
      <div className="mx-auto w-full max-w-7xl">
        <SectionHeading
          eyebrow="Two ways to connect"
          title="Your people. And the people you choose to discover."
          description="Mad Buddy separates trusted friendship from deliberate discovery, so the social context is always clear."
          align="center"
        />

        <div className="mx-auto mt-10 grid max-w-5xl gap-4 lg:grid-cols-2">
          {connectionModes.map((mode, index) => (
            <article key={mode.label} className={`relative overflow-hidden rounded-[1.75rem] border p-6 sm:p-7 ${index === 0 ? "border-[#E88C2B]/24 bg-[#E88C2B]/[0.055]" : "border-[#4E0401]/12 bg-white/48 dark:border-white/10 dark:bg-white/[0.03]"}`}>
              <div aria-hidden="true" className={`pointer-events-none absolute -right-16 -top-16 h-44 w-44 rounded-full border ${index === 0 ? "border-[#E88C2B]/15" : "border-[#4E0401]/8 dark:border-white/[0.05]"}`} />
              <div className="relative flex items-start gap-4">
                <span className={`grid h-12 w-12 shrink-0 place-items-center rounded-2xl ${index === 0 ? "bg-[#E88C2B] text-[#2A120A]" : "bg-[#4E0401] text-white dark:bg-[#F4E4D8] dark:text-[#3A1610]"}`}>
                  <mode.icon className="h-6 w-6" aria-hidden="true" />
                </span>
                <div>
                  <p className="text-xs font-bold uppercase tracking-[0.16em] text-[#A45A18]">{mode.label}</p>
                  <h3 className="mt-1.5 text-2xl font-bold tracking-[-0.025em] text-[#4E0401] dark:text-[#FFF8F1]">{mode.title}</h3>
                </div>
              </div>
              <p className="relative mt-5 text-sm leading-6 text-[#4E0401]/66 dark:text-[#FFF8F1]/62">{mode.description}</p>
              <ul className="relative mt-5 grid gap-2.5">
                {mode.points.map((point) => (
                  <li key={point} className="flex items-center gap-2.5 text-sm font-semibold text-[#4E0401]/76 dark:text-[#FFF8F1]/72">
                    <Check className="h-4 w-4 shrink-0 text-emerald-650 dark:text-emerald-400" aria-hidden="true" /> {point}
                  </li>
                ))}
              </ul>
            </article>
          ))}
        </div>

        <p className="mx-auto mt-6 max-w-2xl text-center text-sm leading-6 text-[#4E0401]/55 dark:text-[#FFF8F1]/52">
          Different social contexts. The same privacy standard: Mad Buddy gives people enough context to decide whether to connect, not enough detail to follow one another around.
        </p>
      </div>
    </section>
  );
}

function MomentumSection() {
  return (
    <section className="border-y border-[#4E0401]/7 bg-[#4E0401]/[0.025] px-4 py-20 sm:px-6 sm:py-24 lg:px-10 lg:py-28 dark:border-white/[0.06] dark:bg-white/[0.018]">
      <div className="mx-auto w-full max-w-7xl">
        <div className="grid items-end gap-6 lg:grid-cols-[0.82fr_1.18fr]">
          <SectionHeading
            eyebrow="From maybe to actually meeting"
            title="Proximity is only useful if something happens next."
            description="UpFor captures the moment. Plans make it real. Everything around them helps the right people coordinate without turning Mad Buddy into another endless feed."
          />
          <div className="flex flex-wrap gap-2 lg:justify-end" aria-label="Typical connection flow">
            {[
              ["Glow", RadioTower],
              ["Wave", Hand],
              ["UpFor", Coffee],
              ["Plan", CalendarCheck2]
            ].map(([label, Icon]) => (
              <span key={String(label)} className="inline-flex min-h-10 items-center gap-2 rounded-full border border-[#4E0401]/10 bg-[#FEFBF3]/80 px-3.5 text-xs font-bold text-[#4E0401]/72 dark:border-white/10 dark:bg-white/[0.03] dark:text-[#FFF8F1]/70">
                <Icon className="h-4 w-4 text-[#E88C2B]" aria-hidden="true" /> {label}
              </span>
            ))}
          </div>
        </div>

        <div className="mt-10 grid gap-4 lg:grid-cols-2">
          <article className="rounded-[1.75rem] border border-[#E88C2B]/24 bg-[#FEFBF3] p-5 shadow-[0_20px_60px_rgba(78,4,1,0.07)] sm:p-7 dark:bg-[#180C09]">
            <div className="flex items-center justify-between gap-4">
              <div><p className="text-[10px] font-bold uppercase tracking-[0.18em] text-[#A45A18]">UpFor · right now</p><h3 className="mt-1 text-xl font-bold text-[#4E0401] dark:text-[#FFF8F1]">What are you open to?</h3></div>
              <span className="grid h-11 w-11 place-items-center rounded-2xl bg-[#E88C2B]/14 text-[#A45A18]"><Coffee className="h-5 w-5" aria-hidden="true" /></span>
            </div>
            <div className="mt-6 flex flex-wrap gap-2">
              {[
                ["Coffee", "45 min"],
                ["Gym", "Tonight"],
                ["Food", "Now"],
                ["Walk", "1 hour"]
              ].map(([activity, time], index) => (
                <span key={activity} className={`rounded-2xl border px-4 py-3 ${index === 0 ? "border-[#E88C2B] bg-[#E88C2B]/10" : "border-[#4E0401]/10 bg-white/55 dark:border-white/10 dark:bg-white/[0.03]"}`}>
                  <span className="block text-sm font-bold text-[#4E0401] dark:text-[#FFF8F1]">{activity}</span>
                  <span className="mt-0.5 block text-[11px] text-[#4E0401]/48 dark:text-[#FFF8F1]/46">{time}</span>
                </span>
              ))}
            </div>
            <p className="mt-5 text-sm leading-6 text-[#4E0401]/62 dark:text-[#FFF8F1]/60">Temporary intent, with an audience and an expiry. It says “I could do something” without pretending it is already a commitment.</p>
          </article>

          <article className="rounded-[1.75rem] bg-[#4E0401] p-5 text-white shadow-[0_24px_70px_rgba(78,4,1,0.18)] sm:p-7 dark:bg-[#F2E3D7] dark:text-[#3A1610]">
            <div className="flex items-center justify-between gap-4">
              <div><p className="text-[10px] font-bold uppercase tracking-[0.18em] text-[#F2B16F] dark:text-[#A45A18]">Plan · committed</p><h3 className="mt-1 text-xl font-bold">Coffee after class</h3></div>
              <span className="grid h-11 w-11 place-items-center rounded-2xl bg-white/10 text-[#F2B16F] dark:bg-[#4E0401]/8 dark:text-[#8E4B12]"><CalendarCheck2 className="h-5 w-5" aria-hidden="true" /></span>
            </div>
            <div className="mt-6 grid gap-3 sm:grid-cols-2">
              <PlanDetail label="When" value="Today · 5:30 PM" />
              <PlanDetail label="Who" value="4 Muddies going" />
              <PlanDetail label="Chat" value="Ready with the plan" />
              <PlanDetail label="Next" value="Meet, then mark it done" />
            </div>
            <p className="mt-5 text-sm leading-6 text-white/68 dark:text-[#3A1610]/62">A Plan becomes the shared commitment — with the people, context, and conversation needed to actually show up.</p>
          </article>
        </div>

        <div className="mt-5 grid gap-px overflow-hidden rounded-[1.5rem] border border-[#4E0401]/9 bg-[#4E0401]/9 sm:grid-cols-2 lg:grid-cols-4 dark:border-white/[0.08] dark:bg-white/[0.08]">
          {supportingFeatures.map((feature) => (
            <div key={feature.title} className="bg-[#FEFBF3] p-4 dark:bg-[#140B09] sm:p-5">
              <feature.icon className="h-5 w-5 text-[#E88C2B]" aria-hidden="true" />
              <h3 className="mt-3 text-sm font-bold text-[#4E0401] dark:text-[#FFF8F1]">{feature.title}</h3>
              <p className="mt-1.5 text-xs leading-5 text-[#4E0401]/56 dark:text-[#FFF8F1]/54">{feature.detail}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function PrivacySection() {
  return (
    <section id="privacy" className="scroll-mt-24 px-4 py-20 sm:px-6 sm:py-24 lg:px-10 lg:py-28">
      <div className="mx-auto w-full max-w-7xl">
        <div className="mx-auto max-w-4xl text-center">
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-[#A45A18]">Privacy is the product</p>
          <h2 className="mt-3 text-4xl font-semibold leading-[1.05] tracking-[-0.035em] text-[#4E0401] sm:text-5xl dark:text-[#FFF8F1]">Know enough to meet. Never enough to track.</h2>
          <p className="mx-auto mt-5 max-w-2xl text-base leading-7 text-[#4E0401]/64 dark:text-[#FFF8F1]/60">Mad Buddy deliberately withholds the pieces that turn social awareness into surveillance.</p>
        </div>

        <div className="mx-auto mt-10 grid max-w-5xl gap-4 lg:grid-cols-2">
          <article className="rounded-[1.75rem] border border-emerald-700/12 bg-emerald-700/[0.035] p-5 sm:p-7 dark:border-emerald-400/15 dark:bg-emerald-400/[0.035]">
            <div className="flex items-center gap-3">
              <span className="grid h-11 w-11 place-items-center rounded-2xl bg-emerald-600/10 text-emerald-700 dark:text-emerald-400"><Eye className="h-5 w-5" aria-hidden="true" /></span>
              <div><p className="text-[10px] font-bold uppercase tracking-[0.17em] text-emerald-700 dark:text-emerald-400">You can know</p><h3 className="mt-0.5 text-xl font-bold text-[#4E0401] dark:text-[#FFF8F1]">Enough context to decide.</h3></div>
            </div>
            <ul className="mt-6 grid gap-3">
              {privacyCanKnow.map((item) => (
                <li key={item} className="flex gap-3 text-sm leading-6 text-[#4E0401]/68 dark:text-[#FFF8F1]/64"><Check className="mt-1 h-4 w-4 shrink-0 text-emerald-650 dark:text-emerald-400" aria-hidden="true" /><span>{item}</span></li>
              ))}
            </ul>
          </article>

          <article className="rounded-[1.75rem] border border-[#4E0401]/10 bg-[#4E0401]/[0.025] p-5 sm:p-7 dark:border-white/[0.08] dark:bg-white/[0.02]">
            <div className="flex items-center gap-3">
              <span className="grid h-11 w-11 place-items-center rounded-2xl bg-[#4E0401]/7 text-[#4E0401] dark:bg-white/[0.07] dark:text-[#FFF8F1]"><EyeOff className="h-5 w-5" aria-hidden="true" /></span>
              <div><p className="text-[10px] font-bold uppercase tracking-[0.17em] text-[#4E0401]/52 dark:text-[#FFF8F1]/48">You never get</p><h3 className="mt-0.5 text-xl font-bold text-[#4E0401] dark:text-[#FFF8F1]">The pieces needed to follow someone.</h3></div>
            </div>
            <ul className="mt-6 grid gap-3 sm:grid-cols-2">
              {privacyNeverGet.map((item) => (
                <li key={item} className="flex gap-3 text-sm leading-6 text-[#4E0401]/66 dark:text-[#FFF8F1]/62"><X className="mt-1 h-4 w-4 shrink-0 text-[#B24637] dark:text-[#F28B7C]" aria-hidden="true" /><span>{item}</span></li>
              ))}
            </ul>
          </article>
        </div>

        <div className="mx-auto mt-4 flex max-w-5xl flex-col gap-4 rounded-[1.5rem] border border-[#E88C2B]/22 bg-[#E88C2B]/[0.06] p-5 sm:flex-row sm:items-center sm:justify-between sm:p-6">
          <div className="flex items-start gap-3">
            <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-[#E88C2B]/14 text-[#A45A18]"><Ghost className="h-5 w-5" aria-hidden="true" /></span>
            <div><h3 className="text-sm font-bold text-[#4E0401] dark:text-[#FFF8F1]">Need to disappear? Ghost Mode.</h3><p className="mt-1 text-sm leading-6 text-[#4E0401]/60 dark:text-[#FFF8F1]/58">Pause proximity visibility when you want privacy. Control should be immediate and understandable.</p></div>
          </div>
          <Link href="/privacy" className="focus-ring inline-flex min-h-11 shrink-0 items-center justify-center rounded-full border border-[#E88C2B]/28 bg-[#FEFBF3]/75 px-5 text-sm font-bold text-[#8E4B12] hover:bg-white dark:bg-white/[0.04] dark:text-[#F0AE68] dark:hover:bg-white/[0.07]">Read how privacy works</Link>
        </div>
      </div>
    </section>
  );
}

function FinalCta() {
  return (
    <section id="get-started" className="px-4 pb-20 pt-4 sm:px-6 sm:pb-24 lg:px-10 lg:pb-28">
      <div className="relative mx-auto max-w-7xl overflow-hidden rounded-[2rem] bg-[#4E0401] px-5 py-12 text-white shadow-[0_28px_80px_rgba(78,4,1,0.18)] sm:px-10 sm:py-16 lg:px-14 dark:bg-[#E8D6C9] dark:text-[#3A1610]">
        <div aria-hidden="true" className="pointer-events-none absolute -right-20 -top-28 h-72 w-72 rounded-full border border-white/12 dark:border-[#4E0401]/8" />
        <div aria-hidden="true" className="pointer-events-none absolute -bottom-28 left-[14%] h-64 w-64 rounded-full bg-[#E88C2B]/18 blur-3xl" />
        <div className="relative mx-auto max-w-3xl text-center">
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-[#F2B16F] dark:text-[#955115]">Real life is the point</p>
          <h2 className="mt-3 text-3xl font-semibold leading-tight tracking-[-0.03em] sm:text-5xl">The next hangout could already be around you.</h2>
          <p className="mx-auto mt-4 max-w-2xl text-base leading-7 text-white/70 dark:text-[#3A1610]/62">Add the people you trust. Choose when to be visible. See what becomes possible when digital friendship has a way back into the real world.</p>
          <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row">
            <Link href="/login" className="focus-ring inline-flex min-h-12 items-center justify-center gap-2 rounded-full bg-[#E88C2B] px-6 text-sm font-bold text-[#2B120A] shadow-sm transition-transform hover:-translate-y-0.5 active:translate-y-0">Get started <ArrowRight className="h-4 w-4" aria-hidden="true" /></Link>
            <Link href="/about" className="focus-ring inline-flex min-h-12 items-center justify-center rounded-full border border-white/18 bg-white/[0.05] px-6 text-sm font-bold text-white hover:bg-white/[0.09] dark:border-[#4E0401]/12 dark:bg-white/32 dark:text-[#3A1610] dark:hover:bg-white/50">Learn about Mad Buddy</Link>
          </div>
        </div>
      </div>
    </section>
  );
}

function Footer() {
  return (
    <footer className="border-t border-[#4E0401]/8 px-4 py-10 sm:px-6 lg:px-10 dark:border-white/[0.07]">
      <div className="mx-auto grid w-full max-w-7xl gap-8 sm:grid-cols-[1.35fr_1fr] sm:items-end">
        <div>
          <Link href="#hero" className="focus-ring inline-flex min-h-11 items-center rounded-lg text-base font-bold tracking-[-0.02em] text-[#4E0401] dark:text-[#FFF8F1]">Mad Buddy<span className="text-[#E88C2B]">.</span></Link>
          <p className="mt-2 max-w-sm text-sm leading-6 text-[#4E0401]/55 dark:text-[#FFF8F1]/52">When your friends are close, they glow.</p>
        </div>
        <nav className="flex flex-wrap gap-x-5 gap-y-3 text-sm font-semibold text-[#4E0401]/58 sm:justify-end dark:text-[#FFF8F1]/55" aria-label="Footer navigation">
          <Link href="/about" className="focus-ring rounded-md hover:text-[#4E0401] dark:hover:text-[#FFF8F1]">About</Link>
          <Link href="/faq" className="focus-ring rounded-md hover:text-[#4E0401] dark:hover:text-[#FFF8F1]">FAQ</Link>
          <Link href="/pricing" className="focus-ring rounded-md hover:text-[#4E0401] dark:hover:text-[#FFF8F1]">Pricing</Link>
          <Link href="/privacy" className="focus-ring rounded-md hover:text-[#4E0401] dark:hover:text-[#FFF8F1]">Privacy</Link>
          <Link href="/terms" className="focus-ring rounded-md hover:text-[#4E0401] dark:hover:text-[#FFF8F1]">Terms</Link>
          <Link href="/login" className="focus-ring rounded-md text-[#A45A18] hover:text-[#7E3C08] dark:text-[#F0AE68]">Log in</Link>
        </nav>
      </div>
      <div className="mx-auto mt-8 flex w-full max-w-7xl flex-col gap-2 border-t border-[#4E0401]/7 pt-5 text-xs text-[#4E0401]/42 sm:flex-row sm:items-center sm:justify-between dark:border-white/[0.06] dark:text-[#FFF8F1]/38">
        <p>&copy; {new Date().getFullYear()} Mad Buddy. All rights reserved.</p>
        <p>Privacy-safe proximity for real-world connection.</p>
      </div>
    </footer>
  );
}

function SectionHeading({ eyebrow, title, description, align = "left" }: { eyebrow: string; title: string; description: string; align?: "left" | "center" }) {
  return (
    <div className={align === "center" ? "mx-auto max-w-3xl text-center" : "max-w-3xl"}>
      <p className="text-xs font-bold uppercase tracking-[0.18em] text-[#A45A18]">{eyebrow}</p>
      <h2 className="mt-3 text-3xl font-semibold leading-[1.08] tracking-[-0.03em] text-[#4E0401] sm:text-4xl lg:text-[2.8rem] dark:text-[#FFF8F1]">{title}</h2>
      <p className="mt-4 max-w-2xl text-base leading-7 text-[#4E0401]/62 dark:text-[#FFF8F1]/58">{description}</p>
    </div>
  );
}

function MuddyAvatar({ initials, name, className, intensity }: { initials: string; name: string; className: string; intensity: "strong" | "medium" | "soft" }) {
  const glow = intensity === "strong" ? "shadow-[0_0_0_9px_rgba(232,140,43,0.14),0_0_32px_rgba(232,140,43,0.34)]" : intensity === "medium" ? "shadow-[0_0_0_7px_rgba(232,140,43,0.10),0_0_24px_rgba(232,140,43,0.22)]" : "shadow-[0_0_0_5px_rgba(232,140,43,0.07),0_0_18px_rgba(232,140,43,0.14)]";
  return (
    <div className={`absolute ${className} -translate-x-1/2 -translate-y-1/2 text-center`}>
      <span className={`grid h-14 w-14 place-items-center rounded-full border-2 border-[#FEFBF3] bg-[#4E0401] text-sm font-bold text-white ${glow} dark:border-[#180C09] dark:bg-[#E8D6C9] dark:text-[#3A1610]`}>{initials}</span>
      <span className="mt-2 inline-block rounded-full bg-[#FEFBF3]/90 px-2 py-1 text-[10px] font-bold text-[#4E0401] shadow-sm dark:bg-[#180C09]/90 dark:text-[#FFF8F1]">{name}</span>
    </div>
  );
}

function PlanDetail({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.055] p-3.5 dark:border-[#4E0401]/10 dark:bg-white/38">
      <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-white/45 dark:text-[#3A1610]/45">{label}</p>
      <p className="mt-1 text-sm font-bold">{value}</p>
    </div>
  );
}
