import "server-only";

import {
  EXPERIMENT_METRICS,
  buildExperimentMetricResults,
  buildExperimentRevenueResults,
  type ExperimentExposure,
  type ExperimentMetricKey,
  type ExperimentMetricResult,
  type ExperimentOutcome,
  type ExperimentRevenue,
  type ExperimentRevenueResult
} from "@/lib/experiments/model";
import type { createSupabaseAdminClient } from "@/lib/supabase/admin";

type Admin = ReturnType<typeof createSupabaseAdminClient>;
const PAGE_SIZE = 1000;

export type ExperimentResultsReport = {
  generatedAt: string;
  durationDays: number;
  exposureCount: number;
  assignmentCount: number;
  primary: ExperimentMetricResult[];
  secondary: Array<{ metricKey: ExperimentMetricKey; rows: ExperimentMetricResult[] }>;
  guardrails: Array<{ metricKey: ExperimentMetricKey; rows: ExperimentMetricResult[] }>;
  revenue: ExperimentRevenueResult[];
  warning: string | null;
};

export async function getExperimentResults(
  admin: Admin,
  experimentId: string
): Promise<ExperimentResultsReport> {
  const { data: experiment, error: experimentError } = await admin
    .from("experiments")
    .select("id, status, started_at, starts_at, ends_at, completed_at, created_at, primary_metric, secondary_metrics, guardrail_metrics")
    .eq("id", experimentId)
    .maybeSingle();
  if (experimentError || !experiment) throw new Error("Experiment results could not be loaded.");

  const [variantResult, exposureRows, assignmentResult] = await Promise.all([
    admin.from("experiment_variants").select("id, key, is_control").eq("experiment_id", experimentId),
    loadPaged(async (from, to) =>
      admin
        .from("experiment_exposures")
        .select("id, user_id, variant_id, first_exposed_at")
        .eq("experiment_id", experimentId)
        .order("first_exposed_at", { ascending: true })
        .range(from, to)
    ),
    admin.from("experiment_assignments").select("id", { count: "exact", head: true }).eq("experiment_id", experimentId)
  ]);
  if (variantResult.error || assignmentResult.error) throw new Error("Experiment cohorts could not be loaded.");
  const variants = new Map((variantResult.data ?? []).map((variant) => [variant.id, variant]));
  const exposures: ExperimentExposure[] = exposureRows.flatMap((row) => {
    const variant = variants.get(row.variant_id);
    return variant
      ? [{
          userId: row.user_id ?? `deleted:${row.id}`,
          variantKey: variant.key,
          isControl: variant.is_control,
          exposedAt: row.first_exposed_at
        }]
      : [];
  });
  const userIds = [...new Set(exposures.map((exposure) => exposure.userId).filter((userId) => !userId.startsWith("deleted:")))];
  const metricKeys = [
    experiment.primary_metric,
    ...experiment.secondary_metrics,
    ...experiment.guardrail_metrics
  ].filter(isMetricKey);
  const endAt = experiment.completed_at ?? experiment.ends_at ?? new Date().toISOString();
  const outcomes = await loadOutcomes(admin, userIds, exposures, metricKeys, endAt);
  const now = new Date();
  const startedAt = experiment.started_at ?? experiment.starts_at ?? experiment.created_at ?? now.toISOString();
  const reportingEndMs = Math.min(
    now.getTime(),
    Date.parse(experiment.completed_at ?? experiment.ends_at ?? now.toISOString())
  );
  const rowsFor = (metricKey: ExperimentMetricKey) => {
    const metric = EXPERIMENT_METRICS.find((item) => item.key === metricKey);
    const matureAfterDays = metric && "day" in metric ? metric.day : 0;
    return buildExperimentMetricResults({
      metricKey,
      exposures,
      outcomes,
      now,
      startedAt,
      matureAfterDays
    });
  };
  const revenue = await loadTrustedRevenue(admin, userIds, exposures, endAt);
  const primaryKey = isMetricKey(experiment.primary_metric) ? experiment.primary_metric : null;

  return {
    generatedAt: now.toISOString(),
    durationDays: Math.max(0, Math.floor((reportingEndMs - Date.parse(startedAt)) / 86_400_000)),
    exposureCount: exposures.length,
    assignmentCount: assignmentResult.count ?? 0,
    primary: primaryKey ? rowsFor(primaryKey) : [],
    secondary: experiment.secondary_metrics.filter(isMetricKey).map((metricKey) => ({ metricKey, rows: rowsFor(metricKey) })),
    guardrails: experiment.guardrail_metrics.filter(isMetricKey).map((metricKey) => ({ metricKey, rows: rowsFor(metricKey) })),
    revenue: buildExperimentRevenueResults({ exposures, revenue }),
    warning:
      exposures.length === 0
        ? "No actual exposures have been recorded. Assignment alone is not counted."
        : primaryKey
          ? null
          : "The configured primary metric is not available in the current metric catalog."
  };
}

