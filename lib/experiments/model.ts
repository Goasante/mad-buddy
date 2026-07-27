import type { SubscriptionPlan } from "@/lib/supabase/database.types";

export const EXPERIMENT_STATUSES = [
  "draft",
  "scheduled",
  "running",
  "paused",
  "completed",
  "cancelled"
] as const;
export type ExperimentStatus = (typeof EXPERIMENT_STATUSES)[number];
export type ExperimentPlatform = "web" | "android" | "ios";
export type ExperimentAudience = "all_eligible" | "selected_testers";

export const EXPERIMENT_METRICS = [
  { key: "activation", label: "Activation", source: "product", events: ["activation"], kind: "binary" },
  { key: "profile_completion", label: "Profile completion", source: "product", events: ["profile_completed"], kind: "binary" },
  { key: "first_muddy", label: "First Muddy added", source: "product", events: ["muddy_added"], kind: "binary" },
  { key: "invite_sent", label: "Invite sent", source: "product", events: ["invite_created"], kind: "binary" },
  { key: "invite_signup", label: "Invite signup", source: "product", events: ["invite_signup"], kind: "binary" },
  {
    key: "meaningful_interaction",
    label: "Meaningful interaction",
    source: "product",
    events: [
      "message_sent",
      "wave_sent",
      "ping_sent",
      "hangout_created",
      "hangout_joined",
      "plan_created",
      "event_created",
      "group_created",
      "socialize_connection",
      "moment_created",
      "safe_arrival_started",
      "safe_arrival_completed"
    ],
    kind: "binary"
  },
  {
    key: "feature_usage",
    label: "Feature usage",
    source: "product",
    events: [
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
    ],
    kind: "binary"
  },
  { key: "socialize_activation", label: "Socialize activation", source: "product", events: ["socialize_enabled"], kind: "binary" },
  { key: "socialize_connection", label: "Socialize connection", source: "product", events: ["socialize_connection"], kind: "binary" },
  {
    key: "notification_permission_accepted",
    label: "Notification permission accepted",
    source: "product",
    events: ["notification_permission_accepted"],
    kind: "binary"
  },
  { key: "d1_retention", label: "D1 retention", source: "retention", events: [], kind: "retention", day: 1 },
  { key: "d7_retention", label: "D7 retention", source: "retention", events: [], kind: "retention", day: 7 },
  { key: "d30_retention", label: "D30 retention", source: "retention", events: [], kind: "retention", day: 30 },
  { key: "checkout_started", label: "Checkout started", source: "billing", events: ["checkout_started"], kind: "binary" },
  { key: "payment_success", label: "Verified payment", source: "billing", events: ["payment_succeeded"], kind: "binary" },
  { key: "paid_conversion", label: "Paid conversion", source: "billing", events: ["subscription_activated"], kind: "binary" },
  { key: "trial_conversion", label: "Trial conversion", source: "trial", events: ["converted"], kind: "binary" },
  { key: "cancellation", label: "Subscription cancellation", source: "billing", events: ["subscription_cancelled"], kind: "binary" },
  { key: "payment_failure", label: "Payment failure", source: "billing", events: ["payment_failed"], kind: "binary" },
  { key: "support_issue", label: "Support issue", source: "support", events: ["created"], kind: "binary" },
  { key: "notification_opt_out", label: "Notification opt-out", source: "notification", events: ["opted_out"], kind: "binary" }
] as const;

export type ExperimentMetricKey = (typeof EXPERIMENT_METRICS)[number]["key"];

export type ExperimentDefinitionInput = {
  key: string;
  name: string;
  description: string;
  hypothesis: string;
  allocationPercentage: number;
  audience: ExperimentAudience;
  platforms: ExperimentPlatform[];
  plans: SubscriptionPlan[];
  conflictGroup: string | null;
  startsAt: string | null;
  endsAt: string | null;
  primaryMetric: ExperimentMetricKey;
  secondaryMetrics: ExperimentMetricKey[];
  guardrailMetrics: ExperimentMetricKey[];
  variants: Array<{
    key: string;
    name: string;
    description: string;
    weightBasisPoints: number;
    isControl: boolean;
  }>;
};

export type ExperimentValidationIssue =
  | "invalid_key"
  | "invalid_dates"
  | "invalid_allocation"
  | "missing_target"
  | "invalid_variants"
  | "invalid_weights"
  | "missing_control"
  | "duplicate_metric";

