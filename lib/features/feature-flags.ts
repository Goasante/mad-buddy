import "server-only";

import type { createSupabaseAdminClient } from "@/lib/supabase/admin";

type Admin = ReturnType<typeof createSupabaseAdminClient>;

export const OPEN_MOMENTS_FLAG = "open_moments" as const;

export type GlobalFeatureFlagRow = {
  status: "off" | "on" | "rollout" | "archived";
  default_value: boolean;
};

/**
 * Global feature flags fail closed. A rollout needs a subject-aware evaluator;
 * until one is introduced, only its explicit default is safe to use.
 */
export function resolveGlobalFeatureFlag(row: GlobalFeatureFlagRow | null | undefined): boolean {
  if (!row || row.status === "off" || row.status === "archived") return false;
  if (row.status === "on") return true;
  return row.default_value;
}

export async function isFeatureEnabled(admin: Admin, key: string): Promise<boolean> {
  const { data, error } = await admin
    .from("feature_flags")
    .select("status, default_value")
    .eq("key", key)
    .maybeSingle();

  if (error) return false;
  return resolveGlobalFeatureFlag(data);
}

export async function isOpenMomentsEnabled(admin: Admin): Promise<boolean> {
  return isFeatureEnabled(admin, OPEN_MOMENTS_FLAG);
}
