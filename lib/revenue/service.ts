import "server-only";

import { unstable_cache } from "next/cache";
import { paystackPlans } from "@/lib/paystack/config";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import {
  buildRevenueReport,
  type RevenueCurrentCounts,
  type RevenueEvent,
  type RevenueFact,
  type RevenueRangeDays,
  type RevenueReport
} from "@/lib/revenue/revenue-intelligence";
import type { SubscriptionPlan } from "@/lib/supabase/database.types";
import { legacyTierOf } from "@/lib/supabase/database.types";
import { PLAN_ENTITLEMENTS, type BooleanEntitlementKey } from "@/lib/billing/entitlements";
import {
  buildMonthlyRetention,
  buildUnitEconomics,
  classifyR2Migration,
  evaluateBusinessAlerts,
  type BusinessAlert,
  type BusinessAlertRule,
  type CurrencyUnitEconomics,
  type FinancialSnapshotRow,
  type MonthlyRetention
} from "@/lib/revenue/financial-intelligence";

const PAGE_SIZE = 1000;

export type MediaStorageRow = {
  contextType: string;
  contentType: string;
  objects: number;
  originalBytes: number;
  variantBytes: number;
};

export type RevenueDashboardData = {
  report: RevenueReport;
  mediaStorage: MediaStorageRow[];
  cancellationReasons: Array<{ reason: string; count: number }>;
  entitlementPerformance: Array<{
    key: BooleanEntitlementKey;
    plans: SubscriptionPlan[];
    entitledUsers: number;
    usageUsers: null;
  }>;
  cohorts: Array<{
    cohortWeek: string;
    users: number;
    paidUsers: number;
    paidConversionPercent: number | null;
    eligible30Users: number;
    eligible90Users: number;
    revenue30ByCurrency: Record<string, number>;
    revenue90ByCurrency: Record<string, number>;
  }>;
  financialSnapshots: FinancialSnapshotRow[];
  monthlyRetention: MonthlyRetention[];
  unitEconomics: CurrencyUnitEconomics[];
  providerCosts: Array<{
    id: string;
    provider: string;
    billingPeriod: string;
    currency: string;
    amountMinor: number;
    category: string;
    source: string;
    notes: string | null;
  }>;
  businessAlertRules: BusinessAlertRule[];
  businessAlerts: BusinessAlert[];
  reconciliationIssues: FinancialSnapshotRow[];
  lifecycleMovementsTrusted: boolean;
  activeUsers: number;
  r2Monitoring: {
    status: "NOT NEEDED" | "REVIEW" | "RECOMMENDED";
    storedBytes: number;
    reviewAtBytes: number;
    recommendAtBytes: number;
    bandwidthBytes: null;
    estimatedMonthlyReads: null;
  };
};

async function loadBillingEvents(startIso: string): Promise<RevenueEvent[]> {
  const admin = createSupabaseAdminClient();
  const rows: RevenueEvent[] = [];
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const { data, error } = await admin
      .from("billing_events")
      .select("event_type, user_id, subscription_plan, previous_plan, amount_minor, provider_fee_minor, net_amount_minor, fee_status, currency, occurred_at")
      .gte("occurred_at", startIso)
      .order("occurred_at", { ascending: true })
      .range(offset, offset + PAGE_SIZE - 1);
    if (error) throw new Error(`Could not load billing events: ${error.message}`);
    rows.push(...(data ?? []).map((row) => ({
      eventType: row.event_type,
      userId: row.user_id,
      /* Ladder analytics: Access is off-ladder here. The real product stays recorded on the billing_events row. */
      plan: legacyTierOf(row.subscription_plan),
      previousPlan: row.previous_plan,
      amountMinor: row.amount_minor,
      providerFeeMinor: row.provider_fee_minor,
      netAmountMinor: row.net_amount_minor,
      feeStatus: row.fee_status,
      currency: row.currency,
      occurredAt: row.occurred_at
    })));
    if ((data ?? []).length < PAGE_SIZE) break;
  }
  return rows;
}

