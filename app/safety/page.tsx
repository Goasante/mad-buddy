import type { Metadata } from "next";
import Link from "next/link";
import { Ban, CheckCircle2, Radio, ShieldCheck, UserRoundCheck } from "lucide-react";
import { PublicPageShell } from "@/components/front-door/public-shell";

export const metadata: Metadata = {
  title: "Safety",
  description: "How Mad Buddy approaches proximity, discovery, blocking, reporting, and Safe Arrival without exposing exact location.",
  alternates: { canonical: "/safety" },
  openGraph: {
    title: "Safety | Mad Buddy",
    description: "How Mad Buddy approaches proximity, discovery, blocking, reporting, and Safe Arrival without exposing exact location.",
    url: "/safety"
  }
};

const neverShown = [
  "Exact GPS coordinates",
  "Street address or street-level location",
  "Exact numerical distance",
  "A live map position",
  "Location history"
] as const;

export default function SafetyPage() {
  return (
    <PublicPageShell>
      <div className="mx-auto w-full max-w-4xl px-4 py-14 sm:px-6 sm:py-20">
        <p className="text-xs font-bold uppercase tracking-[0.18em] text-[#A45A18]">Safety</p>
        <h1 className="mt-3 max-w-3xl text-4xl font-semibold tracking-[-0.04em] text-[#4E0401] sm:text-5xl dark:text-[#FFF8F1]">
          Proximity should help people connect, not help people track each other.
        </h1>
        <p className="mt-5 max-w-2xl text-base leading-8 text-[#4E0401]/65 dark:text-[#FFF8F1]/65">
          Mad Buddy is designed around approximate social signals, deliberate discovery, mutual choices, and controls that let you leave an interaction.
        </p>

        <section className="mt-14 grid gap-8 border-t border-[#4E0401]/10 pt-9 md:grid-cols-2 dark:border-white/10">
          <div>
            <UserRoundCheck className="h-6 w-6 text-[#A45A18]" aria-hidden="true" />
            <h2 className="mt-4 text-xl font-semibold text-[#4E0401] dark:text-[#FFF8F1]">Muddy proximity</h2>
            <p className="mt-3 text-sm leading-7 text-[#4E0401]/62 dark:text-[#FFF8F1]/62">
              Muddies are people who have mutually approved the connection. When visibility is enabled, approved Muddies may receive privacy-preserving proximity information according to each person&apos;s settings.
            </p>
          </div>
          <div>
            <Radio className="h-6 w-6 text-[#A45A18]" aria-hidden="true" />
            <h2 className="mt-4 text-xl font-semibold text-[#4E0401] dark:text-[#FFF8F1]">Linkr discovery</h2>
            <p className="mt-3 text-sm leading-7 text-[#4E0401]/62 dark:text-[#FFF8F1]/62">
              Linkr is different: you deliberately switch it on when you want to discover someone new. While it is active, eligible people who are not yet Muddies may receive a privacy-safe approximate proximity signal as part of discovery. A real connection still requires mutual choice.
            </p>
          </div>
        </section>

        <section className="mt-12 border-t border-[#4E0401]/10 pt-9 dark:border-white/10">
          <div className="flex items-center gap-3">
            <ShieldCheck className="h-6 w-6 text-[#A45A18]" aria-hidden="true" />
            <h2 className="text-xl font-semibold text-[#4E0401] dark:text-[#FFF8F1]">What Mad Buddy intentionally does not reveal</h2>
          </div>
          <ul className="mt-6 grid gap-3 sm:grid-cols-2">
            {neverShown.map((item) => (
              <li key={item} className="flex gap-3 text-sm leading-6 text-[#4E0401]/65 dark:text-[#FFF8F1]/65">
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-[#A45A18]" aria-hidden="true" />
                {item}
              </li>
            ))}
          </ul>
        </section>

        <section className="mt-12 grid gap-8 border-t border-[#4E0401]/10 pt-9 md:grid-cols-2 dark:border-white/10">
          <div>
            <Ban className="h-6 w-6 text-[#A45A18]" aria-hidden="true" />
            <h2 className="mt-4 text-xl font-semibold text-[#4E0401] dark:text-[#FFF8F1]">Blocking and reporting</h2>
            <p className="mt-3 text-sm leading-7 text-[#4E0401]/62 dark:text-[#FFF8F1]/62">
              Mad Buddy includes controls to block and report people. Blocking is intended to remove the relationship and interaction paths between the people involved. Reporting gives the product a way to review behaviour that may break its rules.
            </p>
          </div>
          <div>
            <ShieldCheck className="h-6 w-6 text-[#A45A18]" aria-hidden="true" />
            <h2 className="mt-4 text-xl font-semibold text-[#4E0401] dark:text-[#FFF8F1]">Safe Arrival</h2>
            <p className="mt-3 text-sm leading-7 text-[#4E0401]/62 dark:text-[#FFF8F1]/62">
              Safe Arrival is a safety-focused check-in experience. Its purpose is to help chosen people know whether you arrived, not to provide them with a live tracking screen or exact route history.
            </p>
          </div>
        </section>

        <section className="mt-12 border-t border-[#4E0401]/10 pt-9 dark:border-white/10">
          <h2 className="text-xl font-semibold text-[#4E0401] dark:text-[#FFF8F1]">Controls matter more than promises</h2>
          <p className="mt-3 max-w-2xl text-sm leading-7 text-[#4E0401]/62 dark:text-[#FFF8F1]/62">
            Visibility, Ghost Mode, Linkr session controls, blocking, reporting, privacy settings, and account deletion are part of the safety model. The Privacy Policy explains how location and account data are handled in more detail.
          </p>
          <div className="mt-5 flex flex-wrap gap-3">
            <Link href="/privacy" className="focus-ring inline-flex min-h-11 items-center rounded-full bg-[#4E0401] px-5 text-sm font-semibold text-white dark:bg-[#E88C2B] dark:text-[#2A120A]">
              Read Privacy Policy
            </Link>
            <Link href="/support" className="focus-ring inline-flex min-h-11 items-center rounded-full border border-[#4E0401]/15 px-5 text-sm font-semibold text-[#4E0401] dark:border-white/15 dark:text-[#FFF8F1]">
              Get support
            </Link>
          </div>
        </section>
      </div>
    </PublicPageShell>
  );
}
