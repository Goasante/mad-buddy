import "server-only";

import { z } from "zod";
import { loadEffectivePlansForUsers } from "@/lib/billing/service";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { hasVerifiedAccountStatus, type VerificationRow } from "@/lib/trust/verified-account";
import { deliverNotification } from "@/lib/notifications/server";
import { createRequestId, errorType, logBackendEvent } from "@/lib/observability/logger";
import { consumeRateLimit, rateLimitMessage } from "@/lib/security/rate-limit";
import { getSupabaseBrowserEnv, getSupabaseServerEnv } from "@/lib/supabase/env";
import type { Database, SubscriptionPlan } from "@/lib/supabase/database.types";
import { isSocializeEnabled } from "@/lib/features/feature-flags";

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

/**
 * `reason` is a STABLE CODE for callers that must branch on why.
 *
 * Added because a caller was matching on the message text to tell "they
 * already sent you a request" apart from an ordinary failure -- and a copy
 * edit would silently have broken it. The message stays the thing users read;
 * this is the thing code reads.
 */
export type ServiceFailureReason = "incoming_request_exists";

export type ServiceResult = {
  ok: boolean;
  message: string;
  resourceId?: string;
  created?: boolean;
  reason?: ServiceFailureReason;
};

export type SearchUserResult = {
  id: string;
  displayName: string;
  username: string;
  avatarUrl: string | null;
  mutualFriends: number;
  status: "available";
  note: string;
  plan: SubscriptionPlan;
  /**
   * Mad Buddy has verified this account. Independent of plan and of Trusted
   * Member, and it never affects where a result ranks.
   */
  isVerifiedAccount: boolean;
};

export type SearchUsersResult = ServiceResult & { users: SearchUserResult[] };

export type IncomingRequest = {
  id: string;
  senderId: string;
  displayName: string;
  username: string;
  avatarUrl: string | null;
  createdAt: string;
  plan: SubscriptionPlan;
};

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

export type MuddyListItem = {
  id: string;
  displayName: string;
  username: string;
  avatarUrl: string | null;
  plan: SubscriptionPlan;
};

/** The user's approved Muddies (friends), alphabetical. Read-only; the mobile
 * Muddies screen merges these with /api/friends/nearby for live proximity. */
export async function listMuddies(userId: string): Promise<ServiceResult & { muddies: MuddyListItem[] }> {
  const envMessage = browserEnvMessage() ?? serviceRoleEnvMessage();
  if (envMessage) return { ok: false, message: envMessage, muddies: [] };

  const admin = createSupabaseAdminClient();
  const { data: friendships } = await admin
    .from("friendships")
    .select("user_one_id, user_two_id")
    .or(`user_one_id.eq.${userId},user_two_id.eq.${userId}`)
    .is("ended_at", null);

  const friendIds = (friendships ?? []).map((row) => (row.user_one_id === userId ? row.user_two_id : row.user_one_id));
  if (friendIds.length === 0) return { ok: true, message: "ok", muddies: [] };

  const [{ data: profiles }, plans] = await Promise.all([
    admin
      .from("profiles")
      .select("user_id, full_name, username, avatar_url")
      .in("user_id", friendIds)
      .is("deleted_at", null),
    loadEffectivePlansForUsers(admin, friendIds)
  ]);

  return {
    ok: true,
    message: "ok",
    muddies: (profiles ?? [])
      .map((profile) => ({
        id: profile.user_id,
        displayName: profile.full_name,
        username: profile.username,
        avatarUrl: profile.avatar_url,
        plan: plans.get(profile.user_id) ?? "free"
      }))
      .sort((a, b) => a.displayName.localeCompare(b.displayName))
  };
}

export type MuddyCircle = { id: string; name: string; icon: string | null; memberIds: string[] };
export type BlockedMuddy = { id: string; displayName: string; username: string; avatarUrl: string | null };

export type MuddyNetwork = ServiceResult & {
  muddies: MuddyListItem[];
  closeFriendIds: string[];
  circles: MuddyCircle[];
  blocked: BlockedMuddy[];
};

/**
 * Everything the Muddies screen needs in one round trip: approved Muddies,
 * close-friend ids, the user's circles (+ members), and blocked accounts.
 * Mirrors the web `friends/page.tsx` loader so the mobile tabs (All / Circles /
 * Close Friends / Blocked) show the same data. Read-only.
 */
