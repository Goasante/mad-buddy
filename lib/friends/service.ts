import "server-only";

import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { deliverNotification } from "@/lib/notifications/server";
import { createRequestId, errorType, logBackendEvent } from "@/lib/observability/logger";
import { consumeRateLimit, rateLimitMessage } from "@/lib/security/rate-limit";
import { getSupabaseBrowserEnv, getSupabaseServerEnv } from "@/lib/supabase/env";
import type { Database } from "@/lib/supabase/database.types";

/**
 * Transport-agnostic Muddies (friends) service.
 *
 * These functions take an already-authenticated `userId` and never touch
 * cookies or `revalidatePath`, so the same logic serves BOTH callers:
 *
 *  - Web Server Actions in `app/(app)/actions.ts` (thin wrappers that resolve
 *    the cookie session, call these, then `revalidatePath`).
 *  - Mobile route handlers under `app/api/friends/*` (dual-auth + CORS).
 *
 * The sender/actor is always resolved by the caller from a verified session
 * (cookie or bearer token) and passed in — it can never be forged by the body.
 */

export type ServiceResult = { ok: boolean; message: string };

export type SearchUserResult = {
  id: string;
  displayName: string;
  username: string;
  avatarUrl: string | null;
  mutualFriends: number;
  status: "available";
  note: string;
};

export type SearchUsersResult = ServiceResult & { users: SearchUserResult[] };

const uuidSchema = z.string().uuid();

function browserEnvMessage(): string | null {
  const env = getSupabaseBrowserEnv();
  if (!env.url || !env.anonKey) {
    return "Supabase is not configured yet. Add .env.local values and restart the dev server.";
  }
  return null;
}

function serviceRoleEnvMessage(): string | null {
  const env = getSupabaseServerEnv();
  if (!env.url || !env.serviceRoleKey) {
    return "This action needs SUPABASE_SERVICE_ROLE_KEY for secure server-side writes.";
  }
  return null;
}

function orderedPair(userId: string, friendId: string) {
  return userId < friendId
    ? { user_one_id: userId, user_two_id: friendId }
    : { user_one_id: friendId, user_two_id: userId };
}

/** Search public profile fields by username or name (server-side, rate limited). */
export async function searchUsers(userId: string, query: string): Promise<SearchUsersResult> {
  const requestId = createRequestId();
  const startedAt = Date.now();

  const envMessage = browserEnvMessage() ?? serviceRoleEnvMessage();
  if (envMessage) {
    return { ok: false, message: envMessage, users: [] };
  }

  const rateLimit = await consumeRateLimit({ action: "friends.search", userId, requestId });
  if (!rateLimit.allowed) {
    return { ok: false, message: rateLimitMessage(rateLimit.resetAt), users: [] };
  }

  const normalizedQuery = query.trim().toLowerCase();
  if (normalizedQuery.length < 2) {
    return { ok: false, message: "Type at least 2 characters.", users: [] };
  }

  // Search runs server-side and returns only the public profile fields needed
  // to send a request. This avoids relying on broad client-readable profile RLS.
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("profiles")
    .select("user_id, full_name, username, avatar_url")
    .or(`username.ilike.%${normalizedQuery}%,full_name.ilike.%${normalizedQuery}%`)
    .is("deleted_at", null)
    .limit(10);

  if (error) {
    logBackendEvent("warn", {
      requestId,
      action: "friends.search",
      statusCode: 500,
      latencyMs: Date.now() - startedAt,
      userId,
      errorType: errorType(error)
    });
    return { ok: false, message: "Search is unavailable right now.", users: [] };
  }

  const otherProfiles = data.filter((profile) => profile.user_id !== userId);

  if (otherProfiles.length === 0 && data.some((profile) => profile.user_id === userId)) {
    return { ok: false, message: "This is your account. Search for another username.", users: [] };
  }

  logBackendEvent("info", {
    requestId,
    action: "friends.search",
    statusCode: 200,
    latencyMs: Date.now() - startedAt,
    userId
  });

  return {
    ok: true,
    message: `${otherProfiles.length} users found.`,
    users: otherProfiles.map((profile) => ({
      id: profile.user_id,
      displayName: profile.full_name,
      username: profile.username,
      avatarUrl: profile.avatar_url,
      mutualFriends: 0,
      status: "available",
      note: "Search result"
    }))
  };
}

