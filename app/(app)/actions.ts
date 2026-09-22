"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { emitLifeEvent } from "@/lib/life/emit";
import { createRequestId, errorType, logBackendEvent } from "@/lib/observability/logger";
import { uploadProfileAvatar } from "@/lib/profile/avatar-service";
import { consumeRateLimit, rateLimitMessage } from "@/lib/security/rate-limit";
import { getSupabaseBrowserEnv, getSupabaseServerEnv } from "@/lib/supabase/env";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  acceptFriendRequest,
  searchUsers,
  sendFriendRequest,
  updateFriendRequestStatus,
  type SearchUserResult,
  type ServiceFailureReason
} from "@/lib/friends/service";
import { updateProfile } from "@/lib/profile/service";
import { sendLinkrInterest } from "@/lib/social/linkr-interest";

export type IntegrationActionState = {
  ok: boolean;
  message: string;
  avatarUrl?: string;
  dateOfBirthCanCorrect?: boolean;
  /**
   * A stable code for callers that must branch on WHY something failed.
   *
   * Mirrors ServiceResult.reason so it survives the trip through the action.
   * Callers read this; users read `message`. Matching on the sentence instead
   * meant a copy edit could silently change behaviour.
   */
  reason?: ServiceFailureReason;
};

const uuidSchema = z.string().uuid();

function missingSupabaseState(): IntegrationActionState | null {
  const env = getSupabaseBrowserEnv();

  if (!env.url || !env.anonKey) {
    return {
      ok: false,
      message: "Supabase is not configured yet. Add .env.local values and restart the dev server."
    };
  }

  return null;
}

function missingServiceRoleState(): IntegrationActionState | null {
  const env = getSupabaseServerEnv();

  if (!env.url || !env.serviceRoleKey) {
    return {
      ok: false,
      message: "This action needs SUPABASE_SERVICE_ROLE_KEY for secure server-side writes."
    };
  }

  return null;
}

async function getAuthedUserId() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
    error
  } = await supabase.auth.getUser();

  if (error || !user) {
    return null;
  }

  return user.id;
}

function orderedPair(userId: string, friendId: string) {
  return userId < friendId
    ? { user_one_id: userId, user_two_id: friendId }
    : { user_one_id: friendId, user_two_id: userId };
}

export async function updateProfileAction(input: unknown): Promise<IntegrationActionState> {
  const requestId = createRequestId();
  let userId: string | null = null;

  try {
    userId = await getAuthedUserId();

    if (!userId) {
      return { ok: false, message: "Log in before updating your profile." };
    }

    const supabase = await createSupabaseServerClient();
    const result = await updateProfile(supabase, userId, input);

    if (result.ok) {
      revalidatePath("/profile");
      revalidatePath("/dashboard");
      revalidatePath("/friends");
    }

    return result;
  } catch (error) {
    logBackendEvent("error", {
      requestId,
      route: "/profile",
      action: "update_profile",
      statusCode: 500,
      userId,
      errorType: errorType(error)
    });
    return { ok: false, message: "Your profile could not be saved. Please try again." };
  }
}

export async function uploadAvatarAction(formData: FormData): Promise<IntegrationActionState> {
  const missingEnv = missingSupabaseState();

  if (missingEnv) {
    return missingEnv;
  }

  const missingServiceRole = missingServiceRoleState();

  if (missingServiceRole) {
    return missingServiceRole;
  }

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
    error: userError
  } = await supabase.auth.getUser();

  if (userError || !user) {
    return { ok: false, message: "Log in before uploading an avatar." };
  }

  /* The body of this action now lives in lib/profile/avatar-service.ts so
     that /api/profile/avatar/upload -- how the native app reaches this
     feature -- runs the SAME code rather than a copy that looks alike.
     Everything platform-specific stays here: the env checks, resolving the
     session, and revalidating the routes that show an avatar. */
  const result = await uploadProfileAvatar(createSupabaseAdminClient(), user, formData);

  if (result.ok) {
    revalidatePath("/profile");
    revalidatePath("/dashboard");
    revalidatePath("/friends");
  }

  return result;
}

export async function searchUsersAction(query: string): Promise<{
  ok: boolean;
  message: string;
  users: SearchUserResult[];
}> {
  const userId = await getAuthedUserId();

  if (!userId) {
    return { ok: false, message: "Log in before searching users.", users: [] };
  }

  return searchUsers(userId, query);
}

export async function sendFriendRequestAction(
  targetUserId: string,
  source: "friend" | "socialize" = "friend"
): Promise<IntegrationActionState> {
  const userId = await getAuthedUserId();

  if (!userId) {
    return { ok: false, message: "Log in before sending Muddy requests." };
  }

  const result =
    source === "socialize"
      ? await sendLinkrInterest(await createSupabaseServerClient(), userId, targetUserId)
      : await sendFriendRequest(userId, targetUserId, source);

  if (result.ok) {
    revalidatePath("/friends");
  }

  return result;
}