export async function listMuddyNetwork(userId: string): Promise<MuddyNetwork> {
  const envMessage = browserEnvMessage() ?? serviceRoleEnvMessage();
  if (envMessage) {
    return { ok: false, message: envMessage, muddies: [], closeFriendIds: [], circles: [], blocked: [] };
  }

  const admin = createSupabaseAdminClient();
  const [friendsResult, closeRows, circleRows, blockedRows] = await Promise.all([
    listMuddies(userId),
    admin.from("close_friend_relationships").select("friend_id").eq("owner_id", userId),
    admin
      .from("friend_circles")
      .select("id, name, icon")
      .eq("user_id", userId)
      .is("archived_at", null)
      .order("created_at", { ascending: true }),
    admin.from("blocked_users").select("blocked_id").eq("blocker_id", userId)
  ]);

  const closeFriendIds = (closeRows.data ?? []).map((row) => row.friend_id);

  // Resolve circle members.
  const circles = circleRows.data ?? [];
  let membersByCircle = new Map<string, string[]>();
  if (circles.length > 0) {
    const { data: members } = await admin
      .from("circle_members")
      .select("circle_id, friend_id")
      .in("circle_id", circles.map((circle) => circle.id));
    membersByCircle = new Map<string, string[]>();
    for (const member of members ?? []) {
      if (!membersByCircle.has(member.circle_id)) membersByCircle.set(member.circle_id, []);
      membersByCircle.get(member.circle_id)!.push(member.friend_id);
    }
  }

  // Resolve blocked profiles.
  const blockedIds = (blockedRows.data ?? []).map((row) => row.blocked_id);
  let blocked: BlockedMuddy[] = [];
  if (blockedIds.length > 0) {
    const { data: blockedProfiles } = await admin
      .from("profiles")
      .select("user_id, full_name, username, avatar_url")
      .in("user_id", blockedIds);
    blocked = (blockedProfiles ?? []).map((profile) => ({
      id: profile.user_id,
      displayName: profile.full_name,
      username: profile.username,
      avatarUrl: profile.avatar_url
    }));
  }

  return {
    ok: friendsResult.ok,
    message: friendsResult.message,
    muddies: friendsResult.muddies,
    closeFriendIds,
    circles: circles.map((circle) => ({
      id: circle.id,
      name: circle.name,
      icon: circle.icon,
      memberIds: membersByCircle.get(circle.id) ?? []
    })),
    blocked
  };
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
  const resultIds = otherProfiles.map((profile) => profile.user_id);

  // Plans and verification, batched together for the whole result set. Ten
  // results cost two reads here, not twenty -- and verification is fetched
  // alongside rather than as its own pass, so adding the mark did not add a
  // round trip.
  const [plans, verificationRows] = await Promise.all([
    loadEffectivePlansForUsers(admin, resultIds),
    resultIds.length > 0
      ? admin.from("account_verifications").select("user_id, status").in("user_id", resultIds)
      : Promise.resolve({ data: [] as { user_id: string; status: string }[] })
  ]);

  // Grouped per user: an account may hold several verification rows, and
  // hasVerifiedAccountStatus decides which states actually count.
  const verificationByUserId = new Map<string, VerificationRow[]>();
  for (const row of verificationRows.data ?? []) {
    const existing = verificationByUserId.get(row.user_id) ?? [];
    existing.push(row as VerificationRow);
    verificationByUserId.set(row.user_id, existing);
  }

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
    /* A COUNT IS NOT AN ANSWER when the count is zero.
     *
     * "0 users found." is technically true and practically useless: the person
     * typed a name, got a number back, and is left to work out whether they
     * mistyped it, whether the person is on Mad Buddy at all, or whether
     * something broke. A person not found is not a missing page -- and it is
     * not a statistic either.
     *
     * Deliberately says nothing about WHY there is no match. Distinguishing
     * "no such account" from "they blocked you" or "their profile is private"
     * would confirm an account exists to anyone who can type a username, so
     * every empty result reads the same way. */
    message:
      otherProfiles.length === 0
        ? "We couldn't find that person. Check the spelling, or try their full name."
        : `${otherProfiles.length} users found.`,
    users: otherProfiles.map((profile) => ({
      id: profile.user_id,
      displayName: profile.full_name,
      username: profile.username,
      avatarUrl: profile.avatar_url,
      mutualFriends: 0,
      status: "available",
      note: "Search result",
      plan: plans.get(profile.user_id) ?? "free",
      isVerifiedAccount: hasVerifiedAccountStatus(verificationByUserId.get(profile.user_id) ?? [])
    }))
  };
}

/**
 * Pending Muddy requests addressed to `userId`, newest first, with each
 * sender's public profile resolved server-side (the narrow profile RLS makes a
 * direct client read unreliable — same reason searchUsers uses the admin
 * client). Read-only; shared by the mobile `/api/friends/requests` route.
 */
/**
 * Count of PENDING INCOMING Muddy requests, for the Home header badge.
 *
 * Same predicate as listIncomingRequests (receiver_id = me, status =
 * pending) so the badge can never disagree with the Requests tab — but a
 * head-only count, because the badge needs a number, not up to 100 rows plus
 * their profiles and effective plans.
 *
 * Deliberately narrow: this counts requests SENT TO the user. It excludes
 * outgoing requests, suggestions, general notifications and unread messages,
 * each of which has its own surface and its own count.
 *
 * Returns 0 rather than throwing — a header badge must never be able to
 * break the page it sits on.
 */
export async function countIncomingRequests(userId: string): Promise<number> {
  if (browserEnvMessage() ?? serviceRoleEnvMessage()) return 0;

  const admin = createSupabaseAdminClient();
  const { count, error } = await admin
    .from("friend_requests")
    .select("id", { count: "exact", head: true })
    .eq("receiver_id", userId)
    .eq("status", "pending");

  return error ? 0 : count ?? 0;
}