export function validateExperimentDefinition(input: ExperimentDefinitionInput): ExperimentValidationIssue[] {
  const issues = new Set<ExperimentValidationIssue>();
  if (!/^[a-z][a-z0-9_]{2,63}$/.test(input.key)) issues.add("invalid_key");
  if (input.startsAt && input.endsAt && Date.parse(input.endsAt) <= Date.parse(input.startsAt)) issues.add("invalid_dates");
  if (!Number.isInteger(input.allocationPercentage) || input.allocationPercentage < 1 || input.allocationPercentage > 100) {
    issues.add("invalid_allocation");
  }
  if (input.platforms.length === 0 || input.plans.length === 0) issues.add("missing_target");
  if (input.variants.length < 2 || input.variants.length > 4) issues.add("invalid_variants");
  if (
    input.variants.some(
      (variant) =>
        !/^(control|variant_[a-z0-9_]{1,48})$/.test(variant.key) ||
        !Number.isInteger(variant.weightBasisPoints) ||
        variant.weightBasisPoints < 1
    )
  ) issues.add("invalid_variants");
  if (input.variants.reduce((sum, variant) => sum + variant.weightBasisPoints, 0) !== 10_000) issues.add("invalid_weights");
  if (input.variants.filter((variant) => variant.isControl).length !== 1) issues.add("missing_control");
  const metrics = [input.primaryMetric, ...input.secondaryMetrics, ...input.guardrailMetrics];
  if (new Set(metrics).size !== metrics.length) issues.add("duplicate_metric");
  return [...issues];
}

export type AssignmentDecision =
  | { eligible: true; variantKey: string; reused: boolean }
  | {
      eligible: false;
      reason:
        | "not_running"
        | "parent_disabled"
        | "platform"
        | "plan"
        | "selected_testers"
        | "conflict"
        | "allocation"
        | "invalid_variants";
    };

/** Pure mirror of the database gate, used to keep targeting policy testable.
 * Buckets are injected because PostgreSQL owns canonical deterministic hashing. */
export function decideExperimentAssignment(input: {
  status: ExperimentStatus;
  parentEnabled: boolean;
  platform: ExperimentPlatform;
  targetPlatforms: ExperimentPlatform[];
  plan: SubscriptionPlan;
  targetPlans: SubscriptionPlan[];
  audience: ExperimentAudience;
  selectedTester: boolean;
  hasConflict: boolean;
  allocationPercentage: number;
  allocationBucket: number;
  variantBucket: number;
  variants: Array<{ key: string; weightBasisPoints: number }>;
  existingVariantKey?: string | null;
}): AssignmentDecision {
  if (input.status !== "running") return { eligible: false, reason: "not_running" };
  if (!input.parentEnabled) return { eligible: false, reason: "parent_disabled" };
  if (!input.targetPlatforms.includes(input.platform)) return { eligible: false, reason: "platform" };
  if (input.existingVariantKey) return { eligible: true, variantKey: input.existingVariantKey, reused: true };
  if (!input.targetPlans.includes(input.plan)) return { eligible: false, reason: "plan" };
  if (input.audience === "selected_testers" && !input.selectedTester) {
    return { eligible: false, reason: "selected_testers" };
  }
  if (input.hasConflict) return { eligible: false, reason: "conflict" };
  if (input.allocationBucket >= input.allocationPercentage * 100) return { eligible: false, reason: "allocation" };
  if (
    input.variants.length < 2 ||
    input.variants.reduce((sum, variant) => sum + variant.weightBasisPoints, 0) !== 10_000
  ) return { eligible: false, reason: "invalid_variants" };
  let cumulative = 0;
  for (const variant of [...input.variants].sort((a, b) => a.key.localeCompare(b.key))) {
    cumulative += variant.weightBasisPoints;
    if (input.variantBucket < cumulative) return { eligible: true, variantKey: variant.key, reused: false };
  }
  return { eligible: false, reason: "invalid_variants" };
}

export function shouldRecordFirstExposure(hasExistingExposure: boolean) {
  return !hasExistingExposure;
}

export type ExperimentLifecycleAction =
  | "schedule"
  | "start"
  | "pause"
  | "resume"
  | "stop"
  | "cancel"
  | "emergency_stop";

