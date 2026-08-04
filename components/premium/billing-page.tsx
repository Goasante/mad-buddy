import Link from "next/link";
import {
  ArrowLeft,
  CalendarClock,
  CheckCircle2,
  CircleGauge,
  CreditCard,
  Gift,
  ShieldCheck,
  Sparkles
} from "lucide-react";
import { BillingPortalButton } from "@/components/premium/billing-portal-button";
import { CheckoutButton } from "@/components/premium/checkout-button";
import { PremiumPlanBadge } from "@/components/premium/premium-plan-badge";
import { pricingPlans } from "@/components/premium/plans";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { billingAccessSource, effectivePlan } from "@/lib/billing/entitlements";
import {
  membershipUsageItems,
  membershipUsagePercent,
  resolveMembershipIdentity
} from "@/lib/billing/membership";
import { billingServerNowMs, calculateUsage, loadBillingState, resolveUserEntitlements } from "@/lib/billing/service";
import { formatEntitlementAmount } from "@/lib/billing/upgrade-copy";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import type { SubscriptionPlan, SubscriptionStatus } from "@/lib/supabase/database.types";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { TOUR_TARGET_IDS } from "@/lib/tours/registry";
import { cn } from "@/lib/utils";

const planRank: Record<SubscriptionPlan, number> = {
  free: 0,
  buddy_plus: 1,
  buddy_pro: 2
};

