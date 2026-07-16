import Link from "next/link";
import { Check, Crown, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
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
        "relative flex h-full min-h-[31rem] flex-col bg-card/35 p-5 sm:p-6",
        isFeatured && "bg-primary/[0.07] shadow-[inset_0_2px_0_hsl(var(--primary)/0.75),0_18px_45px_hsl(var(--primary)/0.08)]"
      )}
    >
      <div className="flex min-h-7 items-center justify-between gap-3">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">{plan.name}</p>
        {plan.badge ? (
          <Badge variant={isFeatured ? "blue" : "violet"}>
            <Crown className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
            {plan.badge}
          </Badge>
        ) : null}
      </div>
      <div className="mt-5 flex items-end gap-1.5">
        <span className="text-4xl font-semibold tracking-tight">{plan.price}</span>
        <span className="pb-1 text-xs text-muted-foreground">/month</span>
      </div>
      <p className="mt-3 min-h-[3rem] text-sm leading-6 text-muted-foreground">{plan.description}</p>

      {plan.id === "free" ? (
        <Button type="button" className="mt-5 w-full" variant="outline" asChild>
          <Link href="/signup">
            <Sparkles className="h-4 w-4" aria-hidden="true" />
            Start free
          </Link>
        </Button>
      ) : (
        <CheckoutButton
          className="mt-5"
          plan={plan.id}
          label={`Upgrade to ${plan.name}`}
          variant={isFeatured ? "primary" : "outline"}
        />
      )}

      <div className="my-5 border-t border-border/70" />
      <ul className="grid gap-2.5 text-sm leading-5 text-muted-foreground">
        {[...plan.features, ...plan.limits].map((feature) => (
          <li key={feature} className="flex gap-2.5">
            <Check className={cn("mt-0.5 h-4 w-4 shrink-0", isFeatured ? "text-blue-400" : "text-accent")} aria-hidden="true" />
            <span>{feature}</span>
          </li>
        ))}
      </ul>
    </article>
  );
}
