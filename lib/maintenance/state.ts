/**
 * Global maintenance-mode state, plus the pure rules for who it applies to.
 *
 * Dependency-free on purpose (no DB, no server-only) so the rules can be unit
 * tested and the cache read synchronously. A server-only loader
 * (lib/maintenance/loader.ts) populates the cache from the maintenance_mode
 * table.
 */

export const DEFAULT_MAINTENANCE_MESSAGE =
  "Mad Buddy is down for scheduled maintenance. We'll be back shortly.";

export type MaintenanceState = {
  isActive: boolean;
  message: string;
};

export const MAINTENANCE_OFF: MaintenanceState = { isActive: false, message: "" };

let cache: MaintenanceState = MAINTENANCE_OFF;
let loadedAtMs = 0;

export function getMaintenanceCache(): MaintenanceState {
  return cache;
}

export function setMaintenanceCache(next: MaintenanceState): void {
  cache = next;
  loadedAtMs = Date.now();
}

export function isMaintenanceCacheStale(ttlMs: number): boolean {
  return loadedAtMs === 0 || Date.now() - loadedAtMs > ttlMs;
}

/** Test-only: drop the cached value so each case starts from a known state. */
export function resetMaintenanceCache(): void {
  cache = MAINTENANCE_OFF;
  loadedAtMs = 0;
}

export function maintenanceMessageOrDefault(message: string | null | undefined): string {
  const trimmed = message?.trim();
  return trimmed ? trimmed : DEFAULT_MAINTENANCE_MESSAGE;
}

/**
 * Whether this visitor should be shown the maintenance screen.
 *
 * Staff are deliberately exempt: someone has to be able to reach the admin
 * console to turn maintenance back off, and to verify the fix before
 * reopening the app. Everyone else is paused.
 */
export function shouldBlockForMaintenance(input: { isActive: boolean; isStaff: boolean }): boolean {
  return input.isActive && !input.isStaff;
}
