"use server";

import { z } from "zod";
import { requireAdminPermission } from "@/lib/admin/access";
import { recordAdminAuditEvent } from "@/lib/admin/service";
import {
  accountDoctorSummary,
  buildAccountDoctorFindings,
  type AccountDoctorFinding,
  type AccountDoctorSnapshot
} from "@/lib/admin/account-doctor";
import {
  findStalledSafeArrival,
  type SafeArrivalView
} from "@/lib/admin/event-safety-diagnostics";
import { requireSafetyAdmin } from "@/lib/safety/admin";
import { consumeRateLimit, rateLimitMessage } from "@/lib/security/rate-limit";

export type AccountDoctorState = {
  ok: boolean;
  message: string;
  findings: AccountDoctorFinding[];
  summary: { issue: number; attention: number; info: number; healthy: number };
  checkedAt: string | null;
};

export type AccountRefreshSignalState = { ok: boolean; message: string };

const diagnoseSchema = z.object({ userId: z.string().uuid() });
const refreshSchema = z.object({
  userId: z.string().uuid(),
  reason: z.string().trim().max(300).optional()
});

type Admin = Awaited<ReturnType<typeof requireSafetyAdmin>>["admin"];

/**
 * Support-facing Account Doctor.
 *
 * Privacy boundary: this reads lifecycle metadata and counts only. It does not
 * read message bodies, exact coordinates, Safe Arrival details, private media,
 * private circles, contacts, payment credentials or tokens.
 */
