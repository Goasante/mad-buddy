import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, SubscriptionPlan } from "@/lib/supabase/database.types";
import { UNLIMITED } from "@/lib/billing/entitlements";
import { setTierOverrideCache, tierOverridesLoadedAtMs, type TierOverrideMap } from "@/lib/billing/tier-overrides";

type Admin = SupabaseClient<Database>;

const TTL_MS = 60_000;

/**
 * Loads the per-tier entitlement overrides into the shared cache. Cheap and
 * cached (TTL), so limit-gated flows can call it before resolving entitlements
 * without a per-request round trip. `force` bypasses the TTL right after an
 * admin edit so the new value applies immediately.
 */
export async function refreshTierOverrides(admin: Admin, force = false): Promise<void> {
  if (!force && Date.now() - tierOverridesLoadedAtMs() < TTL_MS) return;

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