async function loadManualSubscriptionChanges(startIso: string): Promise<RevenueEvent[]> {
  const admin = createSupabaseAdminClient();
  const rows: RevenueEvent[] = [];
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const { data, error } = await admin
      .from("subscription_changes")
      .select("user_id, change_type, from_plan, to_plan, requested_at, effective_at, applied_at, status")
      .gte("requested_at", startIso)
      .in("status", ["applied", "scheduled"])
      .order("requested_at", { ascending: true })
      .range(offset, offset + PAGE_SIZE - 1);
    if (error) throw new Error(`Could not load subscription changes: ${error.message}`);
    for (const row of data ?? []) {
      const eventType = row.change_type === "upgrade" ? "plan_upgraded" : row.change_type === "downgrade" ? "plan_downgraded" : row.change_type === "cancel" ? "subscription_cancelled" : null;
      if (!eventType) continue;
      rows.push({
        eventType,
        userId: row.user_id,
        plan: row.to_plan,
        previousPlan: row.from_plan,
        amountMinor: null,
        currency: null,
        occurredAt: row.applied_at ?? row.effective_at ?? row.requested_at
      });
    }
    if ((data ?? []).length < PAGE_SIZE) break;
  }
  return rows;
}

async function loadProductFacts(startDay: string): Promise<RevenueFact[]> {
  const admin = createSupabaseAdminClient();
  const rows: RevenueFact[] = [];
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const { data, error } = await admin
      .from("analytics_daily_user_facts")
      .select("event_date, user_id, event_name, feature_key, subscription_plan, action_count")
      .gte("event_date", startDay)
      .order("event_date", { ascending: true })
      .range(offset, offset + PAGE_SIZE - 1);
    if (error) throw new Error(`Could not load subscription feature usage: ${error.message}`);
    rows.push(...(data ?? []).map((row) => ({
      eventDate: row.event_date,
      userId: row.user_id,
      eventName: row.event_name,
      featureKey: row.feature_key,
      /* Ladder analytics: Access is off-ladder here. */
      subscriptionPlan: legacyTierOf(row.subscription_plan),
      actionCount: row.action_count
    })));
    if ((data ?? []).length < PAGE_SIZE) break;
  }
  return rows;
}

async function loadSignupUsers(startIso: string) {
  const admin = createSupabaseAdminClient();
  const rows: Array<{ userId: string; signupAt: string }> = [];
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const { data, error } = await admin
      .from("profiles")
      .select("user_id, created_at")
      .is("deleted_at", null)
      .gte("created_at", startIso)
      .order("created_at", { ascending: true })
      .range(offset, offset + PAGE_SIZE - 1);
    if (error) throw new Error(`Could not load revenue cohorts: ${error.message}`);
    rows.push(...(data ?? []).map((row) => ({ userId: row.user_id, signupAt: row.created_at })));
    if ((data ?? []).length < PAGE_SIZE) break;
  }
  return rows;
}

async function loadCurrentCounts(nowIso: string): Promise<RevenueCurrentCounts> {
  const admin = createSupabaseAdminClient();
  const [{ count: totalUsers, error: profileError }, snapshotResult] = await Promise.all([
    admin.from("profiles").select("user_id", { count: "exact", head: true }).is("deleted_at", null),
    admin.rpc("get_revenue_subscription_snapshot", { p_now: nowIso })
  ]);
  if (profileError) throw new Error(`Could not count accounts: ${profileError.message}`);
  if (snapshotResult.error) throw new Error(`Could not load subscription snapshot: ${snapshotResult.error.message}`);

  const planUsers: Record<SubscriptionPlan, number> = { free: 0, buddy_plus: 0, buddy_pro: 0 };
  let plus = 0;
  let pro = 0;
  let grace = 0;
  let expiredGrace = 0;
  for (const row of snapshotResult.data ?? []) {
    const count = Number(row.user_count);
    planUsers[row.stored_plan] += count;
    if (row.effective_plan === "buddy_plus") plus += count;
    if (row.effective_plan === "buddy_pro") pro += count;
    if (row.in_grace) grace += count;
    if (row.grace_expired) expiredGrace += count;
  }
  const users = totalUsers ?? 0;
  return {
    totalUsers: users,
    activePayingUsers: plus + pro,
    freeUsers: Math.max(0, users - plus - pro),
    buddyPlusUsers: plus,
    buddyProUsers: pro,
    graceUsers: grace,
    expiredGraceUsers: expiredGrace,
    planUsers: {
      free: Math.max(planUsers.free, users - planUsers.buddy_plus - planUsers.buddy_pro),
      buddy_plus: planUsers.buddy_plus,
      buddy_pro: planUsers.buddy_pro
    }
  };
}

