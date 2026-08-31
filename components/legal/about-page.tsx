import Link from "next/link";
import { ArrowRight, CalendarDays, Camera, Hand, MessageCircle, Radio, ShieldCheck, Users } from "lucide-react";
import { PublicPageShell } from "@/components/front-door/public-shell";

const features = [
  {
    title: "Muddies",
    description: "Your mutually approved friends on Mad Buddy, with proximity that follows each person's visibility choices.",
    icon: Users
  },
  {
    title: "Linkr",
    description: "Deliberately enabled discovery for meeting someone new, with privacy-safe approximate proximity and mutual choice before a continuing connection.",
    icon: Radio
  },
  {
    title: "UpFor",
    description: "Share what you are open to doing right now and turn a passing intention into something other people can join.",
    icon: Hand
  },
  {
    title: "Plans & Events",
    description: "Move from intention to an actual time, place, RSVP, and shared experience.",
    icon: CalendarDays
  },
  {
    title: "Messages & Moments",
    description: "Keep conversations and private social sharing attached to the people and plans that matter.",
    icon: MessageCircle
  },
  {
    title: "Safe Arrival",
    description: "A safety-focused arrival experience designed to help chosen people know whether you got there without turning them into live trackers.",
    icon: ShieldCheck
  },
  {
    title: "Profile & media",
    description: "Your profile is the source of your identity and the photos you choose to show across Mad Buddy experiences.",
    icon: Camera
  }
] as const;

const principles = [
  {
    title: "Connection over popularity",
    description: "Mad Buddy is designed around people doing things together, not building an audience around follower counts."
  },
  {
    title: "Approximate by design",
    description: "Proximity should create social awareness without handing another user your exact coordinates, street location, exact numerical distance, live map position, or location history."
  },
  {
    title: "Discovery is deliberate",
    description: "Muddy proximity and Linkr are not the same thing. Linkr discovery starts because you choose to enable it and stops when you stop the session."
  },
  {
    title: "Controls must hold",
    description: "Visibility choices, Ghost Mode, blocking, reporting, and privacy settings are product controls, not decorative preferences."
  }
] as const;

export function AboutPage() {
  return (
    <PublicPageShell>
      <div className="mx-auto w-full max-w-5xl px-4 py-14 sm:px-6 sm:py-20">
        <section className="max-w-3xl">
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-[#A45A18]">About</p>
          <h1 className="mt-3 text-4xl font-semibold tracking-[-0.04em] text-[#4E0401] sm:text-5xl dark:text-[#FFF8F1]">
            Built to get people out of the app and into real life.
          </h1>
          <p className="mt-5 text-base leading-8 text-[#4E0401]/65 dark:text-[#FFF8F1]/65">
            Mad Buddy helps you notice when trusted friends are roughly nearby, deliberately discover new people through Linkr, show what you are up for, and turn that momentum into plans.
          </p>
        </section>

        <section className="mt-14 border-t border-[#4E0401]/10 pt-9 dark:border-white/10" aria-labelledby="what-heading">
          <h2 id="what-heading" className="text-2xl font-semibold tracking-[-0.025em] text-[#4E0401] dark:text-[#FFF8F1]">What lives inside Mad Buddy</h2>
          <div className="mt-7 grid gap-x-9 gap-y-1 sm:grid-cols-2">
            {features.map((feature) => (
              <article key={feature.title} className="border-t border-[#4E0401]/10 py-6 dark:border-white/10">
                <feature.icon className="h-5 w-5 text-[#A45A18]" aria-hidden="true" />
                <h3 className="mt-4 text-lg font-semibold text-[#4E0401] dark:text-[#FFF8F1]">{feature.title}</h3>
                <p className="mt-2 text-sm leading-7 text-[#4E0401]/62 dark:text-[#FFF8F1]/62">{feature.description}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="mt-12 border-t border-[#4E0401]/10 pt-9 dark:border-white/10" aria-labelledby="principles-heading">
          <h2 id="principles-heading" className="text-2xl font-semibold tracking-[-0.025em] text-[#4E0401] dark:text-[#FFF8F1]">The product principles</h2>
          <dl className="mt-7 grid gap-x-10 gap-y-8 sm:grid-cols-2">
            {principles.map((principle) => (
              <div key={principle.title}>
                <dt className="text-base font-semibold text-[#4E0401] dark:text-[#FFF8F1]">{principle.title}</dt>
                <dd className="mt-2 text-sm leading-7 text-[#4E0401]/62 dark:text-[#FFF8F1]/62">{principle.description}</dd>
              </div>
            ))}
          </dl>
        </section>

        <section className="mt-12 border-t border-[#4E0401]/10 pt-9 dark:border-white/10" aria-labelledby="trust-heading">
          <h2 id="trust-heading" className="text-2xl font-semibold tracking-[-0.025em] text-[#4E0401] dark:text-[#FFF8F1]">Trust is part of the product surface</h2>
          <p className="mt-3 max-w-2xl text-sm leading-7 text-[#4E0401]/62 dark:text-[#FFF8F1]/62">
            Safety, privacy, legal terms, support, and account recovery should not feel like detached utility pages. They are part of the same promise as the Landing itself.
          </p>
          <nav className="mt-6 grid gap-2 sm:grid-cols-2 lg:grid-cols-4" aria-label="About related pages">
            {([
              { href: "/safety", label: "Safety" },
              { href: "/privacy", label: "Privacy" },
              { href: "/support", label: "Support" },
              { href: "/faq", label: "FAQ" }
            ] as const).map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="focus-ring flex min-h-11 items-center justify-between rounded-xl border border-[#4E0401]/10 px-4 text-sm font-semibold text-[#4E0401] hover:bg-[#E88C2B]/10 dark:border-white/10 dark:text-[#FFF8F1] dark:hover:bg-white/[0.05]"
              >
                {item.label}
                <ArrowRight className="h-4 w-4 text-[#A45A18]" aria-hidden="true" />
              </Link>
            ))}
          </nav>
        </section>
      </div>
    </PublicPageShell>
  );
}