export async function acceptFriendRequestAction(requestId: string): Promise<IntegrationActionState> {
  const userId = await getAuthedUserId();

  if (!userId) {
    return { ok: false, message: "Log in before accepting Muddy requests." };
  }

  const supabase = await createSupabaseServerClient();
  const result = await acceptFriendRequest(supabase, userId, requestId);

  if (result.ok) {
    // Life event, COMPENSATING: recorded after the friendship exists, and
    // never awaited into the result. A failed event must not make a real
    // friendship look like a failure — rebuildRelationship replays it from
    // the friendships table later.
    //
    // The other party is read here rather than returned by the service:
    // ServiceResult is shared by many callers and widening it for one
    // consumer would be the wrong trade.
    void (async () => {
      const admin = createSupabaseAdminClient();
      const { data: request } = await admin
        .from("friend_requests")
        .select("sender_id, receiver_id")
        .eq("id", requestId)
        .maybeSingle();
      const otherUserId = request?.sender_id === userId ? request?.receiver_id : request?.sender_id;
      if (!otherUserId) return;
      await emitLifeEvent(admin, {
        eventType: "relationship.created",
        actorId: userId,
        subjectId: otherUserId,
        naturalKey: "created"
      });
    })();
    revalidatePath("/friends");
  }

  return result;
}

export async function updateFriendRequestStatusAction(
  requestId: string,
  status: "declined" | "cancelled"
): Promise<IntegrationActionState> {
  const userId = await getAuthedUserId();

  if (!userId) {
    return { ok: false, message: "Log in before updating Muddy requests." };
  }

  const result = await updateFriendRequestStatus(userId, requestId, status);

  if (result.ok) {
    revalidatePath("/friends");
  }

  return result;
}

export async function removeFriendAction(friendId: string): Promise<IntegrationActionState> {
  const missingEnv = missingSupabaseState() ?? missingServiceRoleState();

  if (missingEnv) {
    return missingEnv;
  }

  const parsedFriend = uuidSchema.safeParse(friendId);
  const userId = await getAuthedUserId();

  if (!parsedFriend.success || !userId) {
    return { ok: false, message: "Select a real Muddy while logged in." };
  }

  const pair = orderedPair(userId, parsedFriend.data);
  const admin = createSupabaseAdminClient();
  const endedAt = new Date().toISOString();

  // SOFT ENDING. The row is retained with ended_at set, never deleted.
  //
  // A relationship is a persistent identity, not a disposable row: the pair's
  // canonical id, its created_at, and everything keyed to it must survive an
  // unfriending so the timeline stays continuous and a later reactivation
  // resumes the SAME relationship rather than inventing a new one.
  //
  // `.is("ended_at", null)` makes this idempotent under concurrency: two
  // simultaneous removals both match at most once, so the second updates no
  // rows and reports "no longer in your Muddies" instead of re-stamping
  // ended_at and moving the ending later than it really was.
  const { data: removed, error } = await admin
    .from("friendships")
    .update({ ended_at: endedAt })
    .eq("user_one_id", pair.user_one_id)
    .eq("user_two_id", pair.user_two_id)
    .is("ended_at", null)
    .select("id")
    .maybeSingle();

  if (error) {
    return { ok: false, message: "That Muddy could not be removed." };
  }

  if (!removed) {
    return { ok: false, message: "This person is no longer in your Muddies." };
  }

  // Life event, COMPENSATING. Emitted after the ending has already been
  // persisted, so a failure here can never un-end the friendship; the event is
  // recoverable by replay because the ended row is still there to replay from.
  void emitLifeEvent(admin, {
    eventType: "relationship.ended",
    actorId: userId,
    subjectId: parsedFriend.data,
    naturalKey: "ended",
    occurredAt: endedAt
  });

  await admin
    .from("close_friend_relationships")
    .delete()
    .or(
      `and(owner_id.eq.${userId},friend_id.eq.${parsedFriend.data}),and(owner_id.eq.${parsedFriend.data},friend_id.eq.${userId})`
    );

  revalidatePath("/friends");
  revalidatePath("/dashboard");
  return { ok: true, message: "Muddy removed." };
}