const planByCardId: Record<(typeof pricingPlans)[number]["id"], SubscriptionPlan> = {
  free: "free",
  plus: "buddy_plus",
  pro: "buddy_pro"
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

  if (!user) return null;

  const admin = createSupabaseAdminClient();
  const nowMs = billingServerNowMs();
  const [state, entitlements, usage, subscriptionResult] = await Promise.all([
    loadBillingState(admin, user.id),
    resolveUserEntitlements(admin, user.id, nowMs),
    calculateUsage(admin, user.id),
    supabase
      .from("subscriptions")
      .select("provider, paystack_subscription_code, plan, status, current_period_start, current_period_end, updated_at")
      .eq("user_id", user.id)
      .maybeSingle()
  ]);

  const subscription = subscriptionResult.data as SubscriptionRecord | null;
  const identity = resolveMembershipIdentity(state, nowMs);
  const currentPlan = effectivePlan(state, nowMs);
  const accessSource = billingAccessSource(state, nowMs);
  const usageItems = membershipUsageItems(usage, entitlements);
  const currentPlanDetails = pricingPlans.find((plan) => planByCardId[plan.id] === currentPlan) ?? pricingPlans[0];
  const canCancel =
    accessSource === "subscription" &&
    subscription?.paystack_subscription_code &&
    !["non_renewing", "cancelled", "expired"].includes(state.status);

  return (
    <div className="mr-auto w-full max-w-[1200px] space-y-6 pt-3 sm:pt-4">
      <header className="flex flex-col gap-4 border-b border-border pb-5 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary">Your access</p>
          <h1 className="mt-1 text-[clamp(1.7rem,3vw,2.4rem)] font-semibold tracking-tight">Membership</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            See what you have, what you use, and when your access changes.
          </p>
        </div>
        <Button type="button" variant="outline" size="sm" asChild>
          <Link href="/dashboard">
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            Home
          </Link>
        </Button>
      </header>

      <section data-tour-id={TOUR_TARGET_IDS.BILLING_OVERVIEW} className="grid gap-5 lg:grid-cols-[1.35fr_0.85fr]">
        <Card className="overflow-hidden p-0">
          <div className="border-b border-border bg-primary/[0.04] p-5 sm:p-6">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                  Current membership
                </p>
                <div className="mt-2 flex flex-wrap items-center gap-2.5">
                  <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">{identity.planLabel}</h2>
                  <PremiumPlanBadge plan={identity.plan} />
                  <Badge variant={identity.source === "free" ? "default" : "green"}>{identity.statusLabel}</Badge>
                </div>
                <p className="mt-2 flex items-center gap-2 text-sm text-muted-foreground">
                  {identity.source === "earned" ? <Gift className="h-4 w-4 text-primary" aria-hidden="true" /> : null}
                  {identity.source === "trial" ? <Sparkles className="h-4 w-4 text-primary" aria-hidden="true" /> : null}
                  {identity.source === "subscription" ? <CreditCard className="h-4 w-4 text-primary" aria-hidden="true" /> : null}
                  {identity.source === "free" ? <ShieldCheck className="h-4 w-4 text-primary" aria-hidden="true" /> : null}
                  {identity.sourceLabel}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button type="button" size="sm" asChild>
                  <Link href="#membership-options">Manage Membership</Link>
                </Button>
                {canCancel ? <BillingPortalButton label="Cancel renewal" icon="cancel" variant="outline" /> : null}
              </div>
            </div>
          </div>

          <div className="grid gap-4 p-5 sm:grid-cols-2 sm:p-6">
            <IdentityDetail
              icon={CalendarClock}
              label={identity.dateLabel ?? "Access period"}
              value={identity.dateMs ? formatDate(new Date(identity.dateMs).toISOString()) : "No expiry"}
            />
            <IdentityDetail
              icon={ShieldCheck}
              label="Access source"
              value={identity.sourceLabel}
            />
          </div>
        </Card>

        <Card className="p-5 sm:p-6">
          <div className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-primary" aria-hidden="true" />
            <h2 className="text-lg font-semibold">Included with {identity.planLabel}</h2>
          </div>
          <ul className="mt-4 grid gap-3 text-sm">
            {currentPlanDetails.features.slice(0, 6).map((feature) => (
              <li key={feature} className="flex items-start gap-2.5">
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" aria-hidden="true" />
                <span>{feature}</span>
              </li>
            ))}
          </ul>
        </Card>
      </section>

      <section className="glass-panel rounded-[1.25rem] p-5 sm:p-6" aria-labelledby="membership-usage-title">
        <div>
          <h2 id="membership-usage-title" className="text-lg font-semibold">Current usage</h2>
          <p className="mt-1 text-sm text-muted-foreground">Your live usage against this membership&apos;s limits.</p>
        </div>
        <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
          {usageItems.map((item) => {
            const percent = membershipUsagePercent(item.current, item.limit);
            const limitLabel = formatEntitlementAmount(item.limit);
            return (
              <div key={item.key} className="rounded-2xl border border-border bg-card/75 p-4">
                <div className="flex items-center justify-between gap-2 text-sm">
                  <span className="font-medium">{item.label}</span>
                  <span className="text-muted-foreground">
                    {item.current.toLocaleString()} / {limitLabel}
                  </span>
                </div>
                <div
                  className="mt-3 h-1.5 overflow-hidden rounded-full bg-secondary"
                  role="progressbar"
                  aria-label={`${item.label} usage`}
                  aria-valuemin={0}
                  aria-valuemax={Number.isFinite(item.limit) ? item.limit : undefined}
                  aria-valuenow={Number.isFinite(item.limit) ? Math.min(item.current, item.limit) : undefined}
                  aria-valuetext={`${item.current.toLocaleString()} of ${limitLabel}`}
                >
                  <span className="block h-full rounded-full bg-primary transition-[width] duration-500 ease-in-out" style={{ width: `${percent}%` }} />
                </div>
              </div>
            );
          })}
        </div>
      </section>

      <section id="membership-options" data-tour-id={TOUR_TARGET_IDS.BILLING_PLANS} aria-labelledby="membership-options-title">
        <div className="mb-4">
          <h2 id="membership-options-title" className="text-xl font-semibold">Membership options</h2>
          <p className="mt-1 text-sm text-muted-foreground">Choose the access that fits how you use Mad Buddy.</p>
        </div>
        <div className="grid items-stretch gap-4 md:grid-cols-2 xl:grid-cols-3">
          {pricingPlans.map((plan) => (
            <MembershipOption key={plan.id} plan={plan} currentPlan={currentPlan} />
          ))}
        </div>
      </section>

      <section id="activity" data-tour-id={TOUR_TARGET_IDS.BILLING_ACTIVITY} className="glass-panel rounded-[1.25rem] p-5 sm:p-6">
        <div className="border-b border-border pb-3">
          <h2 className="text-lg font-semibold">Membership activity</h2>
          <p className="mt-1 text-sm text-muted-foreground">Your latest paid membership status.</p>
        </div>
        <MembershipActivity subscription={subscription} />
      </section>
    </div>
  );
}

