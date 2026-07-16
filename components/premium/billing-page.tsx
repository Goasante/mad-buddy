import Link from "next/link";
import { ArrowLeft, CalendarClock, CheckCircle2, CreditCard, ShieldCheck } from "lucide-react";
import { BillingPortalButton } from "@/components/premium/billing-portal-button";
import { CheckoutButton } from "@/components/premium/checkout-button";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { SubscriptionPlan, SubscriptionStatus } from "@/lib/supabase/database.types";
import { cn } from "@/lib/utils";

const planCards = [
  {
    id: "free",
    name: "Free",
    price: "GHS 0",
    badge: "Starter",
    description: "Try private glow with a small trusted circle.",
    features: ["Basic glow", "25 Muddies", "Manual refresh"]
  },
  {
    id: "buddy_plus",
    checkoutPlan: "plus",
    name: "Buddy Plus",
    price: "GHS 50",
    badge: "Best for Muddies",
    description: "A real social upgrade for active friend groups.",
    features: ["Unlimited Muddies", "Best Buddies priority", "Smart nearby alerts", "Custom glow colors"],
    featured: true
  },
  {
    id: "buddy_pro",
    checkoutPlan: "pro",
    name: "Buddy Pro",
    price: "GHS 100",
    badge: "Maximum control",
    description: "Serious privacy controls for people who need boundaries.",
    features: ["Muddy Circles", "Ghost Mode schedules", "Privacy Zones", "Event Mode"]
  }
] as const;

const planLabels: Record<SubscriptionPlan, string> = {
  free: "Free",
  buddy_plus: "Buddy Plus",
  buddy_pro: "Buddy Pro"
};

const planRank: Record<SubscriptionPlan, number> = {
  free: 0,
  buddy_plus: 1,
  buddy_pro: 2
};

type SubscriptionRecord = {
  provider: string | null;
  paystack_subscription_code: string | null;
  plan: SubscriptionPlan;
  status: SubscriptionStatus;
  current_period_start: string | null;
  current_period_end: string | null;
  updated_at: string;
};

export async function BillingPageContent() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();
  const { data: subscription } = user
    ? await supabase
        .from("subscriptions")
        .select("provider, paystack_subscription_code, plan, status, current_period_start, current_period_end, updated_at")
        .eq("user_id", user.id)
        .maybeSingle()
    : { data: null };

  const currentPlan = subscription?.plan ?? "free";
  const currentStatus = subscription?.status ?? "free";

  return (
    <div className="mr-auto w-full max-w-[clamp(64rem,82vw,92rem)] space-y-3 pt-3 sm:pt-4">
      <section className="glass-panel overflow-hidden rounded-[1.25rem] p-0">
        <div className="flex flex-col gap-3 border-b border-border px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-[clamp(1.2rem,1.5vw,1.5rem)] font-semibold tracking-tight">Billing</h1>
            <p className="mt-1 text-sm text-muted-foreground">Plans and payment status.</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" variant="outline" size="sm" asChild>
              <Link href="/dashboard">
                <ArrowLeft className="h-4 w-4" aria-hidden="true" />
                Dashboard
              </Link>
            </Button>
            <BillingPortalButton label="Cancel subscription" icon="cancel" variant="outline" />
          </div>
        </div>

        <div className="space-y-3 p-4">
          <SubscriptionSummary
            plan={currentPlan}
            status={currentStatus}
            subscription={subscription}
          />
          <section id="plans" className="grid items-stretch gap-4 md:grid-cols-2 xl:grid-cols-3">
            {planCards.map((plan) => (
              <PlanCard
                key={plan.id}
                plan={plan}
                currentPlan={currentPlan}
              />
            ))}
          </section>
        </div>
      </section>

      <section id="activity" className="glass-panel rounded-[1.25rem] p-4">
        <div className="border-b border-border pb-3">
          <h2 className="text-lg font-semibold">Billing activity</h2>
          <p className="mt-1 text-xs text-muted-foreground">Paystack sync history.</p>
        </div>
        <BillingActivityTable subscription={subscription} />
      </section>
    </div>
  );
}

function SubscriptionSummary({
  plan,
  status,
  subscription
}: {
  plan: SubscriptionPlan;
  status: SubscriptionStatus;
  subscription: SubscriptionRecord | null;
}) {
  return (
    <section
      id="summary"
      className="grid gap-3 rounded-[1rem] border border-border bg-card/80 p-[clamp(0.75rem,1vw,1rem)] shadow-[0_10px_28px_hsl(var(--shadow)/0.08)] lg:grid-cols-[1.2fr_0.85fr_0.85fr]"
    >
      <div className="flex items-center gap-3">
        <div className="grid h-10 w-10 place-items-center rounded-[0.85rem] bg-lime-300 text-slate-950 glow-lime">
          <CreditCard className="h-4 w-4" aria-hidden="true" />
        </div>
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            Current plan
          </p>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <h2 className="text-xl font-semibold">{planLabels[plan]}</h2>
            <Badge variant={status === "active" ? "green" : plan === "free" ? "default" : "warning"}>
              {status}
            </Badge>
          </div>
        </div>
      </div>
      <SummaryMetric
        icon={ShieldCheck}
        label="Access"
        value={status === "active" ? "Premium" : "Standard"}
      />
      <SummaryMetric
        icon={CalendarClock}
        label="Renewal"
        value={formatDate(subscription?.current_period_end)}
      />
    </section>
  );
}

