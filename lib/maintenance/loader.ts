import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import {
  getMaintenanceCache,
  isMaintenanceCacheStale,
  maintenanceMessageOrDefault,
  setMaintenanceCache,
  type MaintenanceState
} from "@/lib/maintenance/state";

type Admin = SupabaseClient<Database>;

/** How long a normal read may serve the cached value before re-checking. */
const WARM_TTL_MS = 15_000;

/**
 * Reloads maintenance state from the table. Called unconditionally by the
 * admin toggle so the operator sees their own change immediately; readers
 * should use `ensureMaintenanceWarm` instead.
 */
export async function refreshMaintenanceState(admin: Admin): Promise<MaintenanceState> {
  const { data, error } = await admin
    .from("maintenance_mode")
    .select("is_active, message")
    .eq("id", true)
    .maybeSingle();

  // A read failure must not lock everyone out of a working app, so treat an
  // unreadable flag as "not in maintenance" rather than failing closed.
  const next: MaintenanceState = error
    ? { isActive: false, message: "" }
    : { isActive: Boolean(data?.is_active), message: maintenanceMessageOrDefault(data?.message) };

  setMaintenanceCache(next);
  return next;
}

/** Read path: reloads only when the cached value is missing or stale. */
export async function ensureMaintenanceWarm(admin: Admin): Promise<MaintenanceState> {
  if (!isMaintenanceCacheStale(WARM_TTL_MS)) return getMaintenanceCache();
  return refreshMaintenanceState(admin);
}
