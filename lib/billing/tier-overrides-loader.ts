import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, SubscriptionPlan } from "@/lib/supabase/database.types";
import { UNLIMITED } from "@/lib/billing/entitlements";
import { setTierOverrideCache, type TierOverrideMap } from "@/lib/billing/tier-overrides";

type Admin = SupabaseClient<Database>;

/**
 * Reloads the per-tier entitlement overrides into the shared cache. Always hits
 * the table (one small read, no rows unless an admin has customised a tier), so
 * an admin edit applies globally on the very next request rather than after a
 * cache window. The cache still exists so the sync entitlementsFor() calls that
 * follow within the same request read the freshly-loaded values.
 */
export async function refreshTierOverrides(admin: Admin): Promise<void> {
  const { data, error } = await admin
    .from("tier_entitlement_overrides")
    .select("plan, entitlement_key, value_type, numeric_value, is_unlimited, boolean_value");
  if (error) return; // keep the last-known cache / code defaults on a read failure

  const map: TierOverrideMap = {};
  for (const row of data ?? []) {
    const plan = row.plan as SubscriptionPlan;
    if (!map[plan]) map[plan] = {};
    map[plan]![row.entitlement_key] =
      row.value_type === "boolean"
        ? Boolean(row.boolean_value)
        : row.is_unlimited
          ? UNLIMITED
          : Number(row.numeric_value ?? 0);
  }
  setTierOverrideCache(map);
}
