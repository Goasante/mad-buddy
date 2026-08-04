import type { SubscriptionPlan } from "@/lib/supabase/database.types";
import { ANALYTICS_FEATURE_CATALOG, type ManagedFeatureFlagKey } from "@/lib/features/feature-flags";

export const PRODUCT_EVENT_NAMES = [
  "account_created",
  "profile_completed",
  "muddy_added",
  "friend_request_sent",
  "friend_request_accepted",
  "message_sent",
  "wave_sent",
  "ping_sent",
  "hangout_created",
  "hangout_joined",
  "plan_created",
  "event_created",
  "group_created",
  "socialize_enabled",
  "socialize_connection",
  "moment_created",
  "safe_arrival_started",
  "safe_arrival_completed",
  "achievement_unlocked",
  "invite_created",
  "invite_opened",
  "invite_signup",
  "subscription_started",
  "subscription_cancelled"
  ,"trial_eligible"
  ,"trial_started"
  ,"trial_active"
  ,"trial_ending_soon"
  ,"trial_expired"
  ,"trial_converted"
  ,"trial_cancelled"
  ,"trial_revoked"
  ,"premium_feature_used_during_trial"
  ,"experiment_exposed"
  ,"notification_opt_out"
  ,"activation"
  ,"notification_permission_accepted"
  ,"wallpaper_picker_opened"
  ,"wallpaper_selected"
  ,"premium_wallpaper_attempted"
  ,"custom_wallpaper_uploaded"
  ,"custom_wallpaper_applied"
  // Guided product tours. Tour-level events carry the tour_version uuid as the
  // resource id; step-level events carry the tour_step uuid, because
  // record_product_event dedupes on (event_name, resource_type, resource_id,
  // actor_id) — per-step ids are what make step drop-off measurable.
  ,"tour_shown"
  ,"tour_started"
  ,"tour_step_viewed"
  ,"tour_step_completed"
  ,"tour_skipped"
  ,"tour_completed"
  ,"tour_cta_clicked"
  // Manual replay is deliberately separate from the first-time funnel: a user
  // revisiting the tour must not count as another first-time completion or
  // distort conversion metrics.
  ,"tour_replay_started"
  ,"tour_replay_completed"
  // Moments, Spotlight and Tune In. Resource ids are uuids (the moment, or the
  // creator for a tune-in); caption text is never recorded.
  ,"moment_create_started"
  ,"moment_published"
  ,"moment_viewed"
  ,"moment_reacted"
  ,"moment_reaction_changed"
  ,"moment_deleted"
  ,"moment_expired"
  ,"spotlight_viewed"
  ,"spotlight_publish_attempted"
  ,"spotlight_published"
  // Tune In events carry the CREATOR as the resource. They never identify the
  // viewer to the creator; the actor column is the viewer's own row, which only
  // admin analytics aggregates over.
  ,"tune_in_added"
  ,"tune_in_removed"
  ,"tune_in_from_moment"
  ,"birthday_notification_sent"
  ,"birthday_wish_sent"
  ,"birthday_moment_started"
  ,"birth_date_added"
  ,"birth_date_updated"
  ,"birthday_visibility_changed"
  ,"age_visibility_changed"
  ,"zodiac_visibility_changed"
  ,"earned_plus_unlocked"
  ,"earned_pro_unlocked"
  ,"earned_reward_renewed"
  ,"earned_reward_expired"
  ,"earned_reward_revoked"
] as const;

export type ProductEventName = (typeof PRODUCT_EVENT_NAMES)[number];
export type AnalyticsRangeDays = 7 | 30 | 90;
export type AnalyticsPlanFilter = "all" | SubscriptionPlan;

export const MEANINGFUL_ACTIVITY_EVENTS: ReadonlySet<string> = new Set([
  "message_sent",
  "wave_sent",
  "ping_sent",
  "hangout_created",
  "hangout_joined",
  "plan_created",
  "event_created",
  "group_created",
  "socialize_enabled",
  "socialize_connection",
  "moment_created",
  "safe_arrival_started",
  "safe_arrival_completed"
]);

export type AnalyticsUser = {
  userId: string;
  signupAt: string;
  plan: SubscriptionPlan;
};

export type AnalyticsFact = {
  eventDate: string;
  userId: string;
  eventName: string;
  featureKey: string;
  subscriptionPlan: SubscriptionPlan;
  actionCount: number;
};

export type AnalyticsMilestone = {
  userId: string;
  milestone: string;
  reachedAt: string;
};