export function nextExperimentStatus(
  current: ExperimentStatus,
  action: ExperimentLifecycleAction
): ExperimentStatus | null {
  if (action === "schedule" && current === "draft") return "scheduled";
  if (action === "start" && (current === "draft" || current === "scheduled")) return "running";
  if ((action === "pause" || action === "emergency_stop") && current === "running") return "paused";
  if (action === "resume" && current === "paused") return "running";
  if (action === "stop" && (current === "running" || current === "paused")) return "completed";
  if (action === "cancel" && (current === "draft" || current === "scheduled" || current === "paused")) {
    return "cancelled";
  }
  return null;
}

export type ExperimentExposure = {
  userId: string;
  variantKey: string;
  isControl: boolean;
  exposedAt: string;
};

export type ExperimentOutcome = {
  userId: string;
  metricKey: ExperimentMetricKey;
  occurredAt: string;
};

export type ExperimentRevenue = {
  userId: string;
  currency: string;
  amountMinor: number;
  occurredAt: string;
};

export type ExperimentMetricResult = {
  metricKey: ExperimentMetricKey;
  variantKey: string;
  sampleSize: number;
  convertedUsers: number;
  ratePercent: number | null;
  absoluteDifferencePoints: number | null;
  relativeDifferencePercent: number | null;
  confidencePercent: number | null;
  interpretation: "control" | "insufficient_data" | "no_clear_difference" | "higher" | "lower";
};

export type ExperimentRevenueResult = {
  currency: string;
  variantKey: string;
  exposedUsers: number;
  payingUsers: number;
  amountMinor: number;
  amountPerExposedUserMinor: number;
};

export function buildExperimentMetricResults(input: {
  metricKey: ExperimentMetricKey;
  exposures: ExperimentExposure[];
  outcomes: ExperimentOutcome[];
  now: Date;
  startedAt: string;
  matureAfterDays?: number;
}): ExperimentMetricResult[] {
  const matureAfterDays = input.matureAfterDays ?? 0;
  const nowMs = input.now.getTime();
  const eligible = input.exposures.filter(
    (exposure) => nowMs >= Date.parse(exposure.exposedAt) + matureAfterDays * 86_400_000
  );
  const outcomes = new Set(
    input.outcomes
      .filter((outcome) => outcome.metricKey === input.metricKey)
      .filter((outcome) => {
        const exposure = eligible.find((item) => item.userId === outcome.userId);
        return exposure && Date.parse(outcome.occurredAt) >= Date.parse(exposure.exposedAt);
      })
      .map((outcome) => outcome.userId)
  );
  const variants = groupByVariant(eligible);
  const control = [...variants.entries()].find(([, rows]) => rows[0]?.isControl);
  const controlStats = control ? conversionStats(control[1], outcomes) : null;
  const durationDays = Math.max(0, (nowMs - Date.parse(input.startedAt)) / 86_400_000);

  return [...variants.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([variantKey, rows]) => {
      const stats = conversionStats(rows, outcomes);
      if (rows[0]?.isControl || !controlStats) {
        return {
          metricKey: input.metricKey,
          variantKey,
          sampleSize: stats.sample,
          convertedUsers: stats.converted,
          ratePercent: rate(stats.converted, stats.sample),
          absoluteDifferencePoints: rows[0]?.isControl ? 0 : null,
          relativeDifferencePercent: rows[0]?.isControl ? 0 : null,
          confidencePercent: null,
          interpretation: rows[0]?.isControl ? "control" : "insufficient_data"
        };
      }
      const comparison = compareProportions(controlStats, stats, durationDays);
      return {
        metricKey: input.metricKey,
        variantKey,
        sampleSize: stats.sample,
        convertedUsers: stats.converted,
        ratePercent: rate(stats.converted, stats.sample),
        absoluteDifferencePoints: differencePoints(stats, controlStats),
        relativeDifferencePercent: relativeDifference(stats, controlStats),
        confidencePercent: comparison.confidencePercent,
        interpretation: comparison.interpretation
      };
    });
}