async function loadMediaStorage(): Promise<MediaStorageRow[]> {
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin.rpc("get_admin_media_storage_summary");
  if (error) throw new Error(`Could not load media usage: ${error.message}`);
  return (data ?? []).map((row) => ({
    contextType: row.context_type,
    contentType: row.content_type,
    objects: Number(row.object_count),
    originalBytes: Number(row.original_bytes),
    variantBytes: Number(row.variant_bytes)
  }));
}

async function loadCancellationReasons(startIso: string) {
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin.rpc("get_cancellation_reason_counts", { p_since: startIso });
  if (error) throw new Error(`Could not load cancellation reasons: ${error.message}`);
  return (data ?? []).map((row) => ({ reason: row.reason, count: Number(row.count) }));
}

async function loadFinancialSnapshots(startDay: string): Promise<FinancialSnapshotRow[]> {
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("financial_snapshots")
    .select(
      "snapshot_date, currency, opening_mrr_minor, new_mrr_minor, expansion_mrr_minor, reactivation_mrr_minor, contraction_mrr_minor, churned_mrr_minor, ending_mrr_minor, reconciliation_status, reconciliation_reason, reconciliation_difference_minor"
    )
    .gte("snapshot_date", startDay)
    .order("snapshot_date", { ascending: true })
    .limit(2000);
  if (error) throw new Error(`Could not load financial snapshots: ${error.message}`);
  return (data ?? []).map((row) => ({
    snapshotDate: row.snapshot_date,
    currency: row.currency,
    openingMrrMinor: row.opening_mrr_minor,
    newMrrMinor: row.new_mrr_minor,
    expansionMrrMinor: row.expansion_mrr_minor,
    reactivationMrrMinor: row.reactivation_mrr_minor,
    contractionMrrMinor: row.contraction_mrr_minor,
    churnedMrrMinor: row.churned_mrr_minor,
    endingMrrMinor: row.ending_mrr_minor,
    reconciliationStatus: row.reconciliation_status,
    reconciliationReason: row.reconciliation_reason,
    reconciliationDifferenceMinor: row.reconciliation_difference_minor
  }));
}

async function loadProviderCosts(startMonth: string) {
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("provider_cost_records")
    .select("id, provider, billing_period, currency, amount_minor, category, source, notes")
    .gte("billing_period", `${startMonth}-01`)
    .order("billing_period", { ascending: false })
    .order("provider", { ascending: true })
    .limit(1000);
  if (error) throw new Error(`Could not load provider costs: ${error.message}`);
  return (data ?? []).map((row) => ({
    id: row.id,
    provider: row.provider,
    billingPeriod: row.billing_period,
    currency: row.currency,
    amountMinor: row.amount_minor,
    category: row.category,
    source: row.source,
    notes: row.notes
  }));
}

async function loadBusinessAlertRules(): Promise<BusinessAlertRule[]> {
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("business_alert_rules")
    .select("rule_key, enabled, threshold_percent")
    .order("rule_key", { ascending: true });
  if (error) throw new Error(`Could not load business alert controls: ${error.message}`);
  return (data ?? []).map((row) => ({
    ruleKey: row.rule_key,
    enabled: row.enabled,
    thresholdPercent: Number(row.threshold_percent)
  }));
}

function entitlementPerformance(current: RevenueCurrentCounts): RevenueDashboardData["entitlementPerformance"] {
  const keys = Object.keys(PLAN_ENTITLEMENTS.buddy_pro).filter((key): key is BooleanEntitlementKey => typeof PLAN_ENTITLEMENTS.buddy_pro[key as keyof typeof PLAN_ENTITLEMENTS.buddy_pro] === "boolean");
  return keys.map((key) => {
    const plans = (["free", "buddy_plus", "buddy_pro"] as SubscriptionPlan[]).filter((plan) => PLAN_ENTITLEMENTS[plan][key]);
    const entitledUsers = plans.reduce((sum, plan) => sum + (plan === "free" ? current.freeUsers : plan === "buddy_plus" ? current.buddyPlusUsers : current.buddyProUsers), 0);
    return { key, plans, entitledUsers, usageUsers: null };
  });
}