export type FunnelStep = {
  key: string;
  label: string;
  count: number;
  conversionPercent: number;
  dropOffPercent: number;
};

export type RetentionMetric = {
  day: 1 | 7 | 30;
  eligibleUsers: number;
  retainedUsers: number;
  percent: number | null;
};

export type FeaturePerformance = {
  key: string;
  title: string;
  activeUsers: number;
  totalActions: number;
  actionsPerUser: number;
  sevenDayActions: number;
  sevenDayTrendPercent: number | null;
  thirtyDayActions: number;
  thirtyDayTrendPercent: number | null;
  d7WithFeature: number | null;
  d7WithoutFeature: number | null;
  retentionAssociation: "higher" | "lower" | "similar" | "insufficient";
  flagStatus: string;
};

export type CohortRow = {
  cohortWeek: string;
  users: number;
  d1: number | null;
  d7: number | null;
  d30: number | null;
};

export type ProductAnalyticsReport = {
  generatedAt: string;
  rangeDays: AnalyticsRangeDays;
  planFilter: AnalyticsPlanFilter;
  trackedUsers: number;
  dau: number;
  wau: number;
  mau: number;
  dauMauRatio: number | null;
  funnel: FunnelStep[];
  retention: RetentionMetric[];
  features: FeaturePerformance[];
  cohorts: CohortRow[];
  dailyActiveUsers: Array<{ date: string; users: number }>;
};

export function utcDay(value: string | Date): string {
  const date = typeof value === "string" ? new Date(value) : value;
  return date.toISOString().slice(0, 10);
}

