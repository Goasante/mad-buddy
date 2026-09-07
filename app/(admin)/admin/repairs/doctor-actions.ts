"use server";

import { z } from "zod";
import { requireAdminPermission } from "@/lib/admin/access";
import {
  accountDoctorSummary,
  buildAccountDoctorFindings,
  type AccountDoctorFinding,
  type AccountDoctorSnapshot
} from "@/lib/admin/account-doctor";
import { requireSafetyAdmin } from "@/lib/safety/admin";
import { consumeRateLimit, rateLimitMessage } from "@/lib/security/rate-limit";

export type AccountDoctorState = {
  ok: boolean;
  message: string;
  findings: AccountDoctorFinding[];
  summary: { issue: number; attention: number; info: number; healthy: number };
  checkedAt: string | null;
};

const diagnoseSchema = z.object({ userId: z.string().uuid() });

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
    upForResult
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
      .in("status", ["active", "full"])
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
    staleOwnedUpForCount: (upForResult.data ?? []).filter((row) => Boolean(row.ends_at) && row.ends_at! <= nowIso).length
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
