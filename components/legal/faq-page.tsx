import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { PublicPageShell } from "@/components/front-door/public-shell";

const faqItems = [
  {
    question: "What is a Muddy?",
    answer:
      "A Muddy is a friend you have both approved on Mad Buddy. Muddy proximity is mutual and follows each person's visibility settings."
  },
  {
    question: "Can other people see my exact location?",
    answer:
      "No. Mad Buddy does not show another user your exact GPS coordinates, street address, live map position, exact numerical distance, or location history through the ordinary proximity experience."
  },
  {
    question: "How is Linkr different from Muddy proximity?",
    answer:
      "Muddy proximity is for approved friends. Linkr is discovery you deliberately switch on when you want to meet someone new. While Linkr is enabled, eligible people who are not yet Muddies may receive a privacy-safe approximate proximity signal as part of discovery."
  },
  {
    question: "Do both people have to approve before becoming Muddies?",
    answer:
      "Yes. A friendship becomes a Muddy connection only after mutual approval. Linkr discovery does not make someone a Muddy automatically."
  },
  {
    question: "Can I stop appearing nearby?",
    answer:
      "Yes. You can change your visibility controls, use Ghost Mode, and stop a Linkr session when you no longer want discovery active."
  },
  {
    question: "Does Mad Buddy show a live map?",
    answer:
      "No. The proximity experience is designed around broad signals rather than a live map, map pin, direction of travel, or exact distance."
  },
  {
    question: "What is Safe Arrival?",
    answer:
      "Safe Arrival is a safety-focused check-in experience that helps chosen people know whether you arrived, without turning them into live location trackers."
  },
  {
    question: "Can I block or report someone?",
    answer:
      "Yes. Mad Buddy includes blocking and reporting controls. Blocking is intended to remove the connection and interaction paths between the people involved."
  },
  {
    question: "Can I delete my account data?",
    answer:
      "Mad Buddy provides account deletion from Settings. The Privacy Policy explains the current deletion and limited-retention rules in more detail."
  },
  {
    question: "Is Mad Buddy free?",
    answer:
      "Mad Buddy Core is free. Mad Buddy Access is one optional subscription that expands Linkr and lets UpFor reach beyond your Muddies. Current prices and any eligible trial are shown on Pricing so the public explanation stays aligned with the product's billing authority."
  }
] as const;

export function FaqPage() {
  return (
    <PublicPageShell>
      <div className="mx-auto w-full max-w-3xl px-4 py-14 sm:px-6 sm:py-20">
        <p className="text-xs font-bold uppercase tracking-[0.18em] text-[#A45A18]">FAQ</p>
        <h1 className="mt-3 text-4xl font-semibold tracking-[-0.04em] text-[#4E0401] sm:text-5xl dark:text-[#FFF8F1]">
          Common questions, plainly answered.
        </h1>
        <p className="mt-5 max-w-2xl text-base leading-8 text-[#4E0401]/65 dark:text-[#FFF8F1]/65">
          The short version of how proximity, discovery, safety, access, and account control work before you decide to join.
        </p>

        <dl className="mt-12 divide-y divide-[#4E0401]/10 border-y border-[#4E0401]/10 dark:divide-white/10 dark:border-white/10">
          {faqItems.map((item) => (
            <div key={item.question} className="py-6 first:pt-0 last:pb-0">
              <dt className="text-base font-semibold text-[#4E0401] dark:text-[#FFF8F1]">{item.question}</dt>
              <dd className="mt-2 text-sm leading-7 text-[#4E0401]/62 dark:text-[#FFF8F1]/62">{item.answer}</dd>
            </div>
          ))}
        </dl>

        <section className="mt-14 border-t border-[#4E0401]/10 pt-8 dark:border-white/10">
          <h2 className="text-xl font-semibold tracking-[-0.02em] text-[#4E0401] dark:text-[#FFF8F1]">Need help with your own account?</h2>
          <p className="mt-2 max-w-xl text-sm leading-7 text-[#4E0401]/62 dark:text-[#FFF8F1]/62">
            FAQ explains the product. Support is for account access, verification, billing, privacy requests, and problems that need a real next step.
          </p>
          <Link
            href="/support"
            className="focus-ring mt-5 inline-flex min-h-11 items-center gap-2 rounded-full bg-[#4E0401] px-5 text-sm font-semibold text-white dark:bg-[#E88C2B] dark:text-[#2A120A]"
          >
            Go to Support <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </Link>
        </section>
      </div>
    </PublicPageShell>
  );
}