async function loadOutcomes(
  admin: Admin,
  userIds: string[],
  exposures: ExperimentExposure[],
  metricKeys: ExperimentMetricKey[],
  endAt: string
): Promise<ExperimentOutcome[]> {
  if (!userIds.length) return [];
  const firstExposure = exposures.reduce(
    (earliest, exposure) => exposure.exposedAt < earliest ? exposure.exposedAt : earliest,
    exposures[0]!.exposedAt
  );
  const outcomes: ExperimentOutcome[] = [];
  const productMetrics = metricKeys.filter((key) => metric(key)?.source === "product" || metric(key)?.source === "notification");
  const productEvents = [...new Set(productMetrics.flatMap((key) => metric(key)?.events ?? []))];
  if (productEvents.length) {
    for (const ids of chunks(userIds, 200)) {
      const { data, error } = await admin
        .from("domain_events")
        .select("actor_id, event_type, occurred_at")
        .in("actor_id", ids)
        .in("event_type", productEvents)
        .gte("occurred_at", firstExposure)
        .lte("occurred_at", endAt);
      if (error) throw new Error("Product outcomes could not be loaded.");
      for (const row of data ?? []) {
        if (!row.actor_id) continue;
        for (const key of productMetrics) {
          if (metric(key)?.events.includes(row.event_type as never)) {
            outcomes.push({ userId: row.actor_id, metricKey: key, occurredAt: row.occurred_at });
          }
        }
      }
    }
  }

  const billingMetrics = metricKeys.filter((key) => metric(key)?.source === "billing");
  const billingEvents = [...new Set(billingMetrics.flatMap((key) => metric(key)?.events ?? []))];
  if (billingEvents.length) {
    for (const ids of chunks(userIds, 200)) {
      const { data, error } = await admin
        .from("billing_events")
        .select("user_id, event_type, occurred_at")
        .in("user_id", ids)
        .in("event_type", billingEvents as never[])
        .gte("occurred_at", firstExposure)
        .lte("occurred_at", endAt);
      if (error) throw new Error("Billing outcomes could not be loaded.");
      for (const row of data ?? []) {
        if (!row.user_id) continue;
        for (const key of billingMetrics) {
          if (metric(key)?.events.includes(row.event_type as never)) {
            outcomes.push({ userId: row.user_id, metricKey: key, occurredAt: row.occurred_at });
          }
        }
      }
    }
  }

  if (metricKeys.includes("trial_conversion")) {
    for (const ids of chunks(userIds, 200)) {
      const { data, error } = await admin
        .from("premium_trial_events")
        .select("user_id, occurred_at")
        .in("user_id", ids)
        .eq("event_type", "converted")
        .gte("occurred_at", firstExposure)
        .lte("occurred_at", endAt);
      if (error) throw new Error("Trial outcomes could not be loaded.");
      outcomes.push(...(data ?? []).map((row) => ({
        userId: row.user_id,
        metricKey: "trial_conversion" as const,
        occurredAt: row.occurred_at
      })));
    }
  }

  if (metricKeys.includes("support_issue")) {
    for (const ids of chunks(userIds, 200)) {
      const { data, error } = await admin
        .from("support_tickets")
        .select("user_id, created_at")
        .in("user_id", ids)
        .gte("created_at", firstExposure)
        .lte("created_at", endAt);
      if (error) throw new Error("Support guardrails could not be loaded.");
      outcomes.push(...(data ?? []).flatMap((row) => row.user_id ? [{
        userId: row.user_id,
        metricKey: "support_issue" as const,
        occurredAt: row.created_at
      }] : []));
    }
  }

  const retentionKeys = metricKeys.filter((key) => metric(key)?.source === "retention");
  if (retentionKeys.length) {
    const factStart = firstExposure.slice(0, 10);
    for (const ids of chunks(userIds, 200)) {
      const { data, error } = await admin
        .from("analytics_daily_user_facts")
        .select("user_id, event_date, event_name")
        .in("user_id", ids)
        .gte("event_date", factStart)
        .lte("event_date", endAt.slice(0, 10));
      if (error) throw new Error("Retention outcomes could not be loaded.");
      for (const key of retentionKeys) {
        const definition = metric(key);
        const day = definition && "day" in definition ? definition.day : 0;
        for (const exposure of exposures.filter((row) => ids.includes(row.userId))) {
          const expectedDay = addDays(exposure.exposedAt.slice(0, 10), day);
          if ((data ?? []).some((row) =>
            row.user_id === exposure.userId &&
            row.event_date === expectedDay &&
            MEANINGFUL_OUTCOME_EVENTS.has(row.event_name)
          )) {
            outcomes.push({
              userId: exposure.userId,
              metricKey: key,
              occurredAt: `${expectedDay}T00:00:00.000Z`
            });
          }
        }
      }
    }
  }
  return outcomes;
}