export async function diagnoseAccountAction(input: unknown): Promise<AccountDoctorState> {
  const parsed = diagnoseSchema.safeParse(input);
  if (!parsed.success) return empty("Choose a valid account.");

  let admin: Admin;
  let actorId: string;
  try {
    const auth = await requireSafetyAdmin();
    admin = auth.admin;
    actorId = auth.context.userId;
    await requireAdminPermission(admin, auth.context, "admin.support.manage");
    const limit = await consumeRateLimit({ action: "admin.search", userId: actorId });
    if (!limit.allowed) return empty(rateLimitMessage(limit.resetAt));
  } catch {
    return empty("Admin access is required.");
  }

  const userId = parsed.data.userId;
  const nowIso = new Date().toISOString();
  /* `.in()` with an empty array is not a no-op in PostgREST, so an impossible
     id stands in for "match nothing" rather than risking a match-all. */
  const NO_MATCH_UUID = "00000000-0000-0000-0000-000000000000";

  /* Resolved before the batch below: an `await` inside a Promise.all array
     runs before any of its siblings, so nesting this would serialise every
     other query behind it. */
  const closedOwnedSessionIds =
    (
      await admin
        .from("hangout_sessions")
        .select("id")
        .eq("owner_id", userId)
        .in("status", ["expired", "cancelled", "converted_to_plan"])
    ).data?.map((row) => row.id) ?? [];

  const [
    profileResult,
    locationResult,
    statusResult,
    notificationResult,
    pushResult,
    rateLimitResult,
    friendshipResult,
    friendRequestResult,
    blockResult,
    directMembershipResult,
    planParticipantResult,
    upForResult,
    strandedRequestResult,
    safeArrivalResult,
    eventRsvpResult
  ] = await Promise.all([
    admin.from("profiles").select("user_id, is_onboarded, visibility_status, deleted_at").eq("user_id", userId).maybeSingle(),
    admin.from("user_locations").select("user_id").eq("user_id", userId).maybeSingle(),
    admin.from("user_statuses").select("id, expires_at").eq("user_id", userId),
    admin.from("notifications").select("id", { count: "exact", head: true }).eq("user_id", userId).eq("is_read", false),
    admin.from("push_subscriptions").select("id", { count: "exact", head: true }).eq("user_id", userId),
    admin.from("rate_limits").select("id, window_end").eq("user_id", userId),
    admin
      .from("friendships")
      .select("user_one_id, user_two_id, ended_at")
      .or(`user_one_id.eq.${userId},user_two_id.eq.${userId}`)
      .is("ended_at", null),
    admin
      .from("friend_requests")
      .select("id", { count: "exact", head: true })
      .eq("status", "pending")
      .or(`sender_id.eq.${userId},receiver_id.eq.${userId}`),
    admin
      .from("blocked_users")
      .select("blocker_id, blocked_id")
      .or(`blocker_id.eq.${userId},blocked_id.eq.${userId}`),
    admin.from("conversation_members").select("conversation_id, status").eq("user_id", userId),
    admin
      .from("plan_participants")
      .select("plan_id, rsvp_status")
      .eq("user_id", userId)
      .in("rsvp_status", ["going", "maybe"]),
    admin
      .from("hangout_sessions")
      .select("id, status, ends_at")
      .eq("owner_id", userId)
      .in("status", ["active", "full"]),
    /* Requests left waiting on the viewer's own CLOSED UpFors. Someone asked
       to join something that is over and will never be answered as it
       stands -- ids and status only, never who asked. */
    admin
      .from("hangout_requests")
      .select("id, hangout_session_id, status")
      .eq("status", "pending")
      .in("hangout_session_id", closedOwnedSessionIds.length ? closedOwnedSessionIds : [NO_MATCH_UUID]),
    /* SAFE ARRIVAL, LIFECYCLE ONLY. No destination, label, note, coordinates
       or watcher identity is selected here, and none may be added -- see
       lib/admin/event-safety-diagnostics.ts. `expected_arrival_at` and
       `grace_period_minutes` are read to compute a BOOLEAN and are never
       carried into the snapshot. */
    admin
      .from("safe_arrival_sessions")
      .select("id, status, expected_arrival_at, grace_period_minutes")
      .eq("traveller_id", userId)
      .in("status", ["draft", "pending_acknowledgement", "active", "grace_period", "extended", "unconfirmed"]),
    admin.from("event_rsvps").select("event_id, status").eq("user_id", userId).eq("status", "going")
  ]);

  const profile = profileResult.data;
  if (!profile || profile.deleted_at) return empty("That account is unavailable.");

  const directMemberships = directMembershipResult.data ?? [];
  const conversationIds = [...new Set(directMemberships.map((row) => row.conversation_id))];
  const directConversations = conversationIds.length
    ? (
        await admin
          .from("conversations")
          .select("id, conversation_type, direct_key, status")
          .in("id", conversationIds)
          .eq("conversation_type", "direct")
      ).data ?? []
    : [];

  const activeFriendIds = new Set(
    (friendshipResult.data ?? []).map((row) => (row.user_one_id === userId ? row.user_two_id : row.user_one_id))
  );
  const blockedIds = new Set(
    (blockResult.data ?? []).map((row) => (row.blocker_id === userId ? row.blocked_id : row.blocker_id))
  );
  const eligibleFriendIds = new Set([...activeFriendIds].filter((id) => !blockedIds.has(id)));

  const directById = new Map(directConversations.map((row) => [row.id, row]));
  let archivedDirectWithLiveFriendshipCount = 0;
  let nonJoinedDirectMembershipCount = 0;
  for (const membership of directMemberships) {
    const conversation = directById.get(membership.conversation_id);
    if (!conversation) continue;
    const otherId = otherUserFromDirectKey(conversation.direct_key, userId);
    if (!otherId || !eligibleFriendIds.has(otherId)) continue;
    if (conversation.status === "archived") archivedDirectWithLiveFriendshipCount += 1;
    if (membership.status !== "joined") nonJoinedDirectMembershipCount += 1;
  }

  const relevantPlanIds = [...new Set((planParticipantResult.data ?? []).map((row) => row.plan_id))];
  let planChatMismatchCount = 0;
  if (relevantPlanIds.length > 0) {
    const planConversations = (
      await admin
        .from("conversations")
        .select("id, context_id")
        .eq("context_type", "plan")
        .in("context_id", relevantPlanIds)
    ).data ?? [];
    const planConversationIds = planConversations.map((row) => row.id);
    const joinedIds = new Set<string>();
    if (planConversationIds.length > 0) {
      const memberships = (
        await admin
          .from("conversation_members")
          .select("conversation_id")
          .eq("user_id", userId)
          .eq("status", "joined")
          .in("conversation_id", planConversationIds)
      ).data ?? [];
      for (const membership of memberships) joinedIds.add(membership.conversation_id);
    }
    const conversationByPlan = new Map(
      planConversations
        .filter((row): row is typeof row & { context_id: string } => Boolean(row.context_id))
        .map((row) => [row.context_id, row.id])
    );
    planChatMismatchCount = relevantPlanIds.filter((planId) => {
      const conversationId = conversationByPlan.get(planId);
      return !conversationId || !joinedIds.has(conversationId);
    }).length;
  }

  /* Events the account said it is GOING to, but whose circle it is not a
     joined member of. Only "going" matters -- interested is not circle
     membership, and treating it as a mismatch would report every browsed
     Event as broken. */
  let eventCircleMismatchCount = 0;
  const goingEventIds = [...new Set((eventRsvpResult.data ?? []).map((row) => row.event_id))];
  if (goingEventIds.length > 0) {
    const circles =
      (await admin.from("event_circles").select("id, event_id").in("event_id", goingEventIds)).data ?? [];
    const circleIds = circles.map((row) => row.id);
    const joinedCircleIds = new Set(
      circleIds.length
        ? (
            (
              await admin
                .from("event_circle_members")
                .select("event_circle_id")
                .eq("user_id", userId)
                .eq("status", "joined")
                .in("event_circle_id", circleIds)
            ).data ?? []
          ).map((row) => row.event_circle_id)
        : []
    );
    eventCircleMismatchCount = circles.filter((row) => !joinedCircleIds.has(row.id)).length;
  }

  const snapshot: AccountDoctorSnapshot = {
    isOnboarded: Boolean(profile.is_onboarded),
    visibilityStatus: profile.visibility_status ?? null,
    hasLocationSignal: Boolean(locationResult.data),
    staleStatusCount: (statusResult.data ?? []).filter((row) => Boolean(row.expires_at) && row.expires_at! <= nowIso).length,
    unreadNotificationCount: notificationResult.count ?? 0,
    pushDeviceCount: pushResult.count ?? 0,
    activeRateLimitCount: (rateLimitResult.data ?? []).filter((row) => row.window_end > nowIso).length,
    activeFriendshipCount: activeFriendIds.size,
    pendingFriendRequestCount: friendRequestResult.count ?? 0,
    blockCount: blockedIds.size,
    archivedDirectWithLiveFriendshipCount,
    nonJoinedDirectMembershipCount,
    planChatMismatchCount,
    staleOwnedUpForCount: (upForResult.data ?? []).filter((row) => Boolean(row.ends_at) && row.ends_at! <= nowIso).length,
    strandedUpForRequestCount: (strandedRequestResult.data ?? []).length,
    /* Reduced to counts HERE, at the query boundary, so no journey timing or
       destination travels any further into Admin. The booleans the diagnostic
       module needs are computed from expected_arrival_at + grace minutes and
       then discarded with the rows. */
    stalledSafeArrivalCount: findStalledSafeArrival(
      (safeArrivalResult.data ?? []).map((row) => ({
        sessionId: row.id,
        status: row.status as SafeArrivalView["status"],
        pastExpectedArrival: Boolean(row.expected_arrival_at) && row.expected_arrival_at! <= nowIso,
        pastGracePeriod:
          Boolean(row.expected_arrival_at) &&
          Date.parse(row.expected_arrival_at!) + (row.grace_period_minutes ?? 0) * 60_000 <= Date.now(),
        acknowledgedWatcherCount: 0,
        pendingWatcherCount: 0
      }))
    ).length,
    unconfirmedSafeArrivalCount: (safeArrivalResult.data ?? []).filter((row) => row.status === "unconfirmed").length,
    eventCircleMismatchCount: eventCircleMismatchCount
  };

  const findings = buildAccountDoctorFindings(snapshot);
  return {
    ok: true,
    message: findings.some((finding) => finding.severity === "issue" || finding.severity === "attention")
      ? "Account Doctor found items that may need attention."
      : "Account Doctor found no obvious lifecycle mismatch.",
    findings,
    summary: accountDoctorSummary(findings),
    checkedAt: nowIso
  };
}