export function buildExperimentRevenueResults(input: {
  exposures: ExperimentExposure[];
  revenue: ExperimentRevenue[];
}): ExperimentRevenueResult[] {
  const exposureByUser = new Map(input.exposures.map((exposure) => [exposure.userId, exposure]));
  const groups = new Map<string, { variantKey: string; currency: string; userAmounts: Map<string, number> }>();
  for (const row of input.revenue) {
    const exposure = exposureByUser.get(row.userId);
    if (!exposure || Date.parse(row.occurredAt) < Date.parse(exposure.exposedAt)) continue;
    const currency = row.currency.toUpperCase();
    const key = `${currency}:${exposure.variantKey}`;
    const group = groups.get(key) ?? { variantKey: exposure.variantKey, currency, userAmounts: new Map() };
    group.userAmounts.set(row.userId, (group.userAmounts.get(row.userId) ?? 0) + row.amountMinor);
    groups.set(key, group);
  }
  const exposureCounts = new Map<string, number>();
  for (const exposure of input.exposures) {
    exposureCounts.set(exposure.variantKey, (exposureCounts.get(exposure.variantKey) ?? 0) + 1);
  }
  return [...groups.values()]
    .map((group) => {
      const amountMinor = [...group.userAmounts.values()].reduce((sum, amount) => sum + amount, 0);
      const exposedUsers = exposureCounts.get(group.variantKey) ?? 0;
      return {
        currency: group.currency,
        variantKey: group.variantKey,
        exposedUsers,
        payingUsers: group.userAmounts.size,
        amountMinor,
        amountPerExposedUserMinor: exposedUsers ? Math.round(amountMinor / exposedUsers) : 0
      };
    })
    .sort((a, b) => a.currency.localeCompare(b.currency) || a.variantKey.localeCompare(b.variantKey));
}

function groupByVariant(exposures: ExperimentExposure[]) {
  const groups = new Map<string, ExperimentExposure[]>();
  for (const exposure of exposures) {
    const rows = groups.get(exposure.variantKey) ?? [];
    rows.push(exposure);
    groups.set(exposure.variantKey, rows);
  }
  return groups;
}

function conversionStats(exposures: ExperimentExposure[], outcomes: Set<string>) {
  return {
    sample: exposures.length,
    converted: exposures.filter((exposure) => outcomes.has(exposure.userId)).length
  };
}

function rate(numerator: number, denominator: number) {
  return denominator > 0 ? Math.round((numerator / denominator) * 10_000) / 100 : null;
}

function differencePoints(
  variant: { sample: number; converted: number },
  control: { sample: number; converted: number }
) {
  if (!variant.sample || !control.sample) return null;
  return Math.round(((variant.converted / variant.sample) - (control.converted / control.sample)) * 10_000) / 100;
}

function relativeDifference(
  variant: { sample: number; converted: number },
  control: { sample: number; converted: number }
) {
  if (!variant.sample || !control.sample || control.converted === 0) return null;
  const controlRate = control.converted / control.sample;
  return Math.round((((variant.converted / variant.sample) - controlRate) / controlRate) * 1000) / 10;
}

function compareProportions(
  control: { sample: number; converted: number },
  variant: { sample: number; converted: number },
  durationDays: number
): {
  confidencePercent: number | null;
  interpretation: "insufficient_data" | "no_clear_difference" | "higher" | "lower";
} {
  if (durationDays < 7 || control.sample < 30 || variant.sample < 30) {
    return { confidencePercent: null, interpretation: "insufficient_data" };
  }
  const pooled = (control.converted + variant.converted) / (control.sample + variant.sample);
  const expected = [
    control.sample * pooled,
    control.sample * (1 - pooled),
    variant.sample * pooled,
    variant.sample * (1 - pooled)
  ];
  if (expected.some((value) => value < 5)) return { confidencePercent: null, interpretation: "insufficient_data" };
  const standardError = Math.sqrt(pooled * (1 - pooled) * (1 / control.sample + 1 / variant.sample));
  if (!standardError) return { confidencePercent: null, interpretation: "insufficient_data" };
  const difference = variant.converted / variant.sample - control.converted / control.sample;
  const z = Math.abs(difference / standardError);
  const confidencePercent = Math.round((1 - 2 * (1 - normalCdf(z))) * 10_000) / 100;
  if (confidencePercent < 95) return { confidencePercent, interpretation: "no_clear_difference" };
  return { confidencePercent, interpretation: difference > 0 ? "higher" : "lower" };
}

function normalCdf(value: number) {
  return (1 + erf(value / Math.sqrt(2))) / 2;
}

function erf(value: number) {
  const sign = value < 0 ? -1 : 1;
  const x = Math.abs(value);
  const t = 1 / (1 + 0.3275911 * x);
  const approximation =
    1 -
    (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) *
      t *
      Math.exp(-x * x);
  return sign * approximation;
}
