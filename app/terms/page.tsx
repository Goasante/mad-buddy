import Link from "next/link";
import type { Metadata } from "next";
import { BrandMark } from "@/components/brand/brand-mark";
import { legalContact } from "@/content/privacy-policy";
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
    <main className="min-h-screen bg-background px-4 py-16 text-foreground">
      <div className="mx-auto max-w-2xl">
        <div className="text-center">
          <BrandMark className="mx-auto h-16 w-16" priority />
          <h1 className="mt-4 text-3xl font-semibold">Terms and Conditions</h1>
          <p className="mt-2 text-sm text-muted-foreground">Effective date: {TERMS_EFFECTIVE_DATE}</p>
        </div>

        <p className="mt-8 text-sm leading-7 text-muted-foreground">
          Welcome to Mad Buddy. These Terms and Conditions (&ldquo;Terms&rdquo;) govern your access to and use of the
          Mad Buddy application, website, and related services (collectively, the &ldquo;Service&rdquo;).
        </p>
        <p className="mt-3 text-sm leading-7 text-muted-foreground">
          By creating an account or using Mad Buddy, you confirm that you have read, understood, and agree to be
          bound by these Terms and our Privacy Policy. If you do not agree, please do not use the Service.
        </p>

        <div className="mt-8 space-y-8">
          {sections.map((section) => (
            <section key={section.title}>
              <h2 className="text-lg font-semibold">{section.title}</h2>
              <div className="mt-2 space-y-3">
                {section.blocks.map((block, index) =>
                  block.type === "list" ? (
                    <ul key={index} className="space-y-1.5 pl-5 text-sm leading-7 text-muted-foreground">
                      {block.items.map((item) => (
                        <li key={item} className="list-disc pl-1">
                          {item}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p key={index} className="text-sm leading-7 text-muted-foreground">
                      {block.text}
                    </p>
                  )
                )}
              </div>
            </section>
          ))}
        </div>

        <div className="mt-12 flex justify-center gap-4 border-t border-border/70 pt-6 text-sm">
          <Link href="/" className="font-semibold hover:text-accent">Home</Link>
          <Link href="/privacy" className="font-semibold hover:text-accent">Privacy Policy</Link>
        </div>
      </div>
    </main>
  );
}
