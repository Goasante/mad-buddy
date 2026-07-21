"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { deliverNotification } from "@/lib/notifications/server";
import { createRequestId, errorType, logBackendEvent } from "@/lib/observability/logger";
import { consumeRateLimit, rateLimitMessage } from "@/lib/security/rate-limit";
import { sniffImageKind, uploadValidationMessage, validateImageUpload } from "@/lib/media/validation";
import { optimizeProfileAvatar, toStorageArrayBuffer } from "@/lib/media/processing";
import { getSupabaseBrowserEnv, getSupabaseServerEnv } from "@/lib/supabase/env";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export type IntegrationActionState = {
  ok: boolean;
  message: string;
  avatarUrl?: string;
};

export type SearchUserResult = {
  id: string;
  displayName: string;
  username: string;
  avatarUrl: string | null;
  mutualFriends: number;
  status: "available";
  note: string;
};

const profileSchema = z.object({
  fullName: z.string().trim().min(2, "Display name is too short.").max(80),
  username: z
    .string()
    .trim()
    .toLowerCase()
    .min(3)
    .max(24)
    .regex(/^[a-z0-9_]+$/),
  bio: z.string().trim().max(160).optional(),
  moodStatus: z.string().trim().max(80).optional()
});

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
  const missingEnv = missingSupabaseState();

  if (missingEnv) {
    return missingEnv;
  }

  const parsed = profileSchema.safeParse(input);

  if (!parsed.success) {
    return { ok: false, message: "Check your profile fields and try again." };
  }

  const userId = await getAuthedUserId();

  if (!userId) {
    return { ok: false, message: "Log in before updating your profile." };
  }

  const supabase = await createSupabaseServerClient();
  const { data: savedProfile, error } = await supabase
    .from("profiles")
    .upsert({
      user_id: userId,
      full_name: parsed.data.fullName,
      username: parsed.data.username,
      username_normalized: parsed.data.username,
      bio: parsed.data.bio ?? null,
      mood_status: parsed.data.moodStatus ?? null
    }, { onConflict: "user_id" })
    .select("user_id")
    .maybeSingle();

  if (error) {
    if (error.code === "23505") {
      return { ok: false, message: "That username is already in use." };
    }
    return { ok: false, message: "Couldn't update your profile. Try again." };
  }

  if (!savedProfile) {
    return { ok: false, message: "Couldn't update your profile. Try again." };
  }

  revalidatePath("/profile");
  revalidatePath("/dashboard");
  revalidatePath("/friends");
  return { ok: true, message: "Profile updated." };
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

  const userId = user.id;
  const file = formData.get("avatar");

  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, message: "Choose an avatar image first." };
  }

  // Shared upload validator (feature spec batch 6 §39): type support, size,
  // and, critically, that the real magic bytes match the claimed MIME type.
  const headerBytes = new Uint8Array(await file.slice(0, 32).arrayBuffer());
  const validation = validateImageUpload({
    claimedMimeType: file.type,
    headerBytes,
    sizeBytes: file.size,
    context: "profile"
  });

  if (!validation.valid) {
    return {
      ok: false,
      message: validation.reason === "too_large"
        ? "Use a profile photo smaller than 5 MB."
        : uploadValidationMessage(validation.reason)
    };
  }

  const admin = createSupabaseAdminClient();
  const uploadedAt = Date.now();
  const path = `${userId}/avatar-${uploadedAt}.webp`;

  // Avatars are on a public bucket, so EXIF stripping matters even more here:
  // re-encode (drops GPS and all metadata) and cap the dimensions.
  let avatarBuffer: Buffer;
  try {
    avatarBuffer = await optimizeProfileAvatar(Buffer.from(await file.arrayBuffer()));
  } catch {
    return {
      ok: false,
      message: validation.kind === "heic"
        ? "This HEIC photo could not be converted. Export it as JPG or PNG and try again."
        : "That image couldn't be processed. Try a different photo."
    };
  }

  const { error } = await admin.storage.from("avatars").upload(path, toStorageArrayBuffer(avatarBuffer), {
    contentType: "image/webp",
    cacheControl: "31536000",
    upsert: false
  });

  if (error) {
    return { ok: false, message: "Profile photo upload failed. Please try again." };
  }

  const { data: storedAvatar, error: verifyError } = await admin.storage.from("avatars").download(path);
  const storedKind = storedAvatar
    ? sniffImageKind(new Uint8Array(await storedAvatar.slice(0, 12).arrayBuffer()))
    : null;
  if (verifyError || storedKind !== "webp") {
    await admin.storage.from("avatars").remove([path]);
    return { ok: false, message: "Your profile photo was not stored correctly. Please try again." };
  }

  const { data } = admin.storage.from("avatars").getPublicUrl(path);
  const avatarUrl = data.publicUrl;
  const { data: savedProfile, error: profileError } = await admin
    .from("profiles")
    .update({ avatar_url: avatarUrl })
    .eq("user_id", userId)
    .select("avatar_url")
    .maybeSingle();

  if (profileError) {
    await admin.storage.from("avatars").remove([path]);
    return { ok: false, message: "Your profile photo could not be saved. Please try again." };
  }

  if (!savedProfile) {
    const fallbackName =
      typeof user.user_metadata?.full_name === "string"
        ? user.user_metadata.full_name
        : user.email?.split("@")[0] ?? "Mad Buddy User";
    const fallbackUsernameBase = (user.email?.split("@")[0] ?? `user_${userId.slice(0, 8)}`)
      .toLowerCase()
      .replace(/[^a-z0-9_]/g, "_")
      .replace(/_+/g, "_")
      .slice(0, 16);
    const fallbackUsername = `${fallbackUsernameBase}_${userId.slice(0, 6)}`.slice(0, 24);
    const { error: insertError } = await admin.from("profiles").insert({
      user_id: userId,
      full_name: fallbackName,
      username: fallbackUsername,
      avatar_url: avatarUrl
    });

    if (insertError) {
      await admin.storage.from("avatars").remove([path]);
      return { ok: false, message: "Your profile photo could not be saved. Please try again." };
    }
  }

  try {
    await admin.auth.admin.updateUserById(userId, {
      user_metadata: {
        ...user.user_metadata,
        avatar_url: avatarUrl
      }
    });
  } catch {
    // Profile.avatar_url is the source of truth; auth metadata is a convenience mirror.
  }

  try {
    const { data: files } = await admin.storage.from("avatars").list(userId);
    const stalePaths = (files ?? [])
      .map((item) => `${userId}/${item.name}`)
      .filter((item) => item !== path);

    if (stalePaths.length > 0) {
      await admin.storage.from("avatars").remove(stalePaths);
    }
  } catch {
    // Old avatar cleanup is best-effort; the saved profile URL above is authoritative.
  }

  revalidatePath("/profile");
  revalidatePath("/dashboard");
  revalidatePath("/friends");

  return { ok: true, message: "Profile photo updated.", avatarUrl: `${avatarUrl}?v=${Date.now()}` };
}

