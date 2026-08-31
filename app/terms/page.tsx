import Link from "next/link";
import type { Metadata } from "next";
import { PublicPageShell } from "@/components/front-door/public-shell";
import { TERMS_EFFECTIVE_DATE, termsSections as sections } from "@/content/terms";

export const metadata: Metadata = {
  title: "Terms of Service",
  description: "Mad Buddy terms and conditions.",
  alternates: { canonical: "/terms" },
  openGraph: {
    title: "Terms of Service | Mad Buddy",
    description: "Mad Buddy terms and conditions.",
    url: "/terms"
  }
};

export default function TermsPage() {
  return (
    <PublicPageShell>
      <div className="mx-auto w-full max-w-3xl px-4 py-14 sm:px-6 sm:py-20">
        <p className="text-xs font-bold uppercase tracking-[0.18em] text-[#A45A18]">Legal · Terms</p>
        <h1 className="mt-3 text-4xl font-semibold tracking-[-0.04em] text-[#4E0401] sm:text-5xl dark:text-[#FFF8F1]">
          Terms and Conditions
        </h1>
        <p className="mt-4 text-sm text-[#4E0401]/50 dark:text-[#FFF8F1]/50">Effective date: {TERMS_EFFECTIVE_DATE}</p>

        <div className="mt-9 border-t border-[#4E0401]/10 pt-8 text-[0.96rem] leading-7 text-[#4E0401]/64 dark:border-white/10 dark:text-[#FFF8F1]/64">
          <p>
            Welcome to Mad Buddy. These Terms and Conditions (&ldquo;Terms&rdquo;) govern your access to and use of the Mad Buddy application, website, and related services (collectively, the &ldquo;Service&rdquo;).
          </p>
          <p className="mt-4">
            By creating an account or using Mad Buddy, you confirm that you have read, understood, and agree to be bound by these Terms and our Privacy Policy. If you do not agree, please do not use the Service.
          </p>
        </div>

        <article className="mt-12 space-y-12">
          {sections.map((section) => (
            <section key={section.title} className="border-t border-[#4E0401]/10 pt-8 first:border-t-0 first:pt-0 dark:border-white/10">
              <h2 className="text-2xl font-semibold tracking-[-0.025em] text-[#4E0401] dark:text-[#FFF8F1]">{section.title}</h2>
              <div className="mt-4 space-y-4 text-[0.96rem] leading-7 text-[#4E0401]/64 dark:text-[#FFF8F1]/64">
                {section.blocks.map((block, index) =>
                  block.type === "list" ? (
                    <ul key={index} className="space-y-2 pl-5">
                      {block.items.map((item) => (
                        <li key={item} className="list-disc pl-1">{item}</li>
                      ))}
                    </ul>
                  ) : (
                    <p key={index}>{block.text}</p>
                  )
                )}
              </div>
            </section>
          ))}
        </article>

        <div className="mt-14 flex flex-wrap gap-4 border-t border-[#4E0401]/10 pt-7 text-sm dark:border-white/10">
          <Link href="/privacy" className="focus-ring inline-flex min-h-11 items-center rounded-lg font-semibold text-[#4E0401] hover:text-[#E88C2B] dark:text-[#FFF8F1]">Privacy Policy</Link>
          <Link href="/support" className="focus-ring inline-flex min-h-11 items-center rounded-lg font-semibold text-[#4E0401] hover:text-[#E88C2B] dark:text-[#FFF8F1]">Support</Link>
        </div>
      </div>
    </PublicPageShell>
  );
}