export async function blockUserAction(targetUserId: string): Promise<IntegrationActionState> {
  const missingEnv = missingSupabaseState() ?? missingServiceRoleState();

  if (missingEnv) {
    return missingEnv;
  }

  const parsedTarget = uuidSchema.safeParse(targetUserId);
  const userId = await getAuthedUserId();

  if (!parsedTarget.success || !userId) {
    return { ok: false, message: "Select a real user while logged in." };
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.from("blocked_users").upsert({
    blocker_id: userId,
    blocked_id: parsedTarget.data
  });

  if (error) {
    return { ok: false, message: "That user could not be blocked." };
  }

  const admin = createSupabaseAdminClient();
  const pair = orderedPair(userId, parsedTarget.data);
  const blockedAt = new Date().toISOString();
  await Promise.all([
    // Blocking ENDS the friendship; it does not erase it. Access is revoked
    // the moment ended_at is set (every active-friend read filters on it), and
    // the block itself independently overrides everything on top of that.
    //
    // Retaining the row matters for the blocked pair specifically: if blocking
    // deleted it, unblocking would have nothing to reactivate and the pair's
    // shared history would be gone — a punishment neither of them chose.
    admin.from("friendships").update({ ended_at: blockedAt }).match(pair).is("ended_at", null),
    admin
      .from("friend_requests")
      .update({ status: "blocked", responded_at: new Date().toISOString() })
      .eq("status", "pending")
      .or(
        `and(sender_id.eq.${userId},receiver_id.eq.${parsedTarget.data}),and(sender_id.eq.${parsedTarget.data},receiver_id.eq.${userId})`
      ),
    admin
      .from("close_friend_relationships")
      .delete()
      .or(
        `and(owner_id.eq.${userId},friend_id.eq.${parsedTarget.data}),and(owner_id.eq.${parsedTarget.data},friend_id.eq.${userId})`
      )
  ]);

  // Life event, COMPENSATING. Blocking is an ending, so the timeline records
  // one — otherwise a blocked relationship would read as still running.
  //
  // The event says only that the relationship ended, never that a block caused
  // it: the timeline is shared with the other party, and "they blocked you" is
  // not a fact either side is entitled to read out of a projection.
  //
  // Same dedupe key as removeFriendAction, so blocking someone already removed
  // records nothing new rather than a second, later ending.
  void emitLifeEvent(admin, {
    eventType: "relationship.ended",
    actorId: userId,
    subjectId: parsedTarget.data,
    naturalKey: "ended",
    occurredAt: blockedAt
  });

  // Blocking archives the pair's direct conversation immediately (batch 7):
  // sends were already refused via per-send block checks; this removes the
  // thread from both inboxes too.
  const { applyBlockToConversations } = await import("@/lib/messaging/service");
  await applyBlockToConversations(admin, userId, parsedTarget.data);

  revalidatePath("/friends");
  revalidatePath("/dashboard");
  return { ok: true, message: "User blocked." };
}

export async function unblockUserAction(targetUserId: string): Promise<IntegrationActionState> {
  const missingEnv = missingSupabaseState();

  if (missingEnv) {
    return missingEnv;
  }

  const parsedTarget = uuidSchema.safeParse(targetUserId);
  const userId = await getAuthedUserId();

  if (!parsedTarget.success || !userId) {
    return { ok: false, message: "Select a real user while logged in." };
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from("blocked_users")
    .delete()
    .eq("blocker_id", userId)
    .eq("blocked_id", parsedTarget.data);

  if (error) {
    return { ok: false, message: "That user could not be unblocked." };
  }

  return { ok: true, message: "User unblocked." };
}

export async function reportUserAction(input: {
  targetUserId: string;
  reason: string;
  description?: string;
}): Promise<IntegrationActionState> {
  const requestId = createRequestId();
  const startedAt = Date.now();
  const missingEnv = missingSupabaseState();

  if (missingEnv) {
    return missingEnv;
  }

  const parsedTarget = uuidSchema.safeParse(input.targetUserId);
  const userId = await getAuthedUserId();

  if (!parsedTarget.success || !userId) {
    return { ok: false, message: "Select a real user while logged in." };
  }

  const rateLimit = await consumeRateLimit({
    action: "reports.create",
    userId,
    requestId
  });

  if (!rateLimit.allowed) {
    return { ok: false, message: rateLimitMessage(rateLimit.resetAt) };
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.from("reports").insert({
    reporter_id: userId,
    reported_user_id: parsedTarget.data,
    reason: input.reason,
    description: input.description ?? null
  });

  if (error) {
    logBackendEvent("warn", {
      requestId,
      action: "reports.create",
      statusCode: 500,
      latencyMs: Date.now() - startedAt,
      userId,
      errorType: errorType(error)
    });
    return { ok: false, message: "The report could not be submitted." };
  }

  logBackendEvent("info", {
    requestId,
    action: "reports.create",
    statusCode: 200,
    latencyMs: Date.now() - startedAt,
    userId
  });

  return { ok: true, message: "Report submitted." };
}
