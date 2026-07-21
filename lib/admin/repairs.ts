/**
 * Repair centre catalog (Admin slice).
 *
 * Pure metadata shared by the server action (which enforces per-repair
 * permission + confirmation + audit) and the UI (which renders the catalog and
 * mirrors the confirm/reason requirements). The actual mutations live in the
 * server action; nothing here touches the database. Every repair is narrowly
 * scoped to a single user and a single safe table, reusing existing schema — no
 * migration and no destructive account-data loss.
 */

import type { AdminPermission } from "@/lib/admin/governance";

export type RepairRisk = "low" | "medium" | "high";

export type RepairCategory = "Visibility & presence" | "Notifications" | "Access & limits" | "Onboarding";

export type RepairDefinition = {
  id: string;
  label: string;
  description: string;
  /** What the user will see change, in plain language. */
  effect: string;
  category: RepairCategory;
  risk: RepairRisk;
  /** Permission required to run this specific repair. */
  permission: AdminPermission;
  /** High-signal repairs require a written reason. */
  requiresReason: boolean;
  /** Whether the UI must confirm before running. */
  confirm: boolean;
};

export const REPAIR_CATALOG: readonly RepairDefinition[] = [
  {
    id: "pause_visibility",
    label: "Pause visibility (Ghost Mode)",
    description: "Switches the account to Ghost Mode so it stops appearing in proximity.",
    effect: "The account is hidden from nearby glow until they turn visibility back on.",
    category: "Visibility & presence",
    risk: "low",
    permission: "admin.support.manage",
    requiresReason: false,
    confirm: false
  },
  {
    id: "reset_glow_signal",
    label: "Reset glow signal",
    description: "Removes the current device location signal so it can refresh cleanly.",
    effect: "The last known glow signal is cleared; it refreshes on the next update.",
    category: "Visibility & presence",
    risk: "low",
    permission: "admin.support.manage",
    requiresReason: false,
    confirm: false
  },
  {
    id: "clear_stuck_status",
    label: "Clear stuck status",
    description: "Removes a status that failed to expire (availability / activity).",
    effect: "The current status is cleared; the account shows no active status.",
    category: "Visibility & presence",
    risk: "medium",
    permission: "admin.support.manage",
    requiresReason: false,
    confirm: true
  },
  {
    id: "clear_notification_badge",
    label: "Clear notification badge",
    description: "Marks all current notifications as read to clear a stuck badge count.",
    effect: "The unread badge resets to zero. No notifications are deleted.",
    category: "Notifications",
    risk: "low",
    permission: "admin.support.manage",
    requiresReason: false,
    confirm: false
  },
  {
    id: "clear_push_subscriptions",
    label: "Reset push devices",
    description: "Removes stored push devices so the account can re-register for push.",
    effect: "Push stops until the account re-enables notifications on a device.",
    category: "Notifications",
    risk: "medium",
    permission: "admin.support.manage",
    requiresReason: false,
    confirm: true
  },
  {
    id: "clear_rate_limits",
    label: "Clear rate-limit lockout",
    description: "Clears this account's rate-limit counters so it isn't stuck throttled.",
    effect: "Throttled actions become available again immediately.",
    category: "Access & limits",
    risk: "medium",
    permission: "admin.support.manage",
    requiresReason: true,
    confirm: true
  },
  {
    id: "reset_onboarding",
    label: "Re-trigger onboarding",
    description: "Marks onboarding incomplete so the account restarts the setup flow.",
    effect: "The account is sent back through onboarding on next open. No data is deleted.",
    category: "Onboarding",
    risk: "high",
    permission: "admin.users.suspend",
    requiresReason: true,
    confirm: true
  }
];

export const REPAIR_IDS = REPAIR_CATALOG.map((repair) => repair.id) as [string, ...string[]];

export function getRepair(id: string): RepairDefinition | undefined {
  return REPAIR_CATALOG.find((repair) => repair.id === id);
}

export function repairRiskTone(risk: RepairRisk): "default" | "warning" | "danger" {
  if (risk === "high") return "danger";
  if (risk === "medium") return "warning";
  return "default";
}

export const REPAIR_CATEGORY_ORDER: readonly RepairCategory[] = [
  "Visibility & presence",
  "Notifications",
  "Access & limits",
  "Onboarding"
];

/** Catalog grouped by category, in display order — for the UI. */
export function repairsByCategory(): { category: RepairCategory; repairs: RepairDefinition[] }[] {
  return REPAIR_CATEGORY_ORDER.map((category) => ({
    category,
    repairs: REPAIR_CATALOG.filter((repair) => repair.category === category)
  })).filter((group) => group.repairs.length > 0);
}

/** The repairs an actor holding these permissions is allowed to run. */
export function allowedRepairs(permissions: readonly AdminPermission[]): RepairDefinition[] {
  const held = new Set(permissions);
  return REPAIR_CATALOG.filter((repair) => held.has(repair.permission));
}