export function addUtcDays(day: string, amount: number): string {
  const date = new Date(`${day}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + amount);
  return utcDay(date);
}

export function startOfUtcWeek(day: string): string {
  const date = new Date(`${day}T00:00:00.000Z`);
  const daysSinceMonday = (date.getUTCDay() + 6) % 7;
  date.setUTCDate(date.getUTCDate() - daysSinceMonday);
  return utcDay(date);
}

function percent(numerator: number, denominator: number): number | null {
  if (denominator <= 0) return null;
  return Math.round((numerator / denominator) * 1000) / 10;
}

function trend(current: number, previous: number): number | null {
  if (previous === 0) return current === 0 ? 0 : null;
  return Math.round(((current - previous) / previous) * 1000) / 10;
}

function factsInWindow(facts: AnalyticsFact[], startDay: string, endDay: string) {
  return facts.filter((fact) => fact.eventDate >= startDay && fact.eventDate <= endDay);
}

function meaningfulFacts(facts: AnalyticsFact[]) {
  return facts.filter((fact) => MEANINGFUL_ACTIVITY_EVENTS.has(fact.eventName));
}

function distinctUsers(facts: AnalyticsFact[]) {
  return new Set(facts.map((fact) => fact.userId)).size;
}

function actionTotal(facts: AnalyticsFact[]) {
  return facts.reduce((sum, fact) => sum + fact.actionCount, 0);
}

function retentionForDay(
  users: AnalyticsUser[],
  activeDaysByUser: Map<string, Set<string>>,
  today: string,
  day: 1 | 7 | 30
): RetentionMetric {
  const eligible = users.filter((user) => addUtcDays(utcDay(user.signupAt), day) <= today);
  const retained = eligible.filter((user) => activeDaysByUser.get(user.userId)?.has(addUtcDays(utcDay(user.signupAt), day))).length;
  return { day, eligibleUsers: eligible.length, retainedUsers: retained, percent: percent(retained, eligible.length) };
}

function activationFunnel(users: AnalyticsUser[], milestones: AnalyticsMilestone[], facts: AnalyticsFact[]): FunnelStep[] {
  const milestoneByUser = new Map<string, Set<string>>();
  for (const milestone of milestones) {
    const values = milestoneByUser.get(milestone.userId) ?? new Set<string>();
    values.add(milestone.milestone);
    milestoneByUser.set(milestone.userId, values);
  }

  const factsByUser = new Map<string, AnalyticsFact[]>();
  for (const fact of facts) {
    const values = factsByUser.get(fact.userId) ?? [];
    values.push(fact);
    factsByUser.set(fact.userId, values);
  }

  const setup = new Set(users.filter((user) => milestoneByUser.get(user.userId)?.has("profile_completed") || factsByUser.get(user.userId)?.some((fact) => fact.eventName === "profile_completed")).map((user) => user.userId));
  const connected = new Set(users.filter((user) => setup.has(user.userId) && (milestoneByUser.get(user.userId)?.has("first_muddy_added") || factsByUser.get(user.userId)?.some((fact) => fact.eventName === "muddy_added"))).map((user) => user.userId));
  const multiple = new Set(users.filter((user) => connected.has(user.userId) && actionTotal((factsByUser.get(user.userId) ?? []).filter((fact) => fact.eventName === "muddy_added")) >= 2).map((user) => user.userId));
  const activated = new Set(users.filter((user) => multiple.has(user.userId) && (factsByUser.get(user.userId) ?? []).some((fact) => MEANINGFUL_ACTIVITY_EVENTS.has(fact.eventName))).map((user) => user.userId));
  const returning = new Set(users.filter((user) => {
      if (!activated.has(user.userId)) return false;
      const activeDays = new Set(
        (factsByUser.get(user.userId) ?? [])
          .filter((fact) => MEANINGFUL_ACTIVITY_EVENTS.has(fact.eventName))
          .map((fact) => fact.eventDate)
      );
      return activeDays.size >= 2;
    }).map((user) => user.userId));
  const counts = [users.length, setup.size, connected.size, multiple.size, activated.size, returning.size];
  const labels = ["Signup", "Profile completed", "First Muddy", "Multiple Muddies", "First meaningful interaction", "Returning user"];

  return labels.map((label, index) => {
    const previous = index === 0 ? counts[0] : counts[index - 1];
    return {
      key: label.toLowerCase().replaceAll(" ", "_"),
      label,
      count: counts[index],
      conversionPercent: index === 0 ? 100 : (percent(counts[index], previous) ?? 0),
      dropOffPercent: index === 0 ? 0 : (percent(Math.max(0, previous - counts[index]), previous) ?? 0)
    };
  });
}

function featurePerformance(
  users: AnalyticsUser[],
  facts: AnalyticsFact[],
  today: string,
  rangeDays: AnalyticsRangeDays,
  flagStatuses: Partial<Record<ManagedFeatureFlagKey, string>>
): FeaturePerformance[] {
  const rangeStart = addUtcDays(today, -(rangeDays - 1));
  const current7Start = addUtcDays(today, -6);
  const previous7Start = addUtcDays(today, -13);
  const previous7End = addUtcDays(today, -7);
  const current30Start = addUtcDays(today, -29);
  const previous30Start = addUtcDays(today, -59);
  const previous30End = addUtcDays(today, -30);
  const meaningful = meaningfulFacts(facts);
  const activeDaysByUser = new Map<string, Set<string>>();
  for (const fact of meaningful) {
    const days = activeDaysByUser.get(fact.userId) ?? new Set<string>();
    days.add(fact.eventDate);
    activeDaysByUser.set(fact.userId, days);
  }

  return ANALYTICS_FEATURE_CATALOG.map((feature) => {
    const names = new Set<string>(feature.eventNames);
    const featureFacts = facts.filter((fact) => names.has(fact.eventName));
    const ranged = factsInWindow(featureFacts, rangeStart, today);
    const seven = actionTotal(factsInWindow(featureFacts, current7Start, today));
    const previousSeven = actionTotal(factsInWindow(featureFacts, previous7Start, previous7End));
    const thirty = actionTotal(factsInWindow(featureFacts, current30Start, today));
    const previousThirty = actionTotal(factsInWindow(featureFacts, previous30Start, previous30End));

    const eligible = users.filter((user) => addUtcDays(utcDay(user.signupAt), 7) <= today);
    const usedEarly = eligible.filter((user) => {
      const signup = utcDay(user.signupAt);
      const end = addUtcDays(signup, 6);
      return featureFacts.some((fact) => fact.userId === user.userId && fact.eventDate >= signup && fact.eventDate <= end);
    });
    const usedIds = new Set(usedEarly.map((user) => user.userId));
    const notUsed = eligible.filter((user) => !usedIds.has(user.userId));
    const retained = (group: AnalyticsUser[]) =>
      group.filter((user) => activeDaysByUser.get(user.userId)?.has(addUtcDays(utcDay(user.signupAt), 7))).length;
    const withRate = percent(retained(usedEarly), usedEarly.length);
    const withoutRate = percent(retained(notUsed), notUsed.length);
    const association =
      withRate === null || withoutRate === null
        ? "insufficient"
        : withRate > withoutRate
          ? "higher"
          : withRate < withoutRate
            ? "lower"
            : "similar";

    const activeUsers = distinctUsers(ranged);
    return {
      key: feature.key,
      title: feature.title,
      activeUsers,
      totalActions: actionTotal(ranged),
      actionsPerUser: activeUsers > 0 ? Math.round((actionTotal(ranged) / activeUsers) * 10) / 10 : 0,
      sevenDayActions: seven,
      sevenDayTrendPercent: trend(seven, previousSeven),
      thirtyDayActions: thirty,
      thirtyDayTrendPercent: trend(thirty, previousThirty),
      d7WithFeature: withRate,
      d7WithoutFeature: withoutRate,
      retentionAssociation: association,
      flagStatus: feature.flagKey ? flagStatuses[feature.flagKey] ?? "Unavailable" : "Not flag-controlled"
    };
  });
}

function cohortRows(users: AnalyticsUser[], activeDaysByUser: Map<string, Set<string>>, today: string): CohortRow[] {
  const groups = new Map<string, AnalyticsUser[]>();
  for (const user of users) {
    const week = startOfUtcWeek(utcDay(user.signupAt));
    const values = groups.get(week) ?? [];
    values.push(user);
    groups.set(week, values);
  }

  return [...groups.entries()]
    .sort(([a], [b]) => b.localeCompare(a))
    .map(([cohortWeek, members]) => {
      const rate = (day: 1 | 7 | 30) => retentionForDay(members, activeDaysByUser, today, day).percent;
      return { cohortWeek, users: members.length, d1: rate(1), d7: rate(7), d30: rate(30) };
    });
}

export function buildProductAnalyticsReport(input: {
  users: AnalyticsUser[];
  milestones: AnalyticsMilestone[];
  facts: AnalyticsFact[];
  currentPlanByUser?: ReadonlyMap<string, SubscriptionPlan>;
  now: Date;
  rangeDays: AnalyticsRangeDays;
  planFilter: AnalyticsPlanFilter;
  flagStatuses?: Partial<Record<ManagedFeatureFlagKey, string>>;
}): ProductAnalyticsReport {
  const today = utcDay(input.now);
  const cohortPlanByUser = new Map(input.users.map((user) => [user.userId, user.plan]));
  const currentPlan = (userId: string) => input.currentPlanByUser?.get(userId) ?? cohortPlanByUser.get(userId) ?? "free";
  const planMatches = (userId: string) => input.planFilter === "all" || currentPlan(userId) === input.planFilter;
  const selectedUsers = input.users.filter((user) => planMatches(user.userId));
  const cohortIds = new Set(selectedUsers.map((user) => user.userId));
  // Activity metrics include every active account, not only accounts created in
  // the selected cohort window. Funnel and retention remain cohort-scoped.
  const facts = input.facts.filter((fact) => planMatches(fact.userId));
  const cohortFacts = facts.filter((fact) => cohortIds.has(fact.userId));
  const milestones = input.milestones.filter((milestone) => cohortIds.has(milestone.userId));
  const meaningful = meaningfulFacts(facts);
  const activeDaysByUser = new Map<string, Set<string>>();
  for (const fact of meaningful) {
    const days = activeDaysByUser.get(fact.userId) ?? new Set<string>();
    days.add(fact.eventDate);
    activeDaysByUser.set(fact.userId, days);
  }

  const dailyActiveUsers = Array.from({ length: input.rangeDays }, (_, index) => {
    const date = addUtcDays(today, index - (input.rangeDays - 1));
    return { date, users: distinctUsers(meaningful.filter((fact) => fact.eventDate === date)) };
  });
  const dau = distinctUsers(meaningful.filter((fact) => fact.eventDate === today));
  const wau = distinctUsers(factsInWindow(meaningful, addUtcDays(today, -6), today));
  const mau = distinctUsers(factsInWindow(meaningful, addUtcDays(today, -29), today));

  return {
    generatedAt: input.now.toISOString(),
    rangeDays: input.rangeDays,
    planFilter: input.planFilter,
    trackedUsers: selectedUsers.length,
    dau,
    wau,
    mau,
    dauMauRatio: mau > 0 ? Math.round((dau / mau) * 1000) / 10 : null,
    funnel: activationFunnel(selectedUsers, milestones, cohortFacts),
    retention: [1, 7, 30].map((day) => retentionForDay(selectedUsers, activeDaysByUser, today, day as 1 | 7 | 30)),
    features: featurePerformance(selectedUsers, facts, today, input.rangeDays, input.flagStatuses ?? {}),
    cohorts: cohortRows(selectedUsers, activeDaysByUser, today),
    dailyActiveUsers
  };
}
