import Link from "next/link";
import { ArrowRight, Check, Coffee, MessagesSquare, Radio, ShieldCheck } from "lucide-react";

import { PublicPageShell } from "@/components/front-door/public-shell";
import { PricingViewTracker } from "@/components/premium/pricing-view-tracker";

const FREE_CORE = [
  "Home, Profile and Muddies",
  "Glow and proximity with your Muddies",
  "Messages and existing conversations",
  "Plans, Plan Chat and Events",
  "Safe Arrival, Notifications, Circles and Groups"
];

/** Public pricing, inside the current Front Door shell. There is one paid product, not a tier ladder. */
export function PricingPageContent() {
  return (
    <PublicPageShell>
      <PricingViewTracker />
      <div className="mx-auto w-full max-w-6xl px-4 py-14 sm:px-6 sm:py-20">
        <section className="mx-auto max-w-3xl text-center">
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-[#A45A18]">Mad Buddy Access</p>
          <h1 className="mt-4 text-balance text-4xl font-semibold tracking-tight text-[#4E0401] dark:text-[#FFF8F1] sm:text-5xl">
            Your existing social world is free. Expanding it is paid.
          </h1>
          <p className="mx-auto mt-5 max-w-2xl text-pretty text-base leading-7 text-[#4E0401]/65 dark:text-[#D8CCC5] sm:text-lg">
            Mad Buddy stays useful without a subscription. Access is one simple monthly product for Linkr and the stranger-discovery side of UpFor.
          </p>
        </section>

        <section className="mt-10 grid gap-5 lg:grid-cols-[1.05fr_.95fr]" aria-label="Mad Buddy pricing">
          <article className="rounded-[1.75rem] border border-[#4E0401]/10 bg-white/80 p-6 shadow-sm dark:border-white/10 dark:bg-white/[0.04] sm:p-8">
            <div className="flex items-center gap-3">
              <span className="grid h-11 w-11 place-items-center rounded-full bg-[#4E0401]/8 text-[#4E0401] dark:bg-white/10 dark:text-[#FFF8F1]">
                <MessagesSquare className="h-5 w-5" aria-hidden="true" />
              </span>
              <div>
                <p className="text-sm font-medium text-[#4E0401]/55 dark:text-[#C5B6AF]">Mad Buddy Core</p>
                <h2 className="text-2xl font-semibold text-[#4E0401] dark:text-[#FFF8F1]">Free</h2>
              </div>
            </div>
            <p className="mt-5 text-sm leading-6 text-[#4E0401]/65 dark:text-[#D8CCC5]">
              Everything built around people you already know remains available.
            </p>
            <ul className="mt-5 grid gap-3">
              {FREE_CORE.map((item) => (
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
                    GHS 5.00 <span className="text-base font-medium text-white/65">/ month</span>
                  </h2>
                </div>
                <ShieldCheck className="h-7 w-7 text-[#E88C2B]" aria-hidden="true" />
              </div>

              <div className="mt-6 grid gap-4">
                <div className="flex gap-3">
                  <Radio className="mt-0.5 h-5 w-5 shrink-0 text-[#E88C2B]" aria-hidden="true" />
                  <div>
                    <h3 className="font-semibold">Linkr</h3>
                    <p className="mt-1 text-sm leading-6 text-white/70">Discover and connect with people outside your existing social world.</p>
                  </div>
                </div>
                <div className="flex gap-3">
                  <Coffee className="mt-0.5 h-5 w-5 shrink-0 text-[#E88C2B]" aria-hidden="true" />
                  <div>
                    <h3 className="font-semibold">UpFor expansion</h3>
                    <p className="mt-1 text-sm leading-6 text-white/70">
                      Create an UpFor and discover or join people you do not already know. Seeing what your own Muddies are up for remains free.
                    </p>
                  </div>
                </div>
              </div>

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
            Your first 14 days of Access
          </h2>
          <p className="mt-2 text-sm leading-6 text-[#4E0401]/65 dark:text-[#D8CCC5]">
            Welcome Access starts when you add your first Muddy—not when you sign up. No card is required, no payment method is taken, and nothing is automatically charged when it ends.
          </p>
          <p className="mt-3 text-sm leading-6 text-[#4E0401]/65 dark:text-[#D8CCC5]">
            When Welcome Access ends, Linkr and stranger expansion in UpFor lock until you choose Access. Your Muddies, existing Linkr connections, conversations, Plans and Plan Chats stay exactly where they are.
          </p>
        </section>

        <section className="mx-auto mt-8 grid max-w-4xl gap-3 sm:grid-cols-2" aria-label="Access questions">
          {[
            ["Do I need a card for Welcome Access?", "No."],
            ["Will I be charged after 14 days?", "No. There is no automatic renewal."],
            ["Do existing connections expire?", "No. Existing relationships and conversations stay free."],
            ["Can I get Access later?", "Yes. Access is GHS 5.00 per month when you want to expand again."]
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
