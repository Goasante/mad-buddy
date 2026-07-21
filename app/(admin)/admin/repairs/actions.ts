"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getAdminAccess, requireAdminPermission } from "@/lib/admin/access";
import { recordAdminAuditEvent } from "@/lib/admin/service";
import { requireSafetyAdmin } from "@/lib/safety/admin";
import { consumeRateLimit, rateLimitMessage } from "@/lib/security/rate-limit";
import { getRepair, REPAIR_IDS } from "@/lib/admin/repairs";

export type RepairActionState = { ok: boolean; message: string };

type Admin = Awaited<ReturnType<typeof requireSafetyAdmin>>["admin"];

// --- User search (minimum fields only) ------------------------------------
export type RepairUser = { userId: string; name: string; username: string; avatarUrl: string | null };
export type RepairSearchState = { ok: boolean; message: string; results: RepairUser[] };

const searchSchema = z.object({ query: z.string().trim().min(2).max(80) });

export async function searchRepairUsersAction(input: unknown): Promise<RepairSearchState> {
  const empty: RepairSearchState = { ok: false, message: "", results: [] };
  const parsed = searchSchema.safeParse(input);
  if (!parsed.success) return { ...empty, message: "Enter a search term." };

  let admin: Admin;
  try {
    const { admin: client, context } = await requireSafetyAdmin();
    admin = client;
    await requireAdminPermission(admin, context, "admin.support.manage");
    const limit = await consumeRateLimit({ action: "admin.search", userId: context.userId });
    if (!limit.allowed) return { ...empty, message: rateLimitMessage(limit.resetAt) };
  } catch {
    return { ...empty, message: "Admin access is required." };
  }

  const term = parsed.data.query;
  const { data, error } = await admin
    .from("profiles")
    .select("user_id, full_name, username, avatar_url")
    .is("deleted_at", null)
    .or(`full_name.ilike.%${term}%,username.ilike.%${term}%`)
    .order("full_name", { ascending: true })
    .limit(8);
  if (error) return { ...empty, message: "Search could not be completed." };

  return {
    ok: true,
    message: "",
    results: (data ?? []).map((row) => ({
      userId: row.user_id,
      name: row.full_name,
      username: row.username,
      avatarUrl: row.avatar_url
    }))
  };
}

// --- Run a repair ---------------------------------------------------------
const runSchema = z.object({
  userId: z.string().uuid(),
  repairId: z.enum(REPAIR_IDS),
  reason: z.string().trim().max(300).optional()
});

/**
 * Executes one narrowly-scoped repair against one user. Every guard is
 * server-side: the acting user is resolved from the session, the per-repair
 * permission is re-checked, the target must exist and be active, and the
 * action is audited before it runs (audit-first: an unlogged repair is worse
 * than a failed one).
 */
export async function runAccountRepairAction(input: unknown): Promise<RepairActionState> {
  const parsed = runSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Choose a valid repair and user." };

  const repair = getRepair(parsed.data.repairId);
  if (!repair) return { ok: false, message: "That repair is not available." };

  const { userId, reason } = parsed.data;
  if (repair.requiresReason && (!reason || reason.length < 3)) {
    return { ok: false, message: "Add a short reason for this repair." };
  }

  let admin: Admin;
  let actorId: string;
  try {
    const { admin: client, context } = await requireSafetyAdmin();
    admin = client;
    actorId = context.userId;
    // Per-repair permission — not just page access.
    await requireAdminPermission(admin, context, repair.permission);
    const limit = await consumeRateLimit({ action: "admin.mutate", userId: actorId });
    if (!limit.allowed) return { ok: false, message: rateLimitMessage(limit.resetAt) };
  } catch {
    return { ok: false, message: "You don't have permission to run this repair." };
  }

  // Target must be a real, non-deleted account.
  const { data: profile } = await admin
    .from("profiles")
    .select("user_id, full_name, deleted_at")
    .eq("user_id", userId)
    .maybeSingle();
  if (!profile || profile.deleted_at) return { ok: false, message: "That account is unavailable." };

  // Audit-first.
  const logged = await recordAdminAuditEvent(admin, {
    actorId,
    action: `repair:${repair.id}`,
    targetType: "user",
    targetId: userId,
    newState: { repairId: repair.id, risk: repair.risk },
    reason: reason || repair.label
  });
  if (!logged) return { ok: false, message: "The audit entry could not be recorded, so no repair was run." };

  const result = await executeRepair(admin, repair.id, userId);
  if (!result.ok) return result;

  revalidatePath("/admin/repairs");
  return { ok: true, message: result.message };
}

