import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, SubscriptionPlan } from "@/lib/supabase/database.types";
import { UNLIMITED } from "@/lib/billing/entitlements";
import { isTierOverrideCacheStale, setTierOverrideCache, type TierOverrideMap } from "@/lib/billing/tier-overrides";

type Admin = SupabaseClient<Database>;

/** How long a normal read may serve the in-memory cache before re-checking the table. */
const WARM_TTL_MS = 30_000;

/**
 * Reloads the per-tier entitlement overrides into the shared cache. Always hits
 * the table (one small read, no rows unless an admin has customised a tier).
 * Called directly (unconditionally) only from the admin set/reset actions, so
 * an edit applies globally on the very next request rather than after a cache
 * window. Everywhere else, use `ensureTierOverridesWarm`, this full reload on
 * every request was adding a synchronous DB round trip to every authenticated
 * page load (dashboard, moments, plans, events, ...) for no benefit to a
 * reader who isn't the admin who just made the change.
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

/**
 * The read-path version: reloads only if the cache has never been loaded or
 * is older than WARM_TTL_MS. Keeps ordinary page loads fast while still
 * picking up admin overrides within 30s (instantly for the admin's own next
 * request, since their mutation already called `refreshTierOverrides`).
 */
export async function ensureTierOverridesWarm(admin: Admin): Promise<void> {
  if (!isTierOverrideCacheStale(WARM_TTL_MS)) return;
  await refreshTierOverrides(admin);
}