function IdentityDetail({ icon: Icon, label, value }: { icon: typeof ShieldCheck; label: string; value: string }) {
  return (
    <div className="flex items-center gap-3 rounded-2xl border border-border bg-secondary/55 p-4">
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-primary/10 text-primary">
        <Icon className="h-4 w-4" aria-hidden="true" />
      </span>
      <span className="min-w-0">
        <span className="block text-xs text-muted-foreground">{label}</span>
        <span className="block truncate text-sm font-semibold">{value}</span>
      </span>
    </div>
  );
}

function MembershipOption({
  plan,
  currentPlan
}: {
  plan: (typeof pricingPlans)[number];
  currentPlan: SubscriptionPlan;
}) {
  const targetPlan = planByCardId[plan.id];
  const isCurrent = targetPlan === currentPlan;
  const isIncluded = planRank[currentPlan] > planRank[targetPlan];
  const canUpgrade = planRank[targetPlan] > planRank[currentPlan];

  return (
    <Card className={cn("flex h-full flex-col p-5", plan.id === "plus" && canUpgrade && "border-primary/35 shadow-[0_14px_38px_hsl(var(--primary)/0.10)]")}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-lg font-semibold">{plan.name}</p>
          <p className="mt-1 text-sm text-muted-foreground">{plan.description}</p>
        </div>
        <Badge variant={isCurrent || isIncluded ? "green" : plan.id === "plus" ? "blue" : "default"}>
          {isCurrent ? "Current" : isIncluded ? "Included" : plan.badge ?? "Available"}
        </Badge>
      </div>
      <div className="mt-5 flex items-end gap-1">
        <span className="text-3xl font-semibold tracking-tight">{plan.price}</span>
        <span className="pb-1 text-xs text-muted-foreground">/month</span>
      </div>
      <ul className="mt-5 grid gap-2.5 text-sm text-muted-foreground">
        {[...plan.features, ...plan.limits].slice(0, 7).map((feature) => (
          <li key={feature} className="flex items-start gap-2">
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" aria-hidden="true" />
            <span>{feature}</span>
          </li>
        ))}
      </ul>
      <div className="mt-auto pt-6">
        {isCurrent ? (
          <Button type="button" variant="outline" className="w-full" disabled>Current Membership</Button>
        ) : isIncluded || targetPlan === "free" ? (
          <Button type="button" variant="outline" className="w-full" disabled>Included</Button>
        ) : canUpgrade && plan.id !== "free" ? (
          <CheckoutButton plan={plan.id} label={`Choose ${plan.name}`} variant={plan.id === "plus" ? "primary" : "outline"} />
        ) : null}
      </div>
    </Card>
  );
}

function MembershipActivity({ subscription }: { subscription: SubscriptionRecord | null }) {
  if (!subscription) {
    return (
      <div className="flex items-center gap-3 py-5 text-sm text-muted-foreground">
        <CircleGauge className="h-5 w-5" aria-hidden="true" />
        Free membership has no payment activity.
      </div>
    );
  }

  return (
    <div className="mt-4 grid gap-3 sm:grid-cols-3">
      <IdentityDetail icon={CreditCard} label="Provider" value={subscription.provider ?? "Paystack"} />
      <IdentityDetail icon={ShieldCheck} label="Payment status" value={humanizeStatus(subscription.status)} />
      <IdentityDetail icon={CalendarClock} label="Current period ends" value={formatDate(subscription.current_period_end)} />
    </div>
  );
}

function humanizeStatus(value: string) {
  return value.replaceAll("_", " ").replace(/^./, (character) => character.toUpperCase());
}

function formatDate(value: string | null | undefined) {
  if (!value) return "Not applicable";
  return new Intl.DateTimeFormat("en", { dateStyle: "medium" }).format(new Date(value));
}
