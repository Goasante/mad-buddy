import Link from "next/link";
import type { Metadata } from "next";
import { BrandMark } from "@/components/brand/brand-mark";
import { legalContactPlaceholders } from "@/content/privacy-policy";
import { FEATURE_ICON_CREDITS } from "@/lib/icons/feature-icons";

export const metadata: Metadata = {
  title: "Terms of Service",
  description: "Mad Buddy terms of service.",
  robots: { index: false, follow: false }
};

// DRAFT STATUS: like the privacy policy, this describes the product's real
// behavior but has NOT been approved by legal counsel. TODO(legal): replace
// entity placeholders and obtain sign-off before production launch.
const sections: Array<{ title: string; body: string[] }> = [
  {
    title: "1. Who we are",
    body: [
      `Mad Buddy is operated by ${legalContactPlaceholders.companyName}, ${legalContactPlaceholders.businessAddress}. By creating an account you agree to these terms and to our Privacy Policy.`
    ]
  },
  {
    title: "2. The service",
    body: [
      "Mad Buddy lets mutually approved friends (\"Muddies\") see privacy-safe proximity signals, never exact locations, maps, or distances.",
      "Proximity signals are estimates. Do not rely on Mad Buddy for safety-critical decisions, navigation, or emergencies."
    ]
  },
  {
    title: "3. Your account",
    body: [
      "You must provide accurate information and keep your credentials secure. You are responsible for activity on your account. You must be old enough to hold an account under the laws that apply to you."
    ]
  },
  {
    title: "4. Acceptable use",
    body: [
      "Do not harass, stalk, impersonate, or harm others; do not attempt to derive another person's exact location; do not probe, scrape, or interfere with the service; do not upload unlawful content. We may suspend or remove accounts that break these rules, and users can block and report others at any time."
    ]
  },
  {
    title: "5. Subscriptions",
    body: [
      "Paid plans are billed through Paystack at the prices shown on the pricing page. Subscriptions renew until cancelled. Failed payments may limit paid features until payment succeeds. Statutory refund rights are unaffected."
    ]
  },
  {
    title: "6. Your content",
    body: [
      "You keep ownership of what you upload (like your profile photo and bio) and grant us the license needed to operate the service, to store and display that content to you and the Muddies you have approved."
    ]
  },
  {
    title: "7. Ending the relationship",
    body: [
      "You can delete your account at any time from Settings, which removes your data as described in the Privacy Policy. We may suspend or terminate accounts that violate these terms."
    ]
  },
  {
    title: "8. Disclaimers and liability",
    body: [
      "The service is provided \"as is\" during this pre-release period. To the extent permitted by law, we are not liable for indirect or consequential losses arising from use of the service. Nothing in these terms excludes liability that cannot lawfully be excluded."
    ]
  },
  {
    title: "9. Changes",
    body: [
      "We may update these terms; material changes will be announced in the app before they take effect. Continued use after changes take effect means you accept them."
    ]
  },
  {
    title: "10. Contact",
    body: [`Questions about these terms: ${legalContactPlaceholders.supportEmail}.`]
  }
];

export default function TermsPage() {
  return (
    <main className="min-h-screen bg-background px-4 py-16 text-foreground">
      <div className="mx-auto max-w-2xl">
        <div className="text-center">
          <BrandMark className="mx-auto h-16 w-16" priority />
          <h1 className="mt-4 text-3xl font-semibold">Terms of Service</h1>
          <p className="mt-2 text-sm text-muted-foreground">Last updated: 16 July 2026</p>
        </div>

        <div
          role="note"
          className="mt-8 rounded-xl border border-amber-400/30 bg-amber-400/10 px-4 py-3 text-sm leading-6 text-amber-800 dark:text-amber-100"
        >
          <strong>Draft.</strong> These terms describe how Mad Buddy really works today, but they
          have not yet been reviewed by legal counsel and the company details are placeholders.
        </div>

        <div className="mt-8 space-y-8">
          {sections.map((section) => (
            <section key={section.title}>
              <h2 className="text-lg font-semibold">{section.title}</h2>
              {section.body.map((paragraph) => (
                <p key={paragraph.slice(0, 40)} className="mt-2 text-sm leading-7 text-muted-foreground">
                  {paragraph}
                </p>
              ))}
            </section>
          ))}
        </div>

        <section className="mt-12 border-t border-border/70 pt-8">
          <h2 className="text-lg font-semibold">Icon credits</h2>
          <p className="mt-2 text-sm leading-7 text-muted-foreground">
            Some feature icons in Mad Buddy are from Flaticon, used under their licence with attribution:
          </p>
          <ul className="mt-3 space-y-1.5 text-sm text-muted-foreground">
            {FEATURE_ICON_CREDITS.map((credit) => (
              <li key={credit.label}>
                {credit.label} icons created by {credit.author} –{" "}
                <a
                  href={credit.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-medium text-foreground underline decoration-border underline-offset-2 hover:text-accent"
                >
                  Flaticon
                </a>
              </li>
            ))}
          </ul>
        </section>

        <div className="mt-12 flex justify-center gap-4 border-t border-border/70 pt-6 text-sm">
          <Link href="/" className="font-semibold hover:text-accent">Home</Link>
          <Link href="/privacy" className="font-semibold hover:text-accent">Privacy Policy</Link>
        </div>
      </div>
    </main>
  );
}
