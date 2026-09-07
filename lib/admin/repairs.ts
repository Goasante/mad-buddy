/**
 * Repair centre catalog (Admin slice).
 *
 * Pure metadata shared by the server action (which enforces per-repair
 * permission + confirmation + audit) and the UI (which renders the catalog and
 * mirrors the confirm/reason requirements). The actual mutations live in the
 * server action; nothing here touches the database. Every repair is narrowly
 * scoped to a single user and a safe lifecycle invariant; destructive account
 * data (profiles, auth, subscriptions, messages) is never deleted here.
 */

import type { AdminPermission } from "@/lib/admin/governance";

export type RepairRisk = "low" | "medium" | "high";

export type RepairCategory =
  | "Messaging & coordination"
  | "Plans & UpFor"
  | "Visibility & presence"
  | "Notifications"
  | "Access & limits"
  | "Onboarding";

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
    id: "reconcile_direct_messaging",
    label: "Repair direct messaging",
    description: "Reopens only archived direct chats whose users are currently Muddies and not blocked, and restores their direct-chat membership.",
    effect: "Eligible existing direct conversations become usable again. No friendship or new conversation is created, and any live block still wins.",
    category: "Messaging & coordination",
    risk: "medium",
    permission: "admin.support.manage",
    requiresReason: true,
    confirm: true
  },
  {
    id: "reconcile_plan_chats",
    label: "Reconcile Plan Chats",
    description: "Runs the canonical Plan Chat membership reconciler for this user's active Going/Maybe Plans.",
    effect: "Plan Chat membership is rebuilt from the Plan lifecycle authority. It does not add arbitrary people or create direct-message permission.",
    category: "Messaging & coordination",
    risk: "medium",
    permission: "admin.support.manage",
    requiresReason: true,
    confirm: true
  },
  {
    id: "settle_stranded_upfor_requests",
    label: "Settle requests on a closed UpFor",
    description:
      "Declines requests still pending on the account's own UpFors that have expired, been cancelled or already become a Plan.",
    effect:
      "People waiting on a session that is over stop waiting. Nobody is added to anything, and no live UpFor is touched.",
    category: "Plans & UpFor",
    risk: "low",
    permission: "admin.support.manage",
    requiresReason: false,
    confirm: true
  },
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
    description: "Removes statuses whose expiry has already passed. A status with no expiry is indefinite by design and is never touched.",
    effect: "Only expired statuses are removed. A current status the person set deliberately is left exactly as it is.",
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
    label: "Reset web push registrations",
    /* Scoped in the NAME. `push_subscriptions` is web push only; native
       delivery uses `device_push_tokens`, which this does not touch. A label
       saying "push devices" promised both and delivered one, so an operator
       would have reported a native-push problem as fixed. */
    description:
      "Removes stored WEB push registrations so the browser can re-register. Native app device tokens are not affected.",
    effect:
      "Web push stops until the account re-enables notifications in a browser. Push to the mobile app is unchanged.",
    category: "Notifications",
    risk: "medium",
    permission: "admin.support.manage",
    requiresReason: false,
    confirm: true
  },
  {
    id: "clear_rate_limits",
    label: "Clear ALL active rate limits",
    /* Named for what it actually does. `rate_limits` has no unique constraint
       on (user_id, action), so one account can hold several live windows for
       unrelated actions; clearing them is a broad operation, not a targeted
       one, and the label must not imply otherwise. */
    description:
      "Clears EVERY active rate-limit window on this account, not just the one the user reported. Expired counters are left alone.",
    effect:
      "All currently throttled actions become available again, including any the user did not mention. Use it when the account is genuinely stuck, not to speed up one action.",
    category: "Access & limits",
    risk: "high",
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
  "Messaging & coordination",
  "Plans & UpFor",
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
