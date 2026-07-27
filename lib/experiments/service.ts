import "server-only";

import type { createSupabaseAdminClient } from "@/lib/supabase/admin";
import type { ExperimentPlatform } from "@/lib/experiments/model";

type Admin = ReturnType<typeof createSupabaseAdminClient>;

export type ResolvedExperiment = {
  experimentId: string;
  assignmentId: string;
  variantKey: string;
  variantName: string;
  isControl: boolean;
};

export function requestExperimentPlatform(request: Request): ExperimentPlatform {
  const origin = request.headers.get("origin");
  if (origin === "capacitor://localhost" || origin === "ionic://localhost" || origin === "http://localhost" || origin === "https://localhost") {
    return /android/i.test(request.headers.get("user-agent") ?? "") ? "android" : "ios";
  }
  return "web";
}

export async function resolveExperiment(
  admin: Admin,
  input: { experimentKey: string; userId: string; platform: ExperimentPlatform }
): Promise<ResolvedExperiment | null> {
  const { data, error } = await admin.rpc("resolve_experiment_assignment", {
    p_experiment_key: input.experimentKey,
    p_user_id: input.userId,
    p_platform: input.platform
  });
  if (error) throw new Error(`Experiment assignment failed: ${error.message}`);
  const row = data?.[0];
  return row
    ? {
        experimentId: row.experiment_id,
        assignmentId: row.assignment_id,
        variantKey: row.variant_key,
        variantName: row.variant_name,
        isControl: row.is_control
      }
    : null;
}

export async function recordExperimentExposure(
  admin: Admin,
  input: { experimentKey: string; userId: string; platform: ExperimentPlatform }
): Promise<(ResolvedExperiment & { firstExposure: boolean }) | null> {
  const { data, error } = await admin.rpc("record_experiment_exposure", {
    p_experiment_key: input.experimentKey,
    p_user_id: input.userId,
    p_platform: input.platform
  });
  if (error) throw new Error(`Experiment exposure failed: ${error.message}`);
  const row = data?.[0];
  return row
    ? {
        experimentId: row.experiment_id,
        assignmentId: row.assignment_id,
        variantKey: row.variant_key,
        variantName: row.variant_name,
        isControl: row.is_control,
        firstExposure: row.first_exposure
      }
    : null;
}

