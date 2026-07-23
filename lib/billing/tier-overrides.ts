/**
 * In-memory cache of admin-set per-tier entitlement overrides. Deliberately
 * dependency-free (no DB, no server-only) so `entitlementsFor` can merge it
 * synchronously and this module stays safe to import from client code — where
 * the cache is simply empty and callers fall back to the code defaults. A
 * server-only loader (tier-overrides-loader) populates it from the
 * tier_entitlement_overrides table.
 */

import type { SubscriptionPlan } from "@/lib/supabase/database.types";

export type TierOverrideMap = Partial<Record<SubscriptionPlan, Record<string, number | boolean>>>;

let cache: TierOverrideMap = {};
let loadedAtMs = 0;

export function getTierOverrideCache(): TierOverrideMap {
  return cache;
}

export function setTierOverrideCache(next: TierOverrideMap): void {
  cache = next;
  loadedAtMs = Date.now();
}

export function tierOverridesLoadedAtMs(): number {
  return loadedAtMs;
}

/** Never loaded, or loaded further back than the given TTL. */
export function isTierOverrideCacheStale(ttlMs: number): boolean {
  return loadedAtMs === 0 || Date.now() - loadedAtMs > ttlMs;
}
