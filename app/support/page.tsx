import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, CreditCard, KeyRound, Mail, ShieldQuestion, UserCheck } from "lucide-react";
import { PublicPageShell } from "@/components/front-door/public-shell";
import { legalContact } from "@/content/privacy-policy";

export const metadata: Metadata = {
  title: "Support",
  description: "Get help with Mad Buddy account access, verification, billing, privacy requests, and product issues.",
  alternates: { canonical: "/support" },
  openGraph: {
    title: "Support | Mad Buddy",
    description: "Get help with Mad Buddy account access, verification, billing, privacy requests, and product issues.",
    url: "/support"
  }
};

const helpTopics = [
  {
    title: "Can't log in",
    description: "Reset your password or return to Login if you still have access to your email.",
    icon: KeyRound,
    href: "/forgot-password",
    action: "Reset password"
  },
  {
    title: "Verification or account setup",
    description: "If verification or account setup is not completing, contact support with the email address on the account and what you see on screen.",
    icon: UserCheck,
    href: `mailto:${legalContact.supportEmail}?subject=Mad%20Buddy%20account%20verification`,
    action: "Email support"
  },
  {
    title: "Billing or payment",
    description: "For a payment, plan, renewal, or subscription question, include the account email and any Paystack reference you can safely share.",
    icon: CreditCard,
    href: `mailto:${legalContact.supportEmail}?subject=Mad%20Buddy%20billing%20question`,
    action: "Ask about billing"
  },
  {
    title: "Privacy request",
    description: "Use the privacy contact for questions about your data, access, deletion, or the Privacy Policy.",
    icon: ShieldQuestion,
    href: `mailto:${legalContact.privacyEmail}?subject=Mad%20Buddy%20privacy%20request`,
    action: "Contact privacy"
  }
] as const;

export default function SupportPage() {
  return (
    <PublicPageShell>
      <div className="mx-auto w-full max-w-4xl px-4 py-14 sm:px-6 sm:py-20">
        <p className="text-xs font-bold uppercase tracking-[0.18em] text-[#A45A18]">Support</p>
        <h1 className="mt-3 max-w-3xl text-4xl font-semibold tracking-[-0.04em] text-[#4E0401] sm:text-5xl dark:text-[#FFF8F1]">
          Get to the right next step.
        </h1>
        <p className="mt-5 max-w-2xl text-base leading-8 text-[#4E0401]/65 dark:text-[#FFF8F1]/65">
          You do not need to be logged in to start getting help. Choose the issue that matches what is blocking you.
        </p>

        <div className="mt-12 grid gap-x-8 gap-y-2 sm:grid-cols-2">
          {helpTopics.map((topic) => (
            <section key={topic.title} className="border-t border-[#4E0401]/10 py-6 dark:border-white/10">
              <topic.icon className="h-5 w-5 text-[#A45A18]" aria-hidden="true" />
              <h2 className="mt-4 text-lg font-semibold text-[#4E0401] dark:text-[#FFF8F1]">{topic.title}</h2>
              <p className="mt-2 text-sm leading-7 text-[#4E0401]/62 dark:text-[#FFF8F1]/62">{topic.description}</p>
              <Link href={topic.href} className="focus-ring mt-4 inline-flex min-h-11 items-center gap-2 rounded-lg text-sm font-semibold text-[#4E0401] hover:text-[#E88C2B] dark:text-[#FFF8F1]">
                {topic.action} <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </Link>
            </section>
          ))}
        </div>

        <section className="mt-10 border-t border-[#4E0401]/10 pt-8 dark:border-white/10">
          <div className="flex items-start gap-3">
            <Mail className="mt-1 h-5 w-5 shrink-0 text-[#A45A18]" aria-hidden="true" />
            <div>
              <h2 className="text-lg font-semibold text-[#4E0401] dark:text-[#FFF8F1]">Something else</h2>
              <p className="mt-2 text-sm leading-7 text-[#4E0401]/62 dark:text-[#FFF8F1]/62">
                General support currently uses email. Mad Buddy does not claim 24/7 coverage or a guaranteed response time.
              </p>
              <a
                href={`mailto:${legalContact.supportEmail}?subject=Mad%20Buddy%20support`}
                className="focus-ring mt-4 inline-flex min-h-11 items-center rounded-full bg-[#4E0401] px-5 text-sm font-semibold text-white dark:bg-[#E88C2B] dark:text-[#2A120A]"
              >
                Email {legalContact.supportEmail}
              </a>
            </div>
          </div>
        </section>

        <p className="mt-10 text-xs leading-6 text-[#4E0401]/50 dark:text-[#FFF8F1]/50">
          Mad Buddy support is not an emergency service. If you are in immediate danger, contact the appropriate local emergency service or someone you trust nearby.
        </p>
      </div>
    </PublicPageShell>
  );
}
