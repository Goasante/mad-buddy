"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAdminPermission } from "@/lib/admin/access";
import { recordAdminAuditEvent } from "@/lib/admin/service";
import {
  EXPERIMENT_METRICS,
  nextExperimentStatus,
  validateExperimentDefinition,
  type ExperimentDefinitionInput,
  type ExperimentMetricKey,
  type ExperimentPlatform
} from "@/lib/experiments/model";
import { consumeRateLimit, rateLimitMessage } from "@/lib/security/rate-limit";
import { requireSafetyAdmin } from "@/lib/safety/admin";
import type { Json, SubscriptionPlan } from "@/lib/supabase/database.types";

export type ExperimentActionState = { ok: boolean; message: string };

const metricKeys = EXPERIMENT_METRICS.map((metric) => metric.key) as [ExperimentMetricKey, ...ExperimentMetricKey[]];
const createSchema = z.object({
  key: z.string().trim().toLowerCase().regex(/^[a-z][a-z0-9_]{2,63}$/),
  name: z.string().trim().min(3).max(100),
  description: z.string().trim().min(3).max(500),
  hypothesis: z.string().trim().min(3).max(1000),
  parentFeatureFlagId: z.union([z.string().uuid(), z.literal("")]),
  allocationPercentage: z.coerce.number().int().min(1).max(100),
  audience: z.enum(["all_eligible", "selected_testers"]),
  conflictGroup: z.string().trim().max(64),
  startsAt: z.string(),
  endsAt: z.string(),
  primaryMetric: z.enum(metricKeys),
  secondaryMetrics: z.string().trim().max(400).default(""),
  guardrailMetrics: z.string().trim().max(400).default(""),
  controlName: z.string().trim().min(2).max(80),
  controlDescription: z.string().trim().max(500),
  controlWeight: z.coerce.number().int().min(1).max(99),
  variantAName: z.string().trim().min(2).max(80),
  variantADescription: z.string().trim().max(500),
  variantAWeight: z.coerce.number().int().min(1).max(99),
  variantBName: z.string().trim().max(80),
  variantBDescription: z.string().trim().max(500),
  variantBWeight: z.union([z.literal(""), z.coerce.number().int().min(1).max(99)])
});

export async function createExperimentAction(
  _previous: ExperimentActionState,
  formData: FormData
): Promise<ExperimentActionState> {
  const parsed = createSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, message: "Check the experiment details, targeting, metrics, and variant weights." };
  const platforms = formData.getAll("platforms").filter(isPlatform);
  const plans = formData.getAll("plans").filter(isPlan);
  const secondaryMetrics = parseMetricValues(formData.getAll("secondaryMetrics"));
  const guardrailMetrics = parseMetricValues(formData.getAll("guardrailMetrics"));
  if (!secondaryMetrics || !guardrailMetrics) return { ok: false, message: "Use valid comma-separated metric keys." };

  const variants: ExperimentDefinitionInput["variants"] = [
    {
      key: "control",
      name: parsed.data.controlName,
      description: parsed.data.controlDescription,
      weightBasisPoints: parsed.data.controlWeight * 100,
      isControl: true
    },
    {
      key: "variant_a",
      name: parsed.data.variantAName,
      description: parsed.data.variantADescription,
      weightBasisPoints: parsed.data.variantAWeight * 100,
      isControl: false
    }
  ];
  if (parsed.data.variantBName && parsed.data.variantBWeight !== "") {
    variants.push({
      key: "variant_b",
      name: parsed.data.variantBName,
      description: parsed.data.variantBDescription,
      weightBasisPoints: parsed.data.variantBWeight * 100,
      isControl: false
    });
  }
  const definition: ExperimentDefinitionInput = {
    key: parsed.data.key,
    name: parsed.data.name,
    description: parsed.data.description,
    hypothesis: parsed.data.hypothesis,
    allocationPercentage: parsed.data.allocationPercentage,
    audience: parsed.data.audience,
    platforms,
    plans,
    conflictGroup: parsed.data.conflictGroup || null,
    startsAt: localDateTimeToIso(parsed.data.startsAt),
    endsAt: localDateTimeToIso(parsed.data.endsAt),
    primaryMetric: parsed.data.primaryMetric,
    secondaryMetrics,
    guardrailMetrics,
    variants
  };
  if (validateExperimentDefinition(definition).length) {
    return { ok: false, message: "The allocation must total 100%, include one control, and use distinct valid metrics." };
  }

  const auth = await requireExperimentOwner();
  if (!auth.ok) return auth.result;
  const limited = await consumeRateLimit({ action: "admin.mutate", userId: auth.context.userId });
  if (!limited.allowed) return { ok: false, message: rateLimitMessage(limited.resetAt) };
  const experimentId = randomUUID();
  const databaseDefinition = {
    id: experimentId,
    key: definition.key,
    name: definition.name,
    description: definition.description,
    hypothesis: definition.hypothesis,
    parent_feature_flag_id: parsed.data.parentFeatureFlagId || null,
    allocation_percentage: definition.allocationPercentage,
    audience: definition.audience,
    target_platforms: definition.platforms,
    target_plans: definition.plans,
    conflict_group: definition.conflictGroup,
    starts_at: definition.startsAt,
    ends_at: definition.endsAt,
    primary_metric: definition.primaryMetric,
    secondary_metrics: definition.secondaryMetrics,
    guardrail_metrics: definition.guardrailMetrics,
    variants: definition.variants.map((variant) => ({
      key: variant.key,
      name: variant.name,
      description: variant.description,
      weight_basis_points: variant.weightBasisPoints,
      is_control: variant.isControl
    }))
  };
  const logged = await recordAdminAuditEvent(auth.admin, {
    actorId: auth.context.userId,
    actorRole: auth.context.email,
    action: "experiment_create_requested",
    targetType: "experiment",
    targetId: experimentId,
    newState: databaseDefinition,
    reason: "Owner created a draft experiment"
  });
  if (!logged) return { ok: false, message: "The audit entry failed, so the experiment was not created." };

  const { error } = await auth.admin.rpc("create_experiment_definition", {
    p_definition: databaseDefinition as unknown as Json,
    p_created_by: auth.context.userId
  });
  if (error) {
    return {
      ok: false,
      message: error.code === "23505" ? "That experiment key already exists." : "The experiment could not be created."
    };
  }
  revalidateExperiments();
  return { ok: true, message: "Draft experiment created." };
}