function buildRevenueCohorts(
  users: Array<{ userId: string; signupAt: string }>,
  events: RevenueEvent[],
  now: Date
): RevenueDashboardData["cohorts"] {
  const groups = new Map<string, typeof users>();
  for (const user of users) {
    const date = new Date(user.signupAt);
    const daysFromMonday = (date.getUTCDay() + 6) % 7;
    date.setUTCDate(date.getUTCDate() - daysFromMonday);
    const week = date.toISOString().slice(0, 10);
    const members = groups.get(week) ?? [];
    members.push(user);
    groups.set(week, members);
  }
  return [...groups.entries()].sort(([a], [b]) => b.localeCompare(a)).map(([cohortWeek, members]) => {
    const ids = new Set(members.map((member) => member.userId));
    const paid = new Set(events.filter((event) => event.eventType === "subscription_activated" && event.userId && ids.has(event.userId)).map((event) => event.userId!));
    const eligible30 = members.filter((member) => Date.parse(member.signupAt) + 30 * 86_400_000 <= now.getTime());
    const eligible90 = members.filter((member) => Date.parse(member.signupAt) + 90 * 86_400_000 <= now.getTime());
    const revenue = (days: number, eligible: typeof users) => {
      const output: Record<string, number> = {};
      const signupByUser = new Map(eligible.map((member) => [member.userId, Date.parse(member.signupAt)]));
      for (const event of events) {
        if (event.eventType !== "payment_succeeded" || !event.userId || !event.currency || event.amountMinor === null) continue;
        const signup = signupByUser.get(event.userId);
        if (signup === undefined) continue;
        const occurred = Date.parse(event.occurredAt);
        if (occurred < signup || occurred > signup + days * 86_400_000) continue;
        const currency = event.currency.toUpperCase();
        output[currency] = (output[currency] ?? 0) + event.amountMinor;
      }
      return output;
    };
    return {
      cohortWeek,
      users: members.length,
      paidUsers: paid.size,
      paidConversionPercent: members.length ? Math.round((paid.size / members.length) * 1000) / 10 : null,
      eligible30Users: eligible30.length,
      eligible90Users: eligible90.length,
      revenue30ByCurrency: revenue(30, eligible30),
      revenue90ByCurrency: revenue(90, eligible90)
    };
  });
}