export async function listIncomingRequests(
  userId: string
): Promise<ServiceResult & { requests: IncomingRequest[] }> {
  const envMessage = browserEnvMessage() ?? serviceRoleEnvMessage();
  if (envMessage) {
    return { ok: false, message: envMessage, requests: [] };
  }

  const admin = createSupabaseAdminClient();
  const { data: requests, error } = await admin
    .from("friend_requests")
    .select("id, sender_id, created_at")
    .eq("receiver_id", userId)
    .eq("status", "pending")
    .order("created_at", { ascending: false })
    .limit(100);

  if (error) {
    return { ok: false, message: "Couldn't load your requests.", requests: [] };
  }

  const senderIds = [...new Set((requests ?? []).map((row) => row.sender_id))];
  const profiles = senderIds.length
    ? (
        await admin
          .from("profiles")
          .select("user_id, full_name, username, avatar_url")
          .in("user_id", senderIds)
      ).data ?? []
    : [];
  const byId = new Map(profiles.map((profile) => [profile.user_id, profile]));
  const plans = await loadEffectivePlansForUsers(admin, senderIds);

  return {
    ok: true,
    message: "ok",
    requests: (requests ?? []).map((row) => {
      const profile = byId.get(row.sender_id);
      return {
        id: row.id,
        senderId: row.sender_id,
        displayName: profile?.full_name ?? "Someone",
        username: profile?.username ?? "",
        avatarUrl: profile?.avatar_url ?? null,
        createdAt: row.created_at,
        plan: plans.get(row.sender_id) ?? "free"
      };
    })
  };
}

/** Send a pending Muddy request from `userId` to `targetUserId`. */
export async function sendFriendRequest(
  userId: string,
  targetUserId: string,
  source: "friend" | "socialize" = "friend"
): Promise<ServiceResult> {
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
  let requestContext: "friend" | "socialize" = "friend";
  if (source === "socialize" && await isSocializeEnabled(admin)) {
    const { data: activeSocializeSessions } = await admin
      .from("socialize_sessions")
      .select("user_id")
      .in("user_id", [userId, parsedTarget.data])
      .eq("status", "active")
      .gt("expires_at", new Date().toISOString());
    if (new Set((activeSocializeSessions ?? []).map((session) => session.user_id)).size === 2) {
      requestContext = "socialize";
    }
  }
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
    // Active friendships only: ended_at IS NULL is the canonical definition
    // of "currently Muddies". An ended friendship must not block a fresh
    // request — that is how two people become Muddies again.
    admin.from("friendships").select("id").match(pair).is("ended_at", null).maybeSingle(),
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
    // Carries a code as well as the sentence: the caller needs to know a
    // request EXISTS, so it does not put this person back in the swipe deck
    // as though nothing had passed between them.
    return {
      ok: false,
      message: "This user already sent you a request. Open Requests to respond.",
      reason: "incoming_request_exists"
    };
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
  const { data: createdRequest, error } = await admin
    .from("friend_requests")
    .insert({
      sender_id: userId,
      receiver_id: parsedTarget.data,
      status: "pending",
      context_type: requestContext
    })
    .select("id")
    .single();

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

  return { ok: true, message: "Muddy request sent.", resourceId: createdRequest?.id, created: true };
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
    const [{ recordMilestone }, { grantFriendshipAchievements }] = await Promise.all([
      import("@/lib/onboarding/service"),
      import("@/lib/engagement/achievements")
    ]);
    await Promise.all([
      recordMilestone(admin, userId, "first_muddy_added"),
      recordMilestone(admin, request.sender_id, "first_muddy_added"),
      recordMilestone(admin, request.sender_id, "first_request_accepted"),
      grantFriendshipAchievements(admin, userId),
      grantFriendshipAchievements(admin, request.sender_id)
    ]);
  }

  // Life events, COMPENSATING. Emitted after the RPC has already committed the
  // friendship, so a failure here can never undo it.
  //
  // The RPC reports which of the two things it did, because only the database
  // can tell them apart without racing: it holds the row lock that decides
  // whether this acceptance found an ended relationship or none at all.
  //
  // Reactivation deliberately emits ONLY `relationship.reactivated`. Emitting
  // `relationship.created` again would be harmless at the dedupe key (the pair
  // is created once), but it would also be a lie about what happened — the
  // relationship was not created, it resumed.
  {
    const { emitLifeEvent } = await import("@/lib/life/emit");
    void emitLifeEvent(admin, {
      eventType: request.reactivated ? "relationship.reactivated" : "relationship.created",
      actorId: userId,
      subjectId: request.sender_id,
      // A pair is created once, but may reactivate many times, so the natural
      // key for reactivation carries the request that caused it. Without that
      // every reactivation after the first would dedupe into the first one.
      naturalKey: request.reactivated ? `reactivated:${parsedRequest.data}` : "created"
    });
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