const lifecycleSchema = z.object({
  experimentId: z.string().uuid(),
  action: z.enum(["schedule", "start", "pause", "resume", "stop", "cancel", "emergency_stop"]),
  confirmation: z.literal("CONFIRM"),
  reason: z.string().trim().min(3).max(500)
});

export async function changeExperimentStatusAction(
  _previous: ExperimentActionState,
  formData: FormData
): Promise<ExperimentActionState> {
  const parsed = lifecycleSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, message: "Type CONFIRM and provide a reason for this lifecycle change." };
  const auth = await requireExperimentOwner();
  if (!auth.ok) return auth.result;
  const limited = await consumeRateLimit({ action: "admin.mutate", userId: auth.context.userId });
  if (!limited.allowed) return { ok: false, message: rateLimitMessage(limited.resetAt) };

  const { data: experiment, error } = await auth.admin
    .from("experiments")
    .select("id, key, status, starts_at, ends_at, parent_feature_flag_id")
    .eq("id", parsed.data.experimentId)
    .maybeSingle();
  if (error || !experiment) return { ok: false, message: "The experiment could not be found." };
  const nextStatus = nextExperimentStatus(experiment.status, parsed.data.action);
  if (!nextStatus) return { ok: false, message: "That lifecycle change is not valid from the current state." };

  if (parsed.data.action === "schedule") {
    if (!experiment.starts_at || Date.parse(experiment.starts_at) <= Date.now()) {
      return { ok: false, message: "A scheduled experiment needs a future start time." };
    }
  }
  if (nextStatus === "running") {
    const [variants, parentFlag] = await Promise.all([
      auth.admin.from("experiment_variants").select("weight_basis_points, is_control").eq("experiment_id", experiment.id),
      experiment.parent_feature_flag_id
        ? auth.admin.from("feature_flags").select("status").eq("id", experiment.parent_feature_flag_id).maybeSingle()
        : Promise.resolve({ data: null, error: null })
    ]);
    const weight = (variants.data ?? []).reduce((sum, variant) => sum + variant.weight_basis_points, 0);
    if (variants.error || variants.data?.length < 2 || weight !== 10_000 || variants.data.filter((variant) => variant.is_control).length !== 1) {
      return { ok: false, message: "Fix the experiment variants before starting it." };
    }
    if (parentFlag.error || parentFlag.data?.status === "off" || parentFlag.data?.status === "archived") {
      return { ok: false, message: "Turn on the parent feature flag before starting this experiment." };
    }
    if (experiment.ends_at && Date.parse(experiment.ends_at) <= Date.now()) {
      return { ok: false, message: "The experiment end time has already passed." };
    }
  }

  const now = new Date().toISOString();
  const update = {
    status: nextStatus,
    ...(nextStatus === "running"
      ? { ...(parsed.data.action === "resume" ? {} : { started_at: now }), paused_at: null }
      : {}),
    ...(nextStatus === "paused" ? { paused_at: now } : {}),
    ...(nextStatus === "completed" ? { completed_at: now } : {}),
    ...(nextStatus === "cancelled" ? { cancelled_at: now } : {})
  };
  const logged = await recordAdminAuditEvent(auth.admin, {
    actorId: auth.context.userId,
    actorRole: auth.context.email,
    action: `experiment_${parsed.data.action}_requested`,
    targetType: "experiment",
    targetId: experiment.id,
    previousState: { status: experiment.status },
    newState: update,
    reason: parsed.data.reason
  });
  if (!logged) return { ok: false, message: "The audit entry failed, so the experiment was not changed." };
  const { data: changed, error: updateError } = await auth.admin
    .from("experiments")
    .update(update)
    .eq("id", experiment.id)
    .eq("status", experiment.status)
    .select("id")
    .maybeSingle();
  if (updateError || !changed) return { ok: false, message: "The experiment changed elsewhere. Refresh and try again." };
  revalidateExperiments();
  return {
    ok: true,
    message: parsed.data.action === "emergency_stop" ? "Emergency stop applied. New exposures are blocked." : `Experiment ${nextStatus}.`
  };
}