async function loadRevenueDashboard(rangeDays: RevenueRangeDays): Promise<RevenueDashboardData> {
  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  const start = new Date(`${today}T00:00:00.000Z`);
  start.setUTCDate(start.getUTCDate() - (rangeDays - 1));
  const previousStart = new Date(start);
  previousStart.setUTCDate(previousStart.getUTCDate() - rangeDays);
  const startDay = start.toISOString().slice(0, 10);
  const snapshotStart = new Date(`${today}T00:00:00.000Z`);
  snapshotStart.setUTCDate(snapshotStart.getUTCDate() - 400);
  const [currentCounts, billingEvents, manualChanges, facts, mediaStorage, cancellationReasons, signupUsers, financialSnapshots, providerCosts, businessAlertRules] = await Promise.all([
    loadCurrentCounts(now.toISOString()),
    loadBillingEvents(previousStart.toISOString()),
    loadManualSubscriptionChanges(start.toISOString()),
    loadProductFacts(startDay),
    loadMediaStorage(),
    loadCancellationReasons(start.toISOString()),
    loadSignupUsers(start.toISOString()),
    loadFinancialSnapshots(snapshotStart.toISOString().slice(0, 10)),
    loadProviderCosts(snapshotStart.toISOString().slice(0, 7)),
    loadBusinessAlertRules()
  ]);
  const events = [...billingEvents, ...manualChanges];
  const report = buildRevenueReport({
    currentCounts,
    events,
    facts,
    planPrices: [
      { plan: "buddy_plus", amountMinor: paystackPlans.plus.amount, currency: paystackPlans.plus.currency },
      { plan: "buddy_pro", amountMinor: paystackPlans.pro.amount, currency: paystackPlans.pro.currency }
    ],
    now,
    rangeDays
  });
  const currentBillingEvents = billingEvents.filter((event) => Date.parse(event.occurredAt) >= start.getTime() && Date.parse(event.occurredAt) <= now.getTime());
  const previousBillingEvents = billingEvents.filter((event) => Date.parse(event.occurredAt) >= previousStart.getTime() && Date.parse(event.occurredAt) < start.getTime());
  const activeUsers = new Set(facts.map((fact) => fact.userId)).size;
  const rangeCosts = providerCosts.filter((cost) => cost.billingPeriod.slice(0, 7) >= startDay.slice(0, 7));
  const unitEconomics = buildUnitEconomics({
    payments: currentBillingEvents.filter((event) => event.eventType === "payment_succeeded" && event.amountMinor !== null && event.currency).map((event) => ({
      userId: event.userId,
      amountMinor: event.amountMinor!,
      providerFeeMinor: event.providerFeeMinor ?? null,
      currency: event.currency!
    })),
    providerCosts: rangeCosts.map((cost) => ({ amountMinor: cost.amountMinor, currency: cost.currency })),
    activeUsers
  });
  const currentMonth = today.slice(0, 7);
  const previousMonthDate = new Date(`${currentMonth}-01T00:00:00.000Z`);
  previousMonthDate.setUTCMonth(previousMonthDate.getUTCMonth() - 1);
  const previousMonth = previousMonthDate.toISOString().slice(0, 7);
  const currentLifecycle = lifecycleWindow(currentBillingEvents);
  const previousLifecycle = lifecycleWindow(previousBillingEvents);
  const alertSnapshotStart = previousStart.toISOString().slice(0, 10);
  const alertSnapshots = financialSnapshots.filter((snapshot) => snapshot.snapshotDate >= alertSnapshotStart);
  const lifecycleMovementsTrusted =
    alertSnapshots.length > 0 &&
    alertSnapshots.every((snapshot) => snapshot.reconciliationStatus === "reconciled");
  const businessAlerts = evaluateBusinessAlerts({
    rules: businessAlertRules,
    snapshots: financialSnapshots,
    current: currentLifecycle,
    previous: previousLifecycle,
    lifecycleMovementsTrusted,
    currentCosts: providerCosts.filter((cost) => cost.billingPeriod.startsWith(currentMonth)).map((cost) => ({ amountMinor: cost.amountMinor, currency: cost.currency })),
    previousCosts: providerCosts.filter((cost) => cost.billingPeriod.startsWith(previousMonth)).map((cost) => ({ amountMinor: cost.amountMinor, currency: cost.currency }))
  });
  const storedBytes = mediaStorage.reduce((sum, row) => sum + row.originalBytes + row.variantBytes, 0);
  const reviewAtBytes = gbThreshold("R2_REVIEW_STORAGE_GB", 100);
  const recommendAtBytes = Math.max(reviewAtBytes, gbThreshold("R2_RECOMMEND_STORAGE_GB", 1000));

  return {
    report,
    mediaStorage,
    cancellationReasons,
    entitlementPerformance: entitlementPerformance(currentCounts),
    cohorts: buildRevenueCohorts(signupUsers, events, now),
    financialSnapshots,
    monthlyRetention: buildMonthlyRetention(financialSnapshots),
    unitEconomics,
    providerCosts,
    businessAlertRules,
    businessAlerts,
    reconciliationIssues: financialSnapshots
      .filter((snapshot) => snapshot.reconciliationStatus === "reconciliation_required")
      .sort((a, b) => b.snapshotDate.localeCompare(a.snapshotDate) || a.currency.localeCompare(b.currency))
      .slice(0, 24),
    lifecycleMovementsTrusted,
    activeUsers,
    r2Monitoring: {
      status: classifyR2Migration({ storedBytes, reviewAtBytes, recommendAtBytes }),
      storedBytes,
      reviewAtBytes,
      recommendAtBytes,
      bandwidthBytes: null,
      estimatedMonthlyReads: null
    }
  };
}

function lifecycleWindow(events: RevenueEvent[]) {
  const cancellations = new Set(events.filter((event) => event.eventType === "subscription_cancelled").flatMap((event) => event.userId ? [event.userId] : [])).size;
  const failedPayments = events.filter((event) => event.eventType === "payment_failed").length;
  const recovered = events.filter((event) => event.eventType === "payment_recovered").length;
  return {
    cancellations,
    failedPayments,
    recoveryRatePercent: failedPayments > 0 ? Math.round((recovered / failedPayments) * 1000) / 10 : null
  };
}

function gbThreshold(key: string, fallbackGb: number) {
  const configured = Number(process.env[key]);
  const gb = Number.isFinite(configured) && configured > 0 ? configured : fallbackGb;
  return Math.round(gb * 1024 * 1024 * 1024);
}

const cachedRevenueDashboard = unstable_cache(loadRevenueDashboard, ["revenue-dashboard-v2"], {
  revalidate: 300,
  tags: ["revenue-dashboard"]
});

export async function getRevenueDashboard(rangeDays: RevenueRangeDays) {
  return cachedRevenueDashboard(rangeDays);
}
