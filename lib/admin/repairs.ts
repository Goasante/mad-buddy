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
  | "Visibility & presence";

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

/* WHAT BELONGS ON THIS SHELF.
 *
 * A repair needs a DEFECT PREDICATE, not just a verifier. Post-write
 * verification proves the mutation did what it said; it says nothing about
 * whether the mutation should have been offered at all. Three entries were
 * removed for failing that test, and none were unsafe -- they simply were not
 * repairs, because no diagnostic could ever say the state was wrong:
 *
 *   clear_notification_badge -- unread notifications are not a defect. Marking
 *     somebody's real unread mail as read because an operator clicked a button
 *     destroys information they had not seen.
 *   pause_visibility -- Ghost Mode is the USER's privacy choice. Admin setting
 *     it is a moderation action against an account, not a repair of drift, and
 *     it must not sit behind support.manage on an always-visible shelf.
 *   reset_onboarding -- nothing diagnoses onboarding state as WRONG, so the
 *     button could only ever act on a healthy account.
 *
 * Three more went in a second pass, for the subtler version of the same fault:
 * they were named by a finding, but the finding could never fire.
 *
 *   reset_glow_signal -- the presence loader projects a usable signal as
 *     `fresh` and everything else as `missing`; it never emits `stale`, because
 *     an expired location row is not drift (the proximity engine already treats
 *     it as absent). The "signal is stale" branch is dead code.
 *   clear_push_subscriptions -- `stalePushDevices` is hard-coded 0, because no
 *     canonical stale-token rule exists. Its finding can never fire either.
 *   clear_rate_limits -- this one CAN fire, but "an active rate limit exists"
 *     is throttling working, not drift. Clearing it is an abuse-control
 *     decision, and support.manage must not be able to lift a legitimate
 *     protection because a button was on screen.
 *
 * Inventing a stale threshold for the first two would have manufactured the
 * defect needed to justify the repair. The honest move is fewer repairs.
 *
 * Every entry below is reachable from a finding the LIVE loader can actually
 * produce. If a governed administrative action is wanted for any of these
 * later, it belongs in a separate surface with its own semantics -- not here,
 * where "repair" implies something was broken.
 */
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
    id: "clear_stuck_status",
    label: "Clear stuck status",
    description: "Removes a status whose expiry has already passed. A status that is still current is never touched.",
    effect: "Only expired statuses are removed. A current status the person set deliberately is left exactly as it is.",
    category: "Visibility & presence",
    risk: "medium",
    permission: "admin.support.manage",
    requiresReason: false,
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
  "Visibility & presence"
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