export async function searchUsersAction(query: string): Promise<{
  ok: boolean;
  message: string;
  users: SearchUserResult[];
}> {
  const requestId = createRequestId();
  const startedAt = Date.now();
  const missingEnv = missingSupabaseState() ?? missingServiceRoleState();

  if (missingEnv) {
    return { ...missingEnv, users: [] };
  }

  const userId = await getAuthedUserId();

  if (!userId) {
    return { ok: false, message: "Log in before searching users.", users: [] };
  }

  const rateLimit = await consumeRateLimit({
    action: "friends.search",
    userId,
    requestId
  });

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

export async function sendFriendRequestAction(targetUserId: string): Promise<IntegrationActionState> {
  const requestId = createRequestId();
  const startedAt = Date.now();
  const missingEnv = missingSupabaseState() ?? missingServiceRoleState();

  if (missingEnv) {
    return missingEnv;
  }

  const parsedTarget = uuidSchema.safeParse(targetUserId);

  if (!parsedTarget.success) {
    return { ok: false, message: "Select a real searched user before sending a request." };
  }

  const userId = await getAuthedUserId();

  if (!userId) {
    return { ok: false, message: "Log in before sending Muddy requests." };
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
      revalidatePath("/friends");
      return { ok: true, message: "Your request is already pending." };
    }

    return { ok: false, message: "This user already sent you a request. Open Requests to respond." };
  }

  const rateLimit = await consumeRateLimit({
    action: "friends.request",
    userId,
    requestId
  });

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

  revalidatePath("/friends");
  return { ok: true, message: "Muddy request sent." };
}

export async function acceptFriendRequestAction(requestId: string): Promise<IntegrationActionState> {
  const missingEnv = missingSupabaseState() ?? missingServiceRoleState();

  if (missingEnv) {
    return missingEnv;
  }

  const parsedRequest = uuidSchema.safeParse(requestId);

  if (!parsedRequest.success) {
    return { ok: false, message: "Select a real request before accepting." };
  }

  const userId = await getAuthedUserId();

  if (!userId) {
    return { ok: false, message: "Log in before accepting Muddy requests." };
  }

  const supabase = await createSupabaseServerClient();
  const { data: settledRows, error: settleError } = await supabase.rpc("accept_friend_request", {
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

  revalidatePath("/friends");
  return { ok: true, message: "Muddy request accepted." };
}

export async function updateFriendRequestStatusAction(
  requestId: string,
  status: "declined" | "cancelled"
): Promise<IntegrationActionState> {
  const missingEnv = missingSupabaseState();

  if (missingEnv) {
    return missingEnv;
  }

  const parsedRequest = uuidSchema.safeParse(requestId);

  if (!parsedRequest.success) {
    return { ok: false, message: "Select a real request first." };
  }

  const userId = await getAuthedUserId();
  if (!userId) {
    return { ok: false, message: "Log in before updating Muddy requests." };
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

  revalidatePath("/friends");
  return { ok: true, message: `Request ${status}.` };
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
  const { data: removed, error } = await admin
    .from("friendships")
    .delete()
    .eq("user_one_id", pair.user_one_id)
    .eq("user_two_id", pair.user_two_id)
    .select("id")
    .maybeSingle();

  if (error) {
    return { ok: false, message: "That Muddy could not be removed." };
  }

  if (!removed) {
    return { ok: false, message: "This person is no longer in your Muddies." };
  }

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
  await Promise.all([
    admin.from("friendships").delete().match(pair),
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
