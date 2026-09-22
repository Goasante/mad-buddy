import "server-only";

import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { acceptFriendRequest, type ServiceResult } from "@/lib/friends/service";
import { createRequestId, errorType, logBackendEvent } from "@/lib/observability/logger";
import { consumeRateLimit, rateLimitMessage } from "@/lib/security/rate-limit";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import type { Database } from "@/lib/supabase/database.types";

const uuidSchema = z.string().uuid();
const PASS_COOLDOWN_MS = 30 * 24 * 60 * 60 * 1000;

type Admin = ReturnType<typeof createSupabaseAdminClient>;

async function settleReciprocalInterest(
  admin: Admin,
  rlsClient: SupabaseClient<Database>,
  userId: string,
  targetId: string,
  incomingRequestId: string
): Promise<ServiceResult> {
  const matched = await acceptFriendRequest(rlsClient, userId, incomingRequestId);
  if (matched.ok) {
    return { ...matched, message: "You both chose to connect — you're Muddies now." };
  }

  // An exactly-simultaneous pair of swipes can race through two acceptance
  // calls. The canonical RPC serializes the relationship and settles every
  // pending request for the pair; if this caller loses that race, the
  // friendship may already be real even though its own RPC reports that the
  // request was handled. Re-read the canonical relationship before showing a
  // false failure.
  const low = userId < targetId ? userId : targetId;
  const high = userId < targetId ? targetId : userId;
  const { data: friendship } = await admin
    .from("friendships")
    .select("id")
    .eq("user_one_id", low)
    .eq("user_two_id", high)
    .is("ended_at", null)
    .maybeSingle();

  return friendship
    ? { ok: true, message: "You both chose to connect — you're Muddies now." }
    : matched;
}

/**
 * Record a RIGHT swipe in Linkr without exposing it to the recipient.
 *
 * The first choice is private: no notification and no entry in the normal
 * Requests inbox. If the other person independently chooses the same profile,
 * their action finds this pending Linkr interest and accepts it atomically via
 * the canonical friend-request acceptance path. Only then does a friendship
 * exist and the normal accepted notification become appropriate.
 */