const testerSchema = z.object({
  experimentId: z.string().uuid(),
  account: z.string().trim().min(2).max(100),
  operation: z.enum(["add", "remove"]),
  reason: z.string().trim().min(3).max(500)
});

export async function changeExperimentTesterAction(
  _previous: ExperimentActionState,
  formData: FormData
): Promise<ExperimentActionState> {
  const parsed = testerSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, message: "Enter an account and a reason." };
  const auth = await requireExperimentOwner();
  if (!auth.ok) return auth.result;
  const { data: experiment } = await auth.admin
    .from("experiments")
    .select("id, status")
    .eq("id", parsed.data.experimentId)
    .maybeSingle();
  if (!experiment || !["draft", "scheduled"].includes(experiment.status)) {
    return { ok: false, message: "Testers can only change before an experiment starts." };
  }
  const userId = await resolveUserId(auth.admin, parsed.data.account);
  if (!userId) return { ok: false, message: "No account matches that user ID or username." };
  const logged = await recordAdminAuditEvent(auth.admin, {
    actorId: auth.context.userId,
    actorRole: auth.context.email,
    action: `experiment_tester_${parsed.data.operation}_requested`,
    targetType: "experiment",
    targetId: experiment.id,
    newState: { userId },
    reason: parsed.data.reason
  });
  if (!logged) return { ok: false, message: "The audit entry failed, so the tester list was not changed." };
  const result = parsed.data.operation === "add"
    ? await auth.admin.from("experiment_testers").upsert({
        experiment_id: experiment.id,
        user_id: userId,
        added_by: auth.context.userId
      }, { onConflict: "experiment_id,user_id" })
    : await auth.admin.from("experiment_testers").delete().eq("experiment_id", experiment.id).eq("user_id", userId);
  if (result.error) return { ok: false, message: "The tester list could not be updated." };
  revalidateExperiments();
  return { ok: true, message: parsed.data.operation === "add" ? "Tester added." : "Tester removed." };
}

async function requireExperimentOwner() {
  try {
    const auth = await requireSafetyAdmin();
    const access = await requireAdminPermission(auth.admin, auth.context, "admin.experiments.manage");
    if (access.role !== "owner") throw new Error("Owner access required.");
    return { ok: true as const, ...auth };
  } catch {
    return { ok: false as const, result: { ok: false, message: "Only the Owner can manage experiments." } };
  }
}

async function resolveUserId(admin: Awaited<ReturnType<typeof requireSafetyAdmin>>["admin"], account: string) {
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(account)) {
    const { data } = await admin.from("profiles").select("user_id").eq("user_id", account).maybeSingle();
    return data?.user_id ?? null;
  }
  const { data } = await admin
    .from("profiles")
    .select("user_id")
    .eq("username_normalized", account.replace(/^@/, "").toLowerCase())
    .is("deleted_at", null)
    .maybeSingle();
  return data?.user_id ?? null;
}

function parseMetrics(value: string): ExperimentMetricKey[] | null {
  if (!value) return [];
  const values = [...new Set(value.split(",").map((item) => item.trim()).filter(Boolean))];
  return values.every((value): value is ExperimentMetricKey => metricKeys.includes(value as ExperimentMetricKey))
    ? values
    : null;
}

function parseMetricValues(values: FormDataEntryValue[]): ExperimentMetricKey[] | null {
  const strings = values.filter((value): value is string => typeof value === "string");
  if (strings.length <= 1 && strings[0]?.includes(",")) return parseMetrics(strings[0]);
  const unique = [...new Set(strings.filter(Boolean))];
  return unique.every((value): value is ExperimentMetricKey => metricKeys.includes(value as ExperimentMetricKey))
    ? unique
    : null;
}

function localDateTimeToIso(value: string) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function isPlatform(value: FormDataEntryValue): value is ExperimentPlatform {
  return typeof value === "string" && ["web", "android", "ios"].includes(value);
}

function isPlan(value: FormDataEntryValue): value is SubscriptionPlan {
  return typeof value === "string" && ["free", "buddy_plus", "buddy_pro"].includes(value);
}

function revalidateExperiments() {
  revalidatePath("/admin/experiments");
}