function PlanCard({
  plan,
  currentPlan
}: {
  plan: (typeof planCards)[number];
  currentPlan: SubscriptionPlan;
}) {
  const isFeatured = Boolean("featured" in plan && plan.featured);
  const isCurrent = currentPlan === plan.id;
  const isIncluded = planRank[currentPlan] > planRank[plan.id];
  const canUpgrade = planRank[plan.id] > planRank[currentPlan];

  return (
    <Card
      className={cn(
        "flex h-full min-h-[clamp(18rem,26vw,21rem)] flex-col p-[clamp(0.9rem,1.15vw,1.25rem)]",
        isFeatured && "border-blue-400/30 bg-primary/10 shadow-[0_14px_38px_hsl(var(--primary)/0.14)]"
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-muted-foreground">{plan.name}</p>
          <div className="mt-3 flex items-end gap-1">
            <span className="text-[clamp(1.85rem,2.4vw,2.25rem)] font-semibold tracking-tight">{plan.price}</span>
            <span className="pb-1 text-xs text-muted-foreground">/month</span>
          </div>
        </div>
        <Badge variant={isFeatured && canUpgrade ? "blue" : isCurrent || isIncluded ? "green" : "default"}>
          {isCurrent ? "Current" : isIncluded ? "Included" : plan.badge}
        </Badge>
      </div>
      <p className="mt-3 text-sm leading-6 text-muted-foreground">{plan.description}</p>
      <div className="mt-4">
        {isCurrent ? (
          <Button type="button" variant="outline" className="w-full" disabled>
            Current Plan
          </Button>
        ) : isIncluded || plan.id === "free" ? (
          <Button type="button" variant="outline" className="w-full" disabled>
            Included
          </Button>
        ) : canUpgrade ? (
          <CheckoutButton
            plan={plan.checkoutPlan}
            label={`Upgrade to ${plan.name}`}
            variant={isFeatured ? "primary" : "outline"}
          />
        ) : (
          <Button type="button" variant="outline" className="w-full" disabled>
            Included
          </Button>
        )}
      </div>
      <ul className="mt-5 grid gap-2.5 text-sm text-muted-foreground">
        {plan.features.map((feature) => (
          <li key={feature} className="flex items-center gap-2">
            <CheckCircle2
              className={cn("h-4 w-4", isFeatured ? "text-blue-500 dark:text-blue-200" : "text-emerald-500")}
              aria-hidden="true"
            />
            <span>{feature}</span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function BillingActivityTable({ subscription }: { subscription: SubscriptionRecord | null }) {
  return (
    <div className="mt-3 overflow-x-auto rounded-[1rem] border border-border">
      <div className="grid min-w-[40rem] grid-cols-[1.2fr_0.8fr_0.8fr_0.8fr] bg-secondary px-4 py-2.5 text-xs font-semibold text-muted-foreground">
        <span>Plan name</span>
        <span>Provider</span>
        <span>Status</span>
        <span>Next renewal</span>
      </div>
      {subscription ? (
        <div className="grid min-w-[40rem] grid-cols-[1.2fr_0.8fr_0.8fr_0.8fr] items-center px-4 py-3 text-sm">
          <span className="font-semibold">{planLabels[subscription.plan]}</span>
          <span className="text-muted-foreground">{subscription.provider ?? "paystack"}</span>
          <span>
            <Badge variant={subscription.status === "active" ? "green" : "default"}>{subscription.status}</Badge>
          </span>
          <span className="text-muted-foreground">{formatDate(subscription.current_period_end)}</span>
        </div>
      ) : (
        <div className="px-4 py-4 text-sm text-muted-foreground">
          No billing activity yet.
        </div>
      )}
    </div>
  );
}

function SummaryMetric({ icon: Icon, label, value }: { icon: typeof ShieldCheck; label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-[0.85rem] border border-border bg-secondary px-3 py-2.5">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Icon className="h-4 w-4 text-accent" aria-hidden="true" />
        <span>{label}</span>
      </div>
      <span className="text-sm font-semibold">{value}</span>
    </div>
  );
}

function formatDate(value: string | null | undefined) {
  if (!value) {
    return "None";
  }

  return new Intl.DateTimeFormat("en", { dateStyle: "medium" }).format(new Date(value));
}