/** Send a pending Muddy request from `userId` to `targetUserId`. */
export async function sendFriendRequest(userId: string, targetUserId: string): Promise<ServiceResult> {
  const requestId = createRequestId();
  const startedAt = Date.now();

  const envMessage = browserEnvMessage() ?? serviceRoleEnvMessage();
  if (envMessage) {
    return { ok: false, message: envMessage };
  }

  const parsedTarget = uuidSchema.safeParse(targetUserId);
  if (!parsedTarget.success) {
    return { ok: false, message: "Select a real searched user before sending a request." };
  }

  if (userId === parsedTarget.data) {
    return { ok: false, message: "You cannot send a request to yourself." };
  }

  const admin = createSupabaseAdminClient();
  const { data: existingProfile } = await admin
    .from("profiles")
    .select("user_id")
    .eq("user_id", userId)
    .maybeSingle();

  if (!existingProfile) {
    const { data: authUser } = await admin.auth.admin.getUserById(userId);
    const metadata = authUser.user?.user_metadata;
    const emailPrefix = authUser.user?.email?.split("@")[0] ?? "muddy";
    const usernameBase =
      typeof metadata?.username === "string" && metadata.username.length >= 3
        ? metadata.username
        : emailPrefix;
    const username = `${usernameBase.toLowerCase().replace(/[^a-z0-9_]/g, "_").slice(0, 16)}_${userId.slice(0, 6)}`;
    const fullName =
      typeof metadata?.full_name === "string" && metadata.full_name.trim()
        ? metadata.full_name.trim()
        : "Mad Buddy user";

    await admin.from("profiles").upsert({
      user_id: userId,
      full_name: fullName,
      username,
      is_onboarded: false
    });
  }

  const { data: pendingRequests } = await admin
    .from("friend_requests")
    .select("sender_id, receiver_id")
    .eq("status", "pending")
    .or(
      `and(sender_id.eq.${userId},receiver_id.eq.${parsedTarget.data}),and(sender_id.eq.${parsedTarget.data},receiver_id.eq.${userId})`
    );
  const existingRequest = pendingRequests?.[0];

  const pair = orderedPair(userId, parsedTarget.data);
  const [{ data: existingFriendship }, { data: existingBlock }] = await Promise.all([
    admin.from("friendships").select("id").match(pair).maybeSingle(),
    admin
      .from("blocked_users")
      .select("id")
      .or(
        `and(blocker_id.eq.${userId},blocked_id.eq.${parsedTarget.data}),and(blocker_id.eq.${parsedTarget.data},blocked_id.eq.${userId})`
      )
      .limit(1)
      .maybeSingle()
  ]);

  if (existingFriendship) {
    return { ok: false, message: "This person is already your Muddy." };
  }

  if (existingBlock) {
    return { ok: false, message: "A Muddy request cannot be sent for this account." };
  }

  if (existingRequest) {
    if (existingRequest.sender_id === userId) {
      return { ok: true, message: "Your request is already pending." };
    }
    return { ok: false, message: "This user already sent you a request. Open Requests to respond." };
  }

  const rateLimit = await consumeRateLimit({ action: "friends.request", userId, requestId });
  if (!rateLimit.allowed) {
    return { ok: false, message: rateLimitMessage(rateLimit.resetAt) };
  }

  // Friend-request inserts (and the notification below) must use the service
  // role: client-exposure hardening revoked INSERT on friend_requests and
  // notifications from the authenticated role, so the anon/cookie client is
  // denied. The sender is already resolved from the authenticated session, so
  // this is safe — sender_id can't be forged.
  const { error } = await admin.from("friend_requests").insert({
    sender_id: userId,
    receiver_id: parsedTarget.data,
    status: "pending"
  });

  if (error) {
    logBackendEvent("warn", {
      requestId,
      action: "friends.request",
      statusCode: 500,
      latencyMs: Date.now() - startedAt,
      userId,
      errorType: errorType(error)
    });
    return { ok: false, message: "The Muddy request could not be sent." };
  }

  const { data: senderProfile } = await admin
    .from("profiles")
    .select("full_name")
    .eq("user_id", userId)
    .maybeSingle();

  {
    const { recordMilestone } = await import("@/lib/onboarding/service");
    await recordMilestone(admin, userId, "first_request_sent");
  }

  await deliverNotification(admin, {
    userId: parsedTarget.data,
    senderId: userId,
    type: "friend_request_received",
    title: "Muddy request received",
    message: `${senderProfile?.full_name ?? "Someone"} wants to connect before any glow signals appear.`
  });

  logBackendEvent("info", {
    requestId,
    action: "friends.request",
    statusCode: 200,
    latencyMs: Date.now() - startedAt,
    userId
  });

  return { ok: true, message: "Muddy request sent." };
}