/**
 * The one place repairs touch data. Each branch is scoped to a single user and
 * a single table, and reports what changed. No branch deletes account-defining
 * records (profiles, auth, subscriptions, messages).
 */
async function executeRepair(admin: Admin, repairId: string, userId: string): Promise<RepairActionState> {
  switch (repairId) {
    case "pause_visibility": {
      const { error } = await admin.from("profiles").update({ visibility_status: "ghost" }).eq("user_id", userId);
      return error ? fail("pause visibility") : { ok: true, message: "Visibility paused (Ghost Mode)." };
    }
    case "reset_glow_signal": {
      const { data, error } = await admin.from("user_locations").delete().eq("user_id", userId).select("user_id");
      return error ? fail("reset the glow signal") : { ok: true, message: `Glow signal reset (${data?.length ?? 0} cleared).` };
    }
    case "clear_stuck_status": {
      const { data, error } = await admin.from("user_statuses").delete().eq("user_id", userId).select("id");
      return error ? fail("clear the status") : { ok: true, message: data && data.length ? "Stuck status cleared." : "No active status to clear." };
    }
    case "clear_notification_badge": {
      const { data, error } = await admin.from("notifications").update({ is_read: true }).eq("user_id", userId).eq("is_read", false).select("id");
      return error ? fail("clear the notification badge") : { ok: true, message: `Badge cleared (${data?.length ?? 0} marked read).` };
    }
    case "clear_push_subscriptions": {
      const { data, error } = await admin.from("push_subscriptions").delete().eq("user_id", userId).select("id");
      return error ? fail("reset push devices") : { ok: true, message: `Push devices reset (${data?.length ?? 0} removed).` };
    }
    case "clear_rate_limits": {
      const { data, error } = await admin.from("rate_limits").delete().eq("user_id", userId).select("id");
      return error ? fail("clear rate limits") : { ok: true, message: `Rate-limit lockout cleared (${data?.length ?? 0} counters).` };
    }
    case "reset_onboarding": {
      const { error } = await admin.from("profiles").update({ is_onboarded: false }).eq("user_id", userId);
      return error ? fail("re-trigger onboarding") : { ok: true, message: "Onboarding will restart on next open." };
    }
    default:
      return { ok: false, message: "That repair is not available." };
  }
}

function fail(what: string): RepairActionState {
  return { ok: false, message: `Couldn't ${what}. No change was made.` };
}

// --- Recent repairs for a user (audit-backed history) ---------------------
export type RepairHistoryEntry = { id: string; repairLabel: string; actorName: string; reason: string | null; createdAt: string };
export type RepairHistoryState = { ok: boolean; entries: RepairHistoryEntry[] };

const historySchema = z.object({ userId: z.string().uuid() });

export async function getRecentRepairsAction(input: unknown): Promise<RepairHistoryState> {
  const parsed = historySchema.safeParse(input);
  if (!parsed.success) return { ok: false, entries: [] };

  let admin: Admin;
  try {
    const { admin: client, context } = await requireSafetyAdmin();
    admin = client;
    const access = await getAdminAccess(admin, context);
    if (!access.permissions.has("admin.support.manage")) return { ok: false, entries: [] };
  } catch {
    return { ok: false, entries: [] };
  }

  const { data } = await admin
    .from("admin_audit_events")
    .select("id, actor_id, action, reason, created_at")
    .eq("target_id", parsed.data.userId)
    .like("action", "repair:%")
    .order("created_at", { ascending: false })
    .limit(10);
  const rows = data ?? [];

  const actorIds = [...new Set(rows.map((row) => row.actor_id).filter((id): id is string => Boolean(id)))];
  const actorName = new Map<string, string>();
  if (actorIds.length > 0) {
    const { data: actors } = await admin.from("profiles").select("user_id, full_name").in("user_id", actorIds);
    for (const actor of actors ?? []) actorName.set(actor.user_id, actor.full_name);
  }

  return {
    ok: true,
    entries: rows.map((row) => {
      const repair = getRepair(row.action.replace("repair:", ""));
      return {
        id: row.id,
        repairLabel: repair?.label ?? row.action.replace("repair:", "").replaceAll("_", " "),
        actorName: row.actor_id ? actorName.get(row.actor_id) ?? "Staff member" : "System",
        reason: row.reason,
        createdAt: row.created_at
      };
    })
  };
}
