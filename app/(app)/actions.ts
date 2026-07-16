"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createNotification } from "@/lib/notifications/server";
import { createRequestId, errorType, logBackendEvent } from "@/lib/observability/logger";
import { consumeRateLimit, rateLimitMessage } from "@/lib/security/rate-limit";
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
  mutualFriends: number;
  status: "available";
  note: string;
};

const profileSchema = z.object({
  fullName: z.string().min(2, "Display name is too short."),
  username: z
    .string()
    .min(3)
    .max(24)
    .regex(/^[a-z0-9_]+$/),
  bio: z.string().max(160).optional(),
  moodStatus: z.string().max(80).optional()
});

const uuidSchema = z.string().uuid();
const avatarExtensionsByType = new Map([
  ["image/jpeg", "jpg"],
  ["image/png", "png"],
  ["image/webp", "webp"]
]);

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
  const { error } = await supabase
    .from("profiles")
    .update({
      full_name: parsed.data.fullName,
      username: parsed.data.username,
      bio: parsed.data.bio ?? null,
      mood_status: parsed.data.moodStatus ?? null
    })
    .eq("user_id", userId);

  if (error) {
    return { ok: false, message: error.message };
  }

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

  const extension = avatarExtensionsByType.get(file.type);

  if (!extension) {
    return { ok: false, message: "Upload a PNG, JPG, or WebP image." };
  }

  if (file.size > 3 * 1024 * 1024) {
    return { ok: false, message: "Use an image smaller than 3 MB." };
  }

  const admin = createSupabaseAdminClient();
  const uploadedAt = Date.now();
  const path = `${userId}/avatar-${uploadedAt}.${extension}`;
  const { error } = await admin.storage.from("avatars").upload(path, file, {
    cacheControl: "31536000",
    upsert: false
  });

  if (error) {
    return { ok: false, message: error.message };
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
    return { ok: false, message: profileError.message };
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
      return { ok: false, message: insertError.message };
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

  return { ok: true, message: "Avatar uploaded.", avatarUrl: `${avatarUrl}?v=${Date.now()}` };
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
    .select("user_id, full_name, username")
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
    return { ok: false, message: error.message, users: [] };
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

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.from("friend_requests").insert({
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
    return { ok: false, message: error.message };
  }

  const { data: senderProfile } = await supabase
    .from("profiles")
    .select("full_name")
    .eq("user_id", userId)
    .maybeSingle();

  await createNotification(supabase, {
    userId: parsedTarget.data,
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

  const admin = createSupabaseAdminClient();
  const { data: request, error: requestError } = await admin
    .from("friend_requests")
    .select("sender_id, receiver_id")
    .eq("id", parsedRequest.data)
    .eq("receiver_id", userId)
    .eq("status", "pending")
    .single();

  if (requestError || !request) {
    return { ok: false, message: requestError?.message ?? "Request not found." };
  }

  const pair = orderedPair(request.sender_id, request.receiver_id);
  const { error } = await admin.from("friendships").upsert(pair);

  if (error) {
    return { ok: false, message: error.message };
  }

  await admin.from("friend_requests").update({ status: "accepted" }).eq("id", parsedRequest.data);

  const { data: receiverProfile } = await admin
    .from("profiles")
    .select("full_name")
    .eq("user_id", userId)
    .maybeSingle();

  await createNotification(admin, {
    userId: request.sender_id,
    type: "friend_request_accepted",
    title: "Muddy request accepted",
    message: `${receiverProfile?.full_name ?? "A Muddy"} approved your request.`
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

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.from("friend_requests").update({ status }).eq("id", parsedRequest.data);

  if (error) {
    return { ok: false, message: error.message };
  }

  revalidatePath("/friends");
  return { ok: true, message: `Request ${status}.` };
}

export async function removeFriendAction(friendId: string): Promise<IntegrationActionState> {
  const missingEnv = missingSupabaseState();

  if (missingEnv) {
    return missingEnv;
  }

  const parsedFriend = uuidSchema.safeParse(friendId);
  const userId = await getAuthedUserId();

  if (!parsedFriend.success || !userId) {
    return { ok: false, message: "Select a real Muddy while logged in." };
  }

  const pair = orderedPair(userId, parsedFriend.data);
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from("friendships")
    .delete()
    .eq("user_one_id", pair.user_one_id)
    .eq("user_two_id", pair.user_two_id);

  if (error) {
    return { ok: false, message: error.message };
  }

  return { ok: true, message: "Muddy removed." };
}

export async function blockUserAction(targetUserId: string): Promise<IntegrationActionState> {
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
  const { error } = await supabase.from("blocked_users").upsert({
    blocker_id: userId,
    blocked_id: parsedTarget.data
  });

  if (error) {
    return { ok: false, message: error.message };
  }

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
    return { ok: false, message: error.message };
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
    return { ok: false, message: error.message };
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