/**
 * Safe "quick refresh" requested by Support.
 *
 * This deliberately changes no account data. The audit event itself is the
 * opaque version signal consumed by /api/account/support-refresh. An already
 * open authenticated app notices the new version on focus/foreground or the
 * lightweight heartbeat and refreshes its canonical server render.
 */
export async function signalAccountRefreshAction(input: unknown): Promise<AccountRefreshSignalState> {
  const parsed = refreshSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Choose a valid account." };

  let admin: Admin;
  let actorId: string;
  try {
    const auth = await requireSafetyAdmin();
    admin = auth.admin;
    actorId = auth.context.userId;
    await requireAdminPermission(admin, auth.context, "admin.support.manage");
    const limit = await consumeRateLimit({ action: "admin.mutate", userId: actorId });
    if (!limit.allowed) return { ok: false, message: rateLimitMessage(limit.resetAt) };
  } catch {
    return { ok: false, message: "You don't have permission to refresh this account." };
  }

  const { data: profile } = await admin
    .from("profiles")
    .select("user_id, deleted_at")
    .eq("user_id", parsed.data.userId)
    .maybeSingle();
  if (!profile || profile.deleted_at) return { ok: false, message: "That account is unavailable." };

  const logged = await recordAdminAuditEvent(admin, {
    actorId,
    action: "repair:refresh_account_state",
    targetType: "user",
    targetId: parsed.data.userId,
    newState: { signal: "canonical_refresh" },
    reason: parsed.data.reason || "Support requested account refresh"
  });
  if (!logged) return { ok: false, message: "The refresh could not be audited, so no signal was sent." };

  return {
    ok: true,
    message: "Refresh signal sent. An open Mad Buddy session will refresh on its next foreground check or heartbeat."
  };
}

function otherUserFromDirectKey(directKey: string | null, userId: string): string | null {
  if (!directKey) return null;
  const pair = directKey.split(":");
  if (pair.length !== 2 || !pair.includes(userId)) return null;
  return pair[0] === userId ? pair[1] ?? null : pair[0] ?? null;
}

function empty(message: string): AccountDoctorState {
  return {
    ok: false,
    message,
    findings: [],
    summary: { issue: 0, attention: 0, info: 0, healthy: 0 },
    checkedAt: null
  };
}