export async function sendLinkrInterest(
  rlsClient: SupabaseClient<Database>,
  userId: string,
  targetUserId: string
): Promise<ServiceResult> {
  const requestId = createRequestId();
  const parsedTarget = uuidSchema.safeParse(targetUserId);
  if (!parsedTarget.success) return { ok: false, message: "That profile is no longer available." };
  const targetId = parsedTarget.data;
  if (targetId === userId) return { ok: false, message: "You cannot choose your own profile." };

  const admin = createSupabaseAdminClient();
  const nowIso = new Date().toISOString();

  // A Linkr choice is only valid while both people are actively discoverable.
  // This prevents an old card or crafted request from creating hidden interest
  // after either person has left Linkr.
  const [sessionsResult, blockResult, friendshipResult, pairRequestsResult] = await Promise.all([
    admin
      .from("socialize_sessions")
      .select("user_id")
      .in("user_id", [userId, targetId])
      .eq("status", "active")
      .gt("expires_at", nowIso),
    admin
      .from("blocked_users")
      .select("id")
      .or(`and(blocker_id.eq.${userId},blocked_id.eq.${targetId}),and(blocker_id.eq.${targetId},blocked_id.eq.${userId})`)
      .limit(1),
    admin
      .from("friendships")
      .select("id")
      .or(`and(user_one_id.eq.${userId},user_two_id.eq.${targetId}),and(user_one_id.eq.${targetId},user_two_id.eq.${userId})`)
      .is("ended_at", null)
      .limit(1),
    admin
      .from("friend_requests")
      .select("id, sender_id, receiver_id, status, context_type, created_at, responded_at")
      .or(`and(sender_id.eq.${userId},receiver_id.eq.${targetId}),and(sender_id.eq.${targetId},receiver_id.eq.${userId})`)
      .order("created_at", { ascending: false })
      .limit(20)
  ]);

  if (sessionsResult.error || blockResult.error || friendshipResult.error || pairRequestsResult.error) {
    return { ok: false, message: "Couldn't save that choice. Try again." };
  }
  if (new Set((sessionsResult.data ?? []).map((row) => row.user_id)).size !== 2) {
    return { ok: false, message: "That profile is no longer available in Linkr." };
  }
  if (blockResult.data?.length) return { ok: false, message: "That profile is no longer available in Linkr." };
  if (friendshipResult.data?.length) return { ok: false, message: "This person is already your Muddy." };

  const pairRequests = pairRequestsResult.data ?? [];
  const incomingPending = pairRequests.find(
    (row) => row.status === "pending" && row.receiver_id === userId
  );
  if (incomingPending) {
    if (incomingPending.context_type === "socialize") {
      // Reciprocal choice. Use the canonical acceptance service so friendship
      // lifecycle, achievements and post-match notification all stay in one
      // place. The recipient still never learned about the first swipe before
      // making this choice themselves.
      return settleReciprocalInterest(admin, rlsClient, userId, targetId, incomingPending.id);
    }

    // An ordinary incoming Muddy request is a different product surface. Do
    // not silently accept it just because this person appeared in Linkr.
    return {
      ok: false,
      message: "You already have a Muddy request from this person. Open Requests to respond.",
      reason: "incoming_request_exists"
    };
  }

  const outgoingPending = pairRequests.find(
    (row) => row.status === "pending" && row.sender_id === userId
  );
  if (outgoingPending) {
    return {
      ok: true,
      message: "Choice saved. If they choose you too, you'll connect.",
      resourceId: outgoingPending.id
    };
  }

  // If the other person passed on this user's earlier Linkr interest, the
  // declined request acts as a private 30-day cooldown for the sender too.
  // It prevents repeated right-swipes from pressuring somebody who already
  // made a choice, while allowing a completely fresh encounter later.
  const recentDecline = pairRequests.find((row) => {
    if (row.sender_id !== userId || row.context_type !== "socialize" || row.status !== "declined") return false;
    const declinedAt = Date.parse(row.responded_at ?? row.created_at);
    return Number.isFinite(declinedAt) && Date.now() - declinedAt < PASS_COOLDOWN_MS;
  });
  if (recentDecline) {
    return { ok: true, message: "Choice noted. Linkr will give this connection some space for now." };
  }

  const rate = await consumeRateLimit({ action: "friends.request", userId, requestId });
  if (!rate.allowed) return { ok: false, message: rateLimitMessage(rate.resetAt) };

  const { data: created, error } = await admin
    .from("friend_requests")
    .insert({
      sender_id: userId,
      receiver_id: targetId,
      status: "pending",
      context_type: "socialize"
    })
    .select("id")
    .single();

  if (error || !created) {
    logBackendEvent("warn", {
      requestId,
      action: "linkr.interest",
      userId,
      statusCode: 500,
      errorType: errorType(error)
    });
    return { ok: false, message: "Couldn't save that choice. Try again." };
  }

  // Close the small race where both people choose each other at nearly the
  // same time after both initial reads saw no pending row. If the opposite
  // hidden interest now exists, the current user is its receiver and can use
  // the canonical acceptance RPC immediately.
  const { data: reciprocal } = await admin
    .from("friend_requests")
    .select("id")
    .eq("sender_id", targetId)
    .eq("receiver_id", userId)
    .eq("status", "pending")
    .eq("context_type", "socialize")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (reciprocal) {
    return settleReciprocalInterest(admin, rlsClient, userId, targetId, reciprocal.id);
  }

  // Deliberately no notification. The request is an internal reciprocity
  // signal, not an invitation the recipient has to answer.
  logBackendEvent("info", { requestId, action: "linkr.interest", userId, statusCode: 200 });
  return {
    ok: true,
    message: "Choice saved. If they choose you too, you'll connect.",
    resourceId: created.id,
    created: true
  };
}