async function loadTrustedRevenue(
  admin: Admin,
  userIds: string[],
  exposures: ExperimentExposure[],
  endAt: string
): Promise<ExperimentRevenue[]> {
  if (!userIds.length) return [];
  const startAt = exposures.reduce(
    (earliest, exposure) => exposure.exposedAt < earliest ? exposure.exposedAt : earliest,
    exposures[0]!.exposedAt
  );
  const rows: ExperimentRevenue[] = [];
  for (const ids of chunks(userIds, 200)) {
    const { data, error } = await admin
      .from("billing_events")
      .select("user_id, amount_minor, currency, occurred_at")
      .in("user_id", ids)
      .eq("event_type", "payment_succeeded")
      .in("source", ["paystack_webhook", "paystack_verify"])
      .eq("provider", "paystack")
      .gte("occurred_at", startAt)
      .lte("occurred_at", endAt);
    if (error) throw new Error("Trusted experiment revenue could not be loaded.");
    rows.push(...(data ?? []).flatMap((row) =>
      row.user_id && row.currency && row.amount_minor !== null
        ? [{ userId: row.user_id, currency: row.currency, amountMinor: row.amount_minor, occurredAt: row.occurred_at }]
        : []
    ));
  }
  return rows;
}

function metric(key: ExperimentMetricKey) {
  return EXPERIMENT_METRICS.find((item) => item.key === key);
}

function isMetricKey(value: string): value is ExperimentMetricKey {
  return EXPERIMENT_METRICS.some((item) => item.key === value);
}

function chunks<T>(values: T[], size: number) {
  const output: T[][] = [];
  for (let index = 0; index < values.length; index += size) output.push(values.slice(index, index + size));
  return output;
}

async function loadPaged<T>(
  query: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>
) {
  const rows: T[] = [];
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const { data, error } = await query(offset, offset + PAGE_SIZE - 1);
    if (error) throw new Error(error.message);
    rows.push(...(data ?? []));
    if ((data ?? []).length < PAGE_SIZE) break;
  }
  return rows;
}

function addDays(day: string, amount: number) {
  const date = new Date(`${day}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + amount);
  return date.toISOString().slice(0, 10);
}

const MEANINGFUL_OUTCOME_EVENTS = new Set([
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
