import { ShieldCheck } from "lucide-react";
import { PublicPageShell } from "@/components/front-door/public-shell";
import { Card } from "@/components/ui/card";
import { PlanComparisonTable } from "@/components/premium/plan-comparison-table";
import { PricingCard } from "@/components/premium/pricing-card";
import { pricingPlans } from "@/components/premium/plans";
import { PricingViewTracker } from "@/components/premium/pricing-view-tracker";
import { TrialOffer } from "@/components/premium/trial-offer";

export function PricingPageContent({ showTrialOffer = false }: { showTrialOffer?: boolean }) {
  return (
    <PublicPageShell>
      <PricingViewTracker />
      <div className="mx-auto w-full max-w-6xl px-4 py-14 sm:px-6 sm:py-20">
        <section className="max-w-3xl">
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-[#A45A18]">Pricing</p>
          <h1 className="mt-3 text-4xl font-semibold tracking-[-0.04em] text-[#4E0401] sm:text-5xl dark:text-[#FFF8F1]">
            Start free. Upgrade when the extra access is useful.
          </h1>
          <p className="mt-5 max-w-2xl text-base leading-8 text-[#4E0401]/65 dark:text-[#FFF8F1]/65">
            Free, Buddy Plus, and Buddy Pro read from Mad Buddy&apos;s current billing and entitlement authority so this page does not invent a second set of plan promises.
          </p>
        </section>

        <section className="mt-12" aria-label="Pricing plans">
          {showTrialOffer ? <TrialOffer /> : null}
          <div className="grid overflow-hidden rounded-[1.5rem] border border-[#4E0401]/10 bg-white/35 shadow-[0_24px_70px_rgba(78,4,1,0.06)] divide-y divide-[#4E0401]/10 lg:grid-cols-3 lg:divide-x lg:divide-y-0 dark:border-white/10 dark:bg-white/[0.025] dark:divide-white/10">
            {pricingPlans.map((plan) => (
              <PricingCard key={plan.id} plan={plan} />
            ))}
          </div>
        </section>

        <section className="mt-12">
          <Card className="overflow-hidden rounded-[1.5rem] border-[#4E0401]/10 bg-white/35 p-0 shadow-none dark:border-white/10 dark:bg-white/[0.025]">
            <div className="flex items-center gap-3 border-b border-[#4E0401]/10 px-5 py-5 dark:border-white/10">
              <ShieldCheck className="h-5 w-5 text-[#A45A18]" aria-hidden="true" />
              <div>
                <h2 className="text-xl font-semibold text-[#4E0401] dark:text-[#FFF8F1]">Plan comparison</h2>
                <p className="mt-1 text-sm text-[#4E0401]/55 dark:text-[#FFF8F1]/55">Compare current limits and premium capabilities.</p>
              </div>
            </div>
            <PlanComparisonTable />
          </Card>
        </section>
      </div>
    </PublicPageShell>
  );
}