/**
 * Accept a pending Muddy request. The state transition runs through the
 * `accept_friend_request` RPC under the CALLER's RLS (so only the receiver can
 * accept), which is why the user-scoped client is passed in — the cookie
 * server client for web, the bearer-scoped client for mobile.
 */
export async function acceptFriendRequest(
  rlsClient: SupabaseClient<Database>,
  userId: string,
  requestId: string
): Promise<ServiceResult> {
  const envMessage = browserEnvMessage() ?? serviceRoleEnvMessage();
  if (envMessage) {
    return { ok: false, message: envMessage };
  }

  const parsedRequest = uuidSchema.safeParse(requestId);
  if (!parsedRequest.success) {
    return { ok: false, message: "Select a real request before accepting." };
  }

  const { data: settledRows, error: settleError } = await rlsClient.rpc("accept_friend_request", {
    p_request_id: parsedRequest.data
  });
  const request = settledRows?.[0];

  if (settleError || !request) {
    return {
      ok: false,
      message:
        settleError?.code === "P0002"
          ? "This request has already been handled."
          : "Request not found."
    };
  }

  const admin = createSupabaseAdminClient();

  // Both sides now have a Muddy; the sender's request was also accepted.
  {
    const [{ recordMilestone }, { grantAchievement }] = await Promise.all([
      import("@/lib/onboarding/service"),
      import("@/lib/engagement/achievements")
    ]);
    await Promise.all([
      recordMilestone(admin, userId, "first_muddy_added"),
      recordMilestone(admin, request.sender_id, "first_muddy_added"),
      recordMilestone(admin, request.sender_id, "first_request_accepted"),
      grantAchievement(admin, userId, "first_muddy"),
      grantAchievement(admin, request.sender_id, "first_muddy")
    ]);
  }

  const { data: receiverProfile } = await admin
    .from("profiles")
    .select("full_name")
    .eq("user_id", userId)
    .maybeSingle();

  await deliverNotification(admin, {
    userId: request.sender_id,
    senderId: userId,
    type: "friend_request_accepted",
    title: `${receiverProfile?.full_name ?? "A Muddy"} is now your Muddy`,
    message: "Your Muddy request was accepted."
  });

  return { ok: true, message: "Muddy request accepted." };
}

/** Decline (as receiver) or cancel (as sender) a pending request. */
export async function updateFriendRequestStatus(
  userId: string,
  requestId: string,
  status: "declined" | "cancelled"
): Promise<ServiceResult> {
  const envMessage = browserEnvMessage();
  if (envMessage) {
    return { ok: false, message: envMessage };
  }

  const parsedRequest = uuidSchema.safeParse(requestId);
  if (!parsedRequest.success) {
    return { ok: false, message: "Select a real request first." };
  }

  const admin = createSupabaseAdminClient();
  const participantColumn = status === "declined" ? "receiver_id" : "sender_id";
  const { data: updatedRequest, error } = await admin
    .from("friend_requests")
    .update({ status, responded_at: new Date().toISOString() })
    .eq("id", parsedRequest.data)
    .eq("status", "pending")
    .eq(participantColumn, userId)
    .select("id")
    .maybeSingle();

  if (error) {
    return { ok: false, message: "The request could not be updated." };
  }

  if (!updatedRequest) {
    return { ok: false, message: "This request has already been handled." };
  }

  return { ok: true, message: `Request ${status}.` };
}
