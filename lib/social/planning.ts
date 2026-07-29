import "server-only";

import { areApprovedMuddies, batchEligibleMuddyIds, isBlockedEitherDirection } from "@/lib/social/permissions";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import type { PlanRole, RsvpStatus } from "@/lib/supabase/database.types";

/**
 * Shared server-side planning service (spec §60). Every "can A create / invite
 * / access / edit / RSVP" decision for Plans and Hangout Mode routes through
 * here, layered on top of the batch-2 permission service so the relationship
 * and block rules stay in one audited place. Uses the service-role admin
 * client; callers must have already authenticated the requester.
 */

type Admin = ReturnType<typeof createSupabaseAdminClient>;

export type PlanParticipantRow = {
  role: PlanRole;
  rsvp_status: RsvpStatus;
};

/** A user may invite another only if they are mutual, unblocked Muddies. */
export async function canInviteToPlan(
  admin: Admin,
  creatorId: string,
  inviteeId: string
): Promise<boolean> {
  if (creatorId === inviteeId) return false;
  const [mutual, blocked] = await Promise.all([
    areApprovedMuddies(admin, creatorId, inviteeId),
    isBlockedEitherDirection(admin, creatorId, inviteeId)
  ]);
  return mutual && !blocked;
}

/** Filters a candidate invitee list down to the eligible ids. */
export async function eligibleInvitees(
  admin: Admin,
  creatorId: string,
  candidateIds: string[]
): Promise<string[]> {
  const eligible = await batchEligibleMuddyIds(admin, creatorId, candidateIds);
  return [...eligible];
}

export type PlanAccess = {
  exists: boolean;
  isCreator: boolean;
  participant: PlanParticipantRow | null;
  /** True when the requester may see the plan at all. */
  canView: boolean;
  /** True when the requester may edit plan-level fields (host/co-host). */
  canEdit: boolean;
};

/**
 * Resolves a requester's relationship to a plan in one shot: creator status,
 * their participant row (if any), and derived view/edit rights. A participant
 * whose row is `removed` loses access (spec §19). Non-participants can neither
 * view nor edit.
 */
export async function resolvePlanAccess(
  admin: Admin,
  userId: string,
  planId: string
): Promise<PlanAccess> {
  const { data: plan } = await admin
    .from("plans")
    .select("id, creator_id")
    .eq("id", planId)
    .maybeSingle();

  if (!plan) {
    return { exists: false, isCreator: false, participant: null, canView: false, canEdit: false };
  }

  const isCreator = plan.creator_id === userId;

  const { data: participant } = await admin
    .from("plan_participants")
    .select("role, rsvp_status")
    .eq("plan_id", planId)
    .eq("user_id", userId)
    .maybeSingle();

  const activeParticipant =
    participant && participant.rsvp_status !== "removed" ? (participant as PlanParticipantRow) : null;

  const canView = isCreator || activeParticipant !== null;
  const canEdit =
    isCreator || activeParticipant?.role === "host" || activeParticipant?.role === "co_host";

  return { exists: true, isCreator, participant: activeParticipant, canView, canEdit };
}

/** Number of participants currently marked "going" (spec §26 capacity). */
export async function resolvePlanCapacity(
  admin: Admin,
  planId: string
): Promise<{ goingCount: number; maxParticipants: number }> {
  const [{ count }, { data: plan }] = await Promise.all([
    admin
      .from("plan_participants")
      .select("id", { count: "exact", head: true })
      .eq("plan_id", planId)
      .eq("rsvp_status", "going"),
    admin.from("plans").select("max_participants").eq("id", planId).maybeSingle()
  ]);
  return { goingCount: count ?? 0, maxParticipants: plan?.max_participants ?? 0 };
}

/** Count of the user's non-terminal plans, for tier-limit enforcement (§11). */
export async function activePlanCount(admin: Admin, creatorId: string): Promise<number> {
  const { count } = await admin
    .from("plans")
    .select("id", { count: "exact", head: true })
    .eq("creator_id", creatorId)
    .in("status", ["draft", "inviting", "polling", "confirmed"]);
  return count ?? 0;
}

/** Count of the user's currently active hangout sessions (spec §55). */
/**
 * Statuses that MIGHT still be live. Whether one actually counts as active also
 * depends on `ends_at > now()` — the single canonical definition of an active
 * Hangout used everywhere (RLS `muddies read active hangouts` gates the same
 * way). A session that is expired/cancelled/converted, or whose window has
 * elapsed, is never active.
 */
export const LIVE_HANGOUT_STATUSES = ["active", "paused", "full"] as const;

/**
 * Reconciles a user's own expired-but-unswept sessions: any live-status session
 * whose window has elapsed is flipped to `expired`. There is no background job
 * for this, so it runs on the authoritative reads (activation + page load),
 * making the server the source of truth and stopping stale rows from counting
 * toward the active-Hangout limit forever. Returns how many were reconciled.
 */
export async function sweepExpiredHangouts(admin: Admin, ownerId: string): Promise<number> {
  const nowIso = new Date().toISOString();
  const { data } = await admin
    .from("hangout_sessions")
    .update({ status: "expired", updated_at: nowIso })
    .eq("owner_id", ownerId)
    .in("status", [...LIVE_HANGOUT_STATUSES])
    .lte("ends_at", nowIso)
    .select("id");
  return data?.length ?? 0;
}

/**
 * Count of the user's genuinely-active Hangouts: a live status AND a window
 * that has not yet elapsed. This is the value the activation limit checks. It
 * sweeps first so expired rows are both un-counted here and cleaned up.
 */
export async function activeHangoutCount(admin: Admin, ownerId: string): Promise<number> {
  await sweepExpiredHangouts(admin, ownerId);
  const nowIso = new Date().toISOString();
  const { count } = await admin
    .from("hangout_sessions")
    .select("id", { count: "exact", head: true })
    .eq("owner_id", ownerId)
    .in("status", [...LIVE_HANGOUT_STATUSES])
    .gt("ends_at", nowIso);
  return count ?? 0;
}

/**
 * The user's current canonical active Hangout (or null). Sweeps expired rows
 * first, then returns the single most recent live, not-yet-elapsed session — so
 * a page load/reopen always resolves the authoritative state.
 */
export async function currentActiveHangout(admin: Admin, ownerId: string) {
  await sweepExpiredHangouts(admin, ownerId);
  const nowIso = new Date().toISOString();
  const { data } = await admin
    .from("hangout_sessions")
    .select("id, activity_type, audience_type, message, ends_at, status")
    .eq("owner_id", ownerId)
    .in("status", [...LIVE_HANGOUT_STATUSES])
    .gt("ends_at", nowIso)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data ?? null;
}
