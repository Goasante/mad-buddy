import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { BrandMark } from "@/components/brand/brand-mark";
import { Button } from "@/components/ui/button";

const faqItems = [
  {
    question: "What is a Muddy?",
    answer:
      "A Muddy is a friend you have mutually approved on Mad Buddy. You both need to accept before either of you can appear nearby."
  },
  {
    question: "Can friends see my exact location?",
    answer:
      "No. Friends see privacy-safe proximity levels and your profile — not coordinates, maps, street addresses, direction of travel, or exact distance."
  },
  {
    question: "Do both people have to approve?",
    answer: "Yes. Mad Buddy requires mutual approval before anyone appears in a nearby list."
  },
  {
    question: "What's the difference between a Wave and a Plan?",
    answer:
      "A Wave is a quick signal that you're open to connect — when it's mutual, a chat opens. A Plan is a real event you create and invite Muddies to, with simple RSVPs."
  },
  {
    question: "Can I stop appearing nearby?",
    answer:
      "Yes. Pause your visibility from the dashboard or turn on Ghost Mode in settings whenever you want more privacy."
  },
  {
    question: "What does Ghost Mode do?",
    answer:
      "Ghost Mode pauses your visibility. Approved friends will not see your glow while it is on. You can turn it off again at any time."
  },
  {
    question: "Does Mad Buddy show a map?",
    answer: "No. Mad Buddy uses glowing profile cards and proximity levels — there is no map view."
  },
  {
    question: "Can I delete my data?",
    answer:
      "Yes. You can delete your account from settings, which removes your profile and associated data. Production deletion behaviour should be verified against your live deployment."
  },
  {
    question: "Is Mad Buddy free?",
    answer:
      "Yes. Mad Buddy has a free plan with nearby glow, up to 25 approved friends, and Ghost Mode. Paid plans add more friends and extras — see Pricing for details."
  }
];

export function FaqPage() {
  return (
    <main className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border/70 px-4 py-4 sm:px-6">
        <div className="mx-auto flex max-w-6xl items-center justify-between">
          <Link href="/" className="focus-ring flex items-center gap-3 font-semibold" aria-label="Mad Buddy home">
            <BrandMark className="h-9 w-9" priority />
            Mad Buddy
          </Link>
          <Button type="button" variant="outline" size="sm" asChild>
            <Link href="/">Back home</Link>
          </Button>
        </div>
      </header>

      <div className="mx-auto max-w-3xl px-4 py-16 sm:px-6">
        <p className="text-xs font-semibold uppercase tracking-[0.22em] text-primary">FAQ</p>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">Common questions</h1>
        <p className="mt-5 max-w-2xl text-base leading-7 text-muted-foreground">
          Everything you need to know about how Mad Buddy keeps proximity private, mutual, and on
          your terms.
        </p>

        <dl className="mt-10 space-y-3">
          {faqItems.map((item) => (
            <div key={item.question} className="rounded-xl border border-border/70 bg-card/50 px-5 py-4">
              <dt className="text-base font-semibold">{item.question}</dt>
              <dd className="mt-2 text-sm leading-6 text-muted-foreground">{item.answer}</dd>
            </div>
          ))}
        </dl>

        <div className="mt-12 rounded-2xl border border-border/70 bg-card/50 p-6 text-center">
          <p className="text-lg font-semibold">Still have questions?</p>
          <p className="mt-2 text-sm text-muted-foreground">
            Create a free account and see how it works, or reach out from your settings once you&apos;re in.
          </p>
          <Button type="button" className="mt-5" asChild>
            <Link href="/signup">
              Get started
              <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </Link>
          </Button>
        </div>
      </div>
    </main>
  );
}
