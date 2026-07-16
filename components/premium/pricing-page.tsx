import Link from "next/link";
import { ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { PlanComparisonTable } from "@/components/premium/plan-comparison-table";
import { BrandMark } from "@/components/brand/brand-mark";
import { PricingCard } from "@/components/premium/pricing-card";
import { pricingPlans } from "@/components/premium/plans";

export function PricingPageContent() {
  return (
    <main className="min-h-screen bg-background">
      <PricingHeader />

      <div className="mx-auto max-w-6xl px-4 pb-7 pt-20 sm:px-6 sm:pt-24">
        <section className="px-2 pb-10 pt-12 text-center sm:pb-12 sm:pt-16">
          <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-primary">Pricing</p>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight sm:text-5xl">Choose the plan that fits you.</h1>
          <p className="mx-auto mt-4 max-w-xl text-sm leading-6 text-muted-foreground sm:text-base">
            Start free, then upgrade for more ways to connect, customise, and stay in control.
          </p>
        </section>

        <section className="relative isolate px-0 sm:px-4" aria-label="Pricing plans">
          <PricingDecoration />
          <div className="grid overflow-hidden rounded-xl border border-border/80 bg-card/20 shadow-[0_18px_55px_hsl(var(--shadow)/0.1)] divide-y divide-border/70 lg:grid-cols-3 lg:divide-x lg:divide-y-0">
            {pricingPlans.map((plan) => (
              <PricingCard key={plan.id} plan={plan} />
            ))}
          </div>
        </section>

        <section className="mt-12 sm:px-4">
          <Card className="overflow-hidden rounded-xl border-border/80 bg-card/30 p-0 shadow-[0_16px_45px_hsl(var(--shadow)/0.08)]">
            <div className="flex items-center gap-2 border-b border-border/70 px-4 py-4 sm:px-5">
              <ShieldCheck className="h-5 w-5 text-accent" aria-hidden="true" />
              <h2 className="text-xl font-semibold">Plan comparison</h2>
            </div>
            <PlanComparisonTable />
          </Card>
        </section>
      </div>
    </main>
  );
}

function PricingHeader() {
  return (
    <header className="fixed inset-x-0 top-3 z-50 px-3 sm:top-4">
      <nav className="glass-panel mx-auto flex h-14 max-w-6xl items-center justify-between rounded-full px-3 sm:px-5" aria-label="Pricing navigation">
        <Link href="/" className="flex items-center gap-3 font-semibold">
          <BrandMark className="h-9 w-9" priority />
          <span>Mad Buddy</span>
        </Link>
        <div className="hidden items-center gap-7 text-sm font-medium text-muted-foreground md:flex">
          <Link className="hover:text-foreground" href="/#how-it-works">
            How it works
          </Link>
          <Link className="hover:text-foreground" href="/privacy">
            Privacy
          </Link>
          <Link
            className="rounded-full bg-secondary px-3 py-2 text-foreground shadow-[inset_0_0_0_1px_hsl(var(--border))]"
            href="/pricing"
            aria-current="page"
          >
            Pricing
          </Link>
        </div>
        <div className="flex items-center gap-2">
          <Button asChild size="sm" variant="ghost">
            <Link href="/login">Log in</Link>
          </Button>
          <Button asChild size="sm">
            <Link href="/signup">Get started</Link>
          </Button>
        </div>
      </nav>
    </header>
  );
}

function PricingDecoration() {
  return (
    <div className="pointer-events-none absolute -inset-x-3 -inset-y-5 -z-10 hidden opacity-60 sm:block" aria-hidden="true">
      <span className="absolute inset-x-0 top-0 border-t border-border/60" />
      <span className="absolute inset-x-0 bottom-0 border-t border-border/50" />
      <span className="absolute bottom-0 left-0 top-0 border-l border-border/50" />
      <span className="absolute bottom-0 right-0 top-0 border-l border-border/50" />
      <span className="absolute -left-1 top-1/3 h-2 w-2 rounded-full border border-blue-400/50 bg-background" />
      <span className="absolute -right-1 top-2/3 h-2 w-2 rounded-full border border-violet-400/50 bg-background" />
    </div>
  );
}
