import "server-only";

import { unstable_cache } from "next/cache";
import {
  addUtcDays,
  buildProductAnalyticsReport,
  utcDay,
  type AnalyticsFact,
  type AnalyticsMilestone,
  type AnalyticsPlanFilter,
  type AnalyticsRangeDays,
  type AnalyticsUser,
  type ProductAnalyticsReport
} from "@/lib/analytics/product-analytics";
import { MANAGED_FEATURES, resolveGlobalFeatureFlag, type ManagedFeatureFlagKey } from "@/lib/features/feature-flags";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import type { SubscriptionPlan } from "@/lib/supabase/database.types";
import { legacyTierOf } from "@/lib/supabase/database.types";

const PAGE_SIZE = 1000;

function chunks<T>(values: T[], size: number): T[][] {
  const output: T[][] = [];
  for (let index = 0; index < values.length; index += size) output.push(values.slice(index, index + size));
  return output;
}

async function loadProfiles(rangeStartIso: string) {
  const admin = createSupabaseAdminClient();
  const rows: Array<{ user_id: string; created_at: string }> = [];
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const { data, error } = await admin
      .from("profiles")
      .select("user_id, created_at")
      .is("deleted_at", null)
      .gte("created_at", rangeStartIso)
      .order("created_at", { ascending: true })
      .range(offset, offset + PAGE_SIZE - 1);
    if (error) throw new Error(`Could not load analytics cohorts: ${error.message}`);
    rows.push(...(data ?? []));
    if ((data ?? []).length < PAGE_SIZE) break;
  }
  return rows;
}

async function loadFacts(factsStartDay: string): Promise<AnalyticsFact[]> {
  const admin = createSupabaseAdminClient();
  const rows: AnalyticsFact[] = [];
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const { data, error } = await admin
      .from("analytics_daily_user_facts")
      .select("event_date, user_id, event_name, feature_key, subscription_plan, action_count")
      .gte("event_date", factsStartDay)
      .order("event_date", { ascending: true })
      .range(offset, offset + PAGE_SIZE - 1);
    if (error) throw new Error(`Could not load product activity: ${error.message}`);
    rows.push(
      ...(data ?? []).map((row) => ({
        eventDate: row.event_date,
        userId: row.user_id,
        eventName: row.event_name,
        featureKey: row.feature_key,
        /* Ladder analytics: Access is off-ladder, so it reads as no tier here. The real product is recorded on the billing_events row itself. */
        subscriptionPlan: legacyTierOf(row.subscription_plan),
        actionCount: row.action_count
      }))
    );
    if ((data ?? []).length < PAGE_SIZE) break;
  }
  return rows;
}

async function loadMilestones(userIds: string[]): Promise<AnalyticsMilestone[]> {
  if (userIds.length === 0) return [];
  const admin = createSupabaseAdminClient();
  const rows: AnalyticsMilestone[] = [];
  for (const ids of chunks(userIds, 200)) {
    const { data, error } = await admin
      .from("activation_milestones")
      .select("user_id, milestone, reached_at")
      .in("user_id", ids);
    if (error) throw new Error(`Could not load activation milestones: ${error.message}`);
    rows.push(...(data ?? []).map((row) => ({ userId: row.user_id, milestone: row.milestone, reachedAt: row.reached_at })));
  }
  return rows;
}

async function loadCurrentPlans(userIds: string[]) {
  const plans = new Map<string, SubscriptionPlan>();
  if (userIds.length === 0) return plans;
  const admin = createSupabaseAdminClient();
  for (const ids of chunks(userIds, 200)) {
    const { data, error } = await admin.from("subscriptions").select("user_id, plan").in("user_id", ids);
    if (error) throw new Error(`Could not load subscription segments: ${error.message}`);
    // legacyTierOf: Access is not a rung on the tier ladder, so it reads as no tier here.
    for (const row of data ?? []) plans.set(row.user_id, legacyTierOf(row.plan));
  }
  return plans;
}

async function loadFlagStatuses(): Promise<Partial<Record<ManagedFeatureFlagKey, string>>> {
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("feature_flags")
    .select("key, status, default_value")
    .in("key", MANAGED_FEATURES.map((feature) => feature.key));
  if (error) throw new Error(`Could not load feature status: ${error.message}`);
  return Object.fromEntries(
    (data ?? []).map((row) => [
      row.key,
      resolveGlobalFeatureFlag(row) ? (row.status === "rollout" ? "Rollout" : "Enabled") : "Disabled"
    ])
  ) as Partial<Record<ManagedFeatureFlagKey, string>>;
}

async function loadReport(rangeDays: AnalyticsRangeDays, planFilter: AnalyticsPlanFilter): Promise<ProductAnalyticsReport> {
  const now = new Date();
  const today = utcDay(now);
  const cohortStartDay = addUtcDays(today, -(rangeDays - 1));
  // D30 correlation and previous-30-day trends require activity before the
  // visible cohort window. This remains a compact daily fact query, not a raw
  // event or consumer-table scan.
  const factsStartDay = addUtcDays(today, -120);
  const profiles = await loadProfiles(`${cohortStartDay}T00:00:00.000Z`);
  const cohortUserIds = profiles.map((profile) => profile.user_id);
  const [facts, milestones, flagStatuses] = await Promise.all([
    loadFacts(factsStartDay),
    loadMilestones(cohortUserIds),
    loadFlagStatuses()
  ]);
  const relevantUserIds = [...new Set([...cohortUserIds, ...facts.map((fact) => fact.userId)])];
  const plans = await loadCurrentPlans(relevantUserIds);
  const users: AnalyticsUser[] = profiles.map((profile) => ({
    userId: profile.user_id,
    signupAt: profile.created_at,
    plan: plans.get(profile.user_id) ?? "free"
  }));

  return buildProductAnalyticsReport({
    users,
    milestones,
    facts,
    currentPlanByUser: plans,
    now,
    rangeDays,
    planFilter,
    flagStatuses
  });
}

const cachedReport = unstable_cache(loadReport, ["product-analytics-report-v1"], {
  revalidate: 300,
  tags: ["product-analytics"]
});

/** Five-minute cached Owner/Admin report. Consumer requests never call this. */
export async function getProductAnalyticsReport(
  rangeDays: AnalyticsRangeDays,
  planFilter: AnalyticsPlanFilter
): Promise<ProductAnalyticsReport> {
  return cachedReport(rangeDays, planFilter);
}
