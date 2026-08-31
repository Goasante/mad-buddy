import Link from "next/link";
import { Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CheckoutButton } from "@/components/premium/checkout-button";
import type { PricingPlan } from "@/components/premium/plans";
import { cn } from "@/lib/utils";

export type PricingCardProps = {
  plan: PricingPlan;
};

export function PricingCard({ plan }: PricingCardProps) {
  const isFeatured = plan.id === "plus";

  return (
    <article
      className={cn(
        "relative flex h-full min-h-[31rem] flex-col bg-transparent p-5 sm:p-6",
        isFeatured && "bg-[#E88C2B]/[0.055] shadow-[inset_0_2px_0_rgba(232,140,43,0.75)]"
      )}
    >
      <div className="flex min-h-7 items-center justify-between gap-3">
        <p className="text-xs font-bold uppercase tracking-[0.16em] text-[#4E0401]/50 dark:text-[#FFF8F1]/50">{plan.name}</p>
        {plan.badge ? (
          <span className="inline-flex min-h-7 items-center rounded-full border border-[#E88C2B]/25 bg-[#E88C2B]/10 px-2.5 text-xs font-semibold text-[#8E4B12] dark:text-[#F0AE68]">
            {plan.badge}
          </span>
        ) : null}
      </div>
      <div className="mt-5 flex items-end gap-1.5">
        <span className="text-4xl font-semibold tracking-tight text-[#4E0401] dark:text-[#FFF8F1]">{plan.price}</span>
        <span className="pb-1 text-xs text-[#4E0401]/50 dark:text-[#FFF8F1]/50">/month</span>
      </div>
      <p className="mt-3 min-h-[3rem] text-sm leading-6 text-[#4E0401]/60 dark:text-[#FFF8F1]/60">{plan.description}</p>

      {plan.id === "free" ? (
        <Button type="button" className="mt-5 w-full" variant="outline" asChild>
          <Link href="/signup">Start free</Link>
        </Button>
      ) : (
        <CheckoutButton
          className="mt-5"
          plan={plan.id}
          label={`Upgrade to ${plan.name}`}
          variant={isFeatured ? "primary" : "outline"}
        />
      )}

      <div className="my-5 border-t border-[#4E0401]/10 dark:border-white/10" />
      <ul className="grid gap-2.5 text-sm leading-5 text-[#4E0401]/62 dark:text-[#FFF8F1]/62">
        {[...plan.features, ...plan.limits].map((feature) => (
          <li key={feature} className="flex gap-2.5">
            <Check className="mt-0.5 h-4 w-4 shrink-0 text-[#A45A18]" aria-hidden="true" />
            <span>{feature}</span>
          </li>
        ))}
      </ul>
    </article>
  );
}
