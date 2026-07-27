import type { SubscriptionPlan } from "@/lib/supabase/database.types";

export type RevenueRangeDays = 7 | 30 | 90 | 365;

export type RevenueCurrentCounts = {
  totalUsers: number;
  activePayingUsers: number;
  freeUsers: number;
  buddyPlusUsers: number;
  buddyProUsers: number;
  graceUsers: number;
  expiredGraceUsers: number;
  planUsers: Record<SubscriptionPlan, number>;
};

export type RevenueEvent = {
  eventType: string;
  userId: string | null;
  plan: SubscriptionPlan;
  previousPlan: SubscriptionPlan | null;
  amountMinor: number | null;
  providerFeeMinor?: number | null;
  netAmountMinor?: number | null;
  feeStatus?: "verified" | "unavailable";
  currency: string | null;
  occurredAt: string;
};

export type RevenueFact = {
  userId: string;
  eventDate: string;
  eventName: string;
  featureKey: string;
  subscriptionPlan: SubscriptionPlan;
  actionCount: number;
};

export type PlanPrice = { plan: Exclude<SubscriptionPlan, "free">; amountMinor: number; currency: string };

export type FunnelStep = {
  key: string;
  label: string;
  users: number;
  conversionPercent: number | null;
  dropOffPercent: number | null;
};

export type CurrencyRevenue = {
  currency: string;
  mrrMinor: number;
  arrRunRateMinor: number;
  collectedMinor: number;
  activePayingUsers: number;
  newPayingUsers: number;
  arppuMinor: number | null;
  dailyRevenue: Array<{ date: string; amountMinor: number }>;
};

export type PlanPerformance = {
  plan: SubscriptionPlan;
  users: number;
  activeUsers: number;
  payingUsers: number;
  revenueByCurrency: Record<string, number>;
  cancellations: number;
  featureActions: number;
};

export type FeaturePlanRow = {
  featureKey: string;
  freeUsers: number;
  plusUsers: number;
  proUsers: number;
  freeActionsPerUser: number;
  plusActionsPerUser: number;
  proActionsPerUser: number;
};

export type ConversionAssociation = {
  featureKey: string;
  convertedUsers: number;
  usersWithFeatureBeforeConversion: number;
  percent: number | null;
};

export type RevenueReport = {
  generatedAt: string;
  rangeDays: RevenueRangeDays;
  currencies: CurrencyRevenue[];
  current: {
    totalUsers: number;
    activePayingUsers: number;
    freeUsers: number;
    buddyPlusUsers: number;
    buddyProUsers: number;
    graceUsers: number;
    expiredGraceUsers: number;
  };
  lifecycle: {
    upgrades: number;
    downgrades: number;
    cancellations: number;
    failedPayments: number;
    recoveredPayments: number;
    recoveryRatePercent: number | null;
    subscriptionChurnPercent: number | null;
    grossRevenueRetentionPercent: null;
  };
  funnel: FunnelStep[];
  plans: PlanPerformance[];
  featurePlans: FeaturePlanRow[];
  conversionAssociations: ConversionAssociation[];
  inviteAttribution: {
    invitedUsers: number;
    activatedInvitedUsers: number;
    paidInvitedUsers: number;
    inviteToPaidPercent: number | null;
  };
};

const FUNNEL_EVENTS = [
  ["pricing_viewed", "Pricing viewed"],
  ["checkout_started", "Checkout started"],
  ["payment_attempted", "Payment attempted"],
  ["payment_succeeded", "Payment successful"],
  ["subscription_activated", "Subscription activated"],
  ["subscription_renewed", "Renewed"]
] as const;

