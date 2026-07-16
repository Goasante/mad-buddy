import "server-only";

import { areApprovedMuddies, isBlockedEitherDirection } from "@/lib/social/permissions";
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

/** Filters a candidate invitee list down to the eligible ids (batched-ish). */
export async function eligibleInvitees(
  admin: Admin,
  creatorId: string,
  candidateIds: string[]
): Promise<string[]> {
  const unique = [...new Set(candidateIds)].filter((id) => id && id !== creatorId);
  const results = await Promise.all(
    unique.map(async (id) => ((await canInviteToPlan(admin, creatorId, id)) ? id : null))
  );
  return results.filter((id): id is string => id !== null);
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
export async function activeHangoutCount(admin: Admin, ownerId: string): Promise<number> {
  const { count } = await admin
    .from("hangout_sessions")
    .select("id", { count: "exact", head: true })
    .eq("owner_id", ownerId)
    .in("status", ["active", "paused", "full"]);
  return count ?? 0;
}
