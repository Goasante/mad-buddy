import Link from "next/link";
import { ArrowRight, Check, MessagesSquare, ShieldCheck } from "lucide-react";

import { PublicPageShell } from "@/components/front-door/public-shell";
import { PricingViewTracker } from "@/components/premium/pricing-view-tracker";

const FREE_APP = [
  "Home, Profile and Muddies",
  "Glow and privacy-safe proximity",
  "Linkr discovery and connections",
  "UpFor, Plans, Plan Chat and Events",
  "Messages, Safe Arrival, Notifications, Circles and Groups"
];

const ACCESS_BENEFITS = [
  "No inline ads",
  "No full-screen ads when those formats are enabled",
  "The same Mad Buddy features, without advertising interruptions"
];

/** Public pricing. Mad Buddy is free with ads; Access is the one ad-free product. */
export function PricingPageContent() {
  return (
    <PublicPageShell>
      <PricingViewTracker />
      <div className="mx-auto w-full max-w-6xl px-4 py-14 sm:px-6 sm:py-20">
        <section className="mx-auto max-w-3xl text-center">
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-[#A45A18]">Simple pricing</p>
          <h1 className="mt-4 text-balance text-4xl font-semibold tracking-tight text-[#4E0401] dark:text-[#FFF8F1] sm:text-5xl">
            Mad Buddy is free to use. Access removes the ads.
          </h1>
          <p className="mx-auto mt-5 max-w-2xl text-pretty text-base leading-7 text-[#4E0401]/65 dark:text-[#D8CCC5] sm:text-lg">
            Linkr, UpFor, Muddies, Messages, Plans, Events and the rest of the core app stay available without a subscription. Free accounts may see light advertising; Mad Buddy Access gives you the same experience without ads.
          </p>
        </section>

        <section className="mt-10 grid gap-5 lg:grid-cols-[1.05fr_.95fr]" aria-label="Mad Buddy pricing">
          <article className="rounded-[1.75rem] border border-[#4E0401]/10 bg-white/80 p-6 shadow-sm dark:border-white/10 dark:bg-white/[0.04] sm:p-8">
            <div className="flex items-center gap-3">
              <span className="grid h-11 w-11 place-items-center rounded-full bg-[#4E0401]/8 text-[#4E0401] dark:bg-white/10 dark:text-[#FFF8F1]">
                <MessagesSquare className="h-5 w-5" aria-hidden="true" />
              </span>
              <div>
                <p className="text-sm font-medium text-[#4E0401]/55 dark:text-[#C5B6AF]">Mad Buddy</p>
                <h2 className="text-2xl font-semibold text-[#4E0401] dark:text-[#FFF8F1]">Free</h2>
              </div>
            </div>
            <p className="mt-5 text-sm leading-6 text-[#4E0401]/65 dark:text-[#D8CCC5]">
              Use the full social experience. Light, non-intrusive ads help support the free app.
            </p>
            <ul className="mt-5 grid gap-3">
              {FREE_APP.map((item) => (
                <li key={item} className="flex gap-3 text-sm leading-6 text-[#4E0401]/80 dark:text-[#E9E0DA]">
                  <Check className="mt-1 h-4 w-4 shrink-0 text-[#A45A18]" aria-hidden="true" />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </article>

          <article className="relative overflow-hidden rounded-[1.75rem] border border-[#E88C2B]/35 bg-[#4E0401] p-6 text-white shadow-xl shadow-[#4E0401]/10 sm:p-8">
            <div className="absolute -right-14 -top-14 h-40 w-40 rounded-full bg-[#E88C2B]/25 blur-2xl" aria-hidden="true" />
            <div className="relative">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-sm font-medium text-white/70">Mad Buddy Access</p>
                  <h2 className="mt-1 text-3xl font-semibold">
                    GHS 4.99 <span className="text-base font-medium text-white/65">/ month</span>
                  </h2>
                </div>
                <ShieldCheck className="h-7 w-7 text-[#E88C2B]" aria-hidden="true" />
              </div>

              <p className="mt-5 text-sm leading-6 text-white/70">
                Mad Buddy without ads. Access does not unlock a separate set of social features; it removes advertising from your experience.
              </p>

              <ul className="mt-6 grid gap-3">
                {ACCESS_BENEFITS.map((item) => (
                  <li key={item} className="flex gap-3 text-sm leading-6 text-white/85">
                    <Check className="mt-1 h-4 w-4 shrink-0 text-[#E88C2B]" aria-hidden="true" />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>

              <Link
                href="/signup"
                className="focus-ring mt-7 inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-[#E88C2B] px-5 text-sm font-semibold text-[#2b1713] transition hover:brightness-105"
              >
                Get started <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </Link>
            </div>
          </article>
        </section>

        <section
          className="mx-auto mt-8 max-w-4xl rounded-[1.5rem] border border-[#E88C2B]/20 bg-[#E88C2B]/[0.06] p-5 sm:p-6"
          aria-labelledby="welcome-access-title"
        >
          <h2 id="welcome-access-title" className="text-lg font-semibold text-[#4E0401] dark:text-[#FFF8F1]">
            Your first 14 days are ad-free
          </h2>
          <p className="mt-2 text-sm leading-6 text-[#4E0401]/65 dark:text-[#D8CCC5]">
            Welcome Access starts when you add your first Muddy—not when you sign up. No card is required, no payment method is taken, and nothing is automatically charged when it ends.
          </p>
          <p className="mt-3 text-sm leading-6 text-[#4E0401]/65 dark:text-[#D8CCC5]">
            When Welcome Access ends, Mad Buddy keeps working normally. Your features, connections and conversations stay available; the account simply becomes eligible for ads unless you choose Access.
          </p>
        </section>

        <section className="mx-auto mt-8 grid max-w-4xl gap-3 sm:grid-cols-2" aria-label="Access questions">
          {[
            ["Do I need a card for Welcome Access?", "No."],
            ["Will I be charged after 14 days?", "No. There is no automatic renewal."],
            ["Do Linkr or UpFor require Access?", "No. Core Mad Buddy features remain available on the free app."],
            ["Can I remove ads later?", "Yes. Mad Buddy Access is GHS 4.99 per month for the ad-free experience."]
          ].map(([question, answer]) => (
            <article key={question} className="rounded-2xl border border-[#4E0401]/10 bg-white/70 p-4 dark:border-white/10 dark:bg-white/[0.04]">
              <h3 className="text-sm font-semibold text-[#4E0401] dark:text-[#FFF8F1]">{question}</h3>
              <p className="mt-1 text-sm leading-6 text-[#4E0401]/65 dark:text-[#D8CCC5]">{answer}</p>
            </article>
          ))}
        </section>
      </div>
    </PublicPageShell>
  );
}