export function buildRevenueReport(input: {
  currentCounts: RevenueCurrentCounts;
  events: RevenueEvent[];
  facts: RevenueFact[];
  planPrices: PlanPrice[];
  now: Date;
  rangeDays: RevenueRangeDays;
}): RevenueReport {
  const nowIso = input.now.toISOString();
  const today = nowIso.slice(0, 10);
  const start = addDays(today, -(input.rangeDays - 1));
  const events = input.events.filter((event) => day(event.occurredAt) >= start && day(event.occurredAt) <= today);
  const facts = input.facts.filter((fact) => fact.eventDate >= start && fact.eventDate <= today);
  const totalUsers = input.currentCounts.totalUsers;
  const activatedUsers = distinctUsers(events, "subscription_activated");
  const currencies = [...new Set([
    ...input.planPrices.map((price) => price.currency.toUpperCase()),
    ...events.flatMap((event) => event.currency ? [event.currency.toUpperCase()] : [])
  ])].sort();

  const currencyMetrics = currencies.map((currency) => {
    const recurringPlans = input.planPrices.filter((price) => price.currency.toUpperCase() === currency);
    const mrrMinor = recurringPlans.reduce((sum, price) => {
      const users = price.plan === "buddy_plus" ? input.currentCounts.buddyPlusUsers : input.currentCounts.buddyProUsers;
      return sum + users * price.amountMinor;
    }, 0);
    const successful = events.filter((event) => event.eventType === "payment_succeeded" && event.currency?.toUpperCase() === currency && event.amountMinor !== null);
    const payers = new Set(successful.flatMap((event) => event.userId ? [event.userId] : []));
    const collectedMinor = successful.reduce((sum, event) => sum + (event.amountMinor ?? 0), 0);
    const dailyRevenue = Array.from({ length: input.rangeDays }, (_, index) => {
      const date = addDays(start, index);
      return {
        date,
        amountMinor: successful.filter((event) => day(event.occurredAt) === date).reduce((sum, event) => sum + (event.amountMinor ?? 0), 0)
      };
    });
    return {
      currency,
      mrrMinor,
      arrRunRateMinor: mrrMinor * 12,
      collectedMinor,
      activePayingUsers: recurringPlans.reduce((sum, price) => sum + (price.plan === "buddy_plus" ? input.currentCounts.buddyPlusUsers : input.currentCounts.buddyProUsers), 0),
      newPayingUsers: new Set(events.filter((event) => event.eventType === "subscription_activated" && event.currency?.toUpperCase() === currency).flatMap((event) => event.userId ? [event.userId] : [])).size,
      arppuMinor: payers.size > 0 ? Math.round(collectedMinor / payers.size) : null,
      dailyRevenue
    };
  });

  const failures = events.filter((event) => event.eventType === "payment_failed");
  const recoveries = events.filter((event) => event.eventType === "payment_recovered");
  const cancellations = distinctUsers(events, "subscription_cancelled");
  const churnBase = input.currentCounts.activePayingUsers + cancellations.size;

  return {
    generatedAt: nowIso,
    rangeDays: input.rangeDays,
    currencies: currencyMetrics,
    current: {
      totalUsers,
      activePayingUsers: input.currentCounts.activePayingUsers,
      freeUsers: input.currentCounts.freeUsers,
      buddyPlusUsers: input.currentCounts.buddyPlusUsers,
      buddyProUsers: input.currentCounts.buddyProUsers,
      graceUsers: input.currentCounts.graceUsers,
      expiredGraceUsers: input.currentCounts.expiredGraceUsers
    },
    lifecycle: {
      upgrades: events.filter((event) => event.eventType === "plan_upgraded").length,
      downgrades: events.filter((event) => event.eventType === "plan_downgraded").length,
      cancellations: cancellations.size,
      failedPayments: failures.length,
      recoveredPayments: recoveries.length,
      recoveryRatePercent: percent(recoveries.length, failures.length),
      subscriptionChurnPercent: percent(cancellations.size, churnBase),
      // Requires a trusted opening recurring-revenue snapshot. Current-state
      // subscriptions cannot reconstruct that historical denominator.
      grossRevenueRetentionPercent: null
    },
    funnel: buildFunnel(input.currentCounts.freeUsers + activatedUsers.size, events),
    plans: buildPlanPerformance(input.currentCounts, events, facts),
    featurePlans: buildFeaturePlanRows(facts),
    conversionAssociations: buildConversionAssociations(events, input.facts),
    inviteAttribution: buildInviteAttribution(events, input.facts)
  };
}

function buildFunnel(freeOpportunityPool: number, events: RevenueEvent[]): FunnelStep[] {
  const counts = [freeOpportunityPool, ...FUNNEL_EVENTS.map(([eventType]) => distinctUsers(events, eventType).size)];
  const labels = ["Active Free users", ...FUNNEL_EVENTS.map(([, label]) => label)];
  const keys = ["active_free", ...FUNNEL_EVENTS.map(([key]) => key)];
  return labels.map((label, index) => {
    const previous = index === 0 ? counts[0] : counts[index - 1];
    return {
      key: keys[index],
      label,
      users: counts[index],
      conversionPercent: index === 0 ? 100 : percent(counts[index], previous),
      dropOffPercent: index === 0 ? 0 : percent(Math.max(0, previous - counts[index]), previous)
    };
  });
}

