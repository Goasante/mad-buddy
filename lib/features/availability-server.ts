import "server-only";
import { cache } from "react";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getSupabaseServerEnv } from "@/lib/supabase/env";
import { loadGlobalFeatureFlags } from "@/lib/features/feature-flags";
import { LOCKED_FEATURES, OPTIONAL_FEATURES, type FeatureAvailability, type OptionalFeature } from "./availability";

/** Request-scoped only: no cross-request cache can keep a newly locked feature on. */
export const loadFeatureAvailability = cache(async (): Promise<FeatureAvailability> => {
  const env = getSupabaseServerEnv();
  if (!env.url || !env.serviceRoleKey) return { ...LOCKED_FEATURES };
  const enabled = await loadGlobalFeatureFlags(createSupabaseAdminClient(), Object.values(OPTIONAL_FEATURES).map(f => f.flag));
  return Object.fromEntries(Object.entries(OPTIONAL_FEATURES).map(([key, value]) => [key, enabled.has(value.flag)])) as FeatureAvailability;
});
export async function optionalFeatureEnabled(feature: OptionalFeature): Promise<boolean> {
  return (await loadFeatureAvailability())[feature];
}
export const FEATURE_LOCK_MESSAGE = "Coming soon. We're getting this feature ready for you.";