function buildPlanPerformance(current: RevenueCurrentCounts, events: RevenueEvent[], facts: RevenueFact[]): PlanPerformance[] {
  return (["free", "buddy_plus", "buddy_pro"] as SubscriptionPlan[]).map((plan) => {
    const active = new Set(facts.filter((fact) => fact.subscriptionPlan === plan).map((fact) => fact.userId));
    const revenue: Record<string, number> = {};
    for (const event of events.filter((event) => event.eventType === "payment_succeeded" && event.plan === plan && event.currency && event.amountMinor !== null)) {
      const currency = event.currency!.toUpperCase();
      revenue[currency] = (revenue[currency] ?? 0) + (event.amountMinor ?? 0);
    }
    return {
      plan,
      users: current.planUsers[plan],
      activeUsers: active.size,
      payingUsers: plan === "buddy_plus" ? current.buddyPlusUsers : plan === "buddy_pro" ? current.buddyProUsers : 0,
      revenueByCurrency: revenue,
      cancellations: events.filter((event) => event.eventType === "subscription_cancelled" && event.plan === plan).length,
      featureActions: facts.filter((fact) => fact.subscriptionPlan === plan).reduce((sum, fact) => sum + fact.actionCount, 0)
    };
  });
}

function buildFeaturePlanRows(facts: RevenueFact[]): FeaturePlanRow[] {
  const keys = [...new Set(facts.map((fact) => fact.featureKey).filter((key) => key !== "core"))].sort();
  return keys.map((featureKey) => {
    const values = (plan: SubscriptionPlan) => {
      const selected = facts.filter((fact) => fact.featureKey === featureKey && fact.subscriptionPlan === plan);
      const users = new Set(selected.map((fact) => fact.userId)).size;
      const actions = selected.reduce((sum, fact) => sum + fact.actionCount, 0);
      return { users, perUser: users > 0 ? round(actions / users) : 0 };
    };
    const free = values("free");
    const plus = values("buddy_plus");
    const pro = values("buddy_pro");
    return {
      featureKey,
      freeUsers: free.users,
      plusUsers: plus.users,
      proUsers: pro.users,
      freeActionsPerUser: free.perUser,
      plusActionsPerUser: plus.perUser,
      proActionsPerUser: pro.perUser
    };
  });
}

function buildConversionAssociations(events: RevenueEvent[], facts: RevenueFact[]): ConversionAssociation[] {
  const activations = new Map<string, string>();
  for (const event of events.filter((item) => item.eventType === "subscription_activated" && item.userId)) {
    const current = activations.get(event.userId!);
    if (!current || event.occurredAt < current) activations.set(event.userId!, event.occurredAt);
  }
  const features = [...new Set(facts.map((fact) => fact.featureKey).filter((key) => key !== "core"))].sort();
  return features.map((featureKey) => {
    const usersWithFeature = new Set(
      facts.filter((fact) => {
        const activation = activations.get(fact.userId);
        return activation && fact.featureKey === featureKey && fact.eventDate <= day(activation);
      }).map((fact) => fact.userId)
    );
    return {
      featureKey,
      convertedUsers: activations.size,
      usersWithFeatureBeforeConversion: usersWithFeature.size,
      percent: percent(usersWithFeature.size, activations.size)
    };
  });
}

function buildInviteAttribution(events: RevenueEvent[], facts: RevenueFact[]) {
  const invited = new Set(facts.filter((fact) => fact.eventName === "invite_signup").map((fact) => fact.userId));
  const activated = new Set(events.filter((event) => event.eventType === "subscription_activated" && event.userId).map((event) => event.userId!));
  const activatedInvited = new Set(facts.filter((fact) => fact.eventName === "invite_signup" || fact.eventName === "profile_completed").filter((fact) => invited.has(fact.userId) && fact.eventName === "profile_completed").map((fact) => fact.userId));
  const paidInvited = [...invited].filter((userId) => activated.has(userId)).length;
  return {
    invitedUsers: invited.size,
    activatedInvitedUsers: activatedInvited.size,
    paidInvitedUsers: paidInvited,
    inviteToPaidPercent: percent(paidInvited, invited.size)
  };
}

function distinctUsers(events: RevenueEvent[], eventType: string) {
  return new Set(events.filter((event) => event.eventType === eventType).flatMap((event) => event.userId ? [event.userId] : []));
}

function percent(numerator: number, denominator: number): number | null {
  if (denominator <= 0) return null;
  return round((numerator / denominator) * 100);
}

function round(value: number) {
  return Math.round(value * 10) / 10;
}

function day(value: string) {
  return value.slice(0, 10);
}

function addDays(value: string, amount: number) {
  const date = new Date(`${value}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + amount);
  return date.toISOString().slice(0, 10);
}
