"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createRequestId, errorType, logBackendEvent } from "@/lib/observability/logger";
import { consumeRateLimit, rateLimitMessage } from "@/lib/security/rate-limit";
import { sniffImageKind, uploadValidationMessage, validateImageUpload } from "@/lib/media/validation";
import { optimizeProfileAvatar, toStorageArrayBuffer } from "@/lib/media/processing";
import { getSupabaseBrowserEnv, getSupabaseServerEnv } from "@/lib/supabase/env";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  acceptFriendRequest,
  searchUsers,
  sendFriendRequest,
  updateFriendRequestStatus,
  type SearchUserResult
} from "@/lib/friends/service";
import { updateProfile } from "@/lib/profile/service";

export type IntegrationActionState = {
  ok: boolean;
  message: string;
  avatarUrl?: string;
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
  const userId = await getAuthedUserId();

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
  const userId = await getAuthedUserId();

  if (!userId) {
    return { ok: false, message: "Log in before searching users.", users: [] };
  }

  return searchUsers(userId, query);
}

export async function sendFriendRequestAction(targetUserId: string): Promise<IntegrationActionState> {
  const userId = await getAuthedUserId();

  if (!userId) {
    return { ok: false, message: "Log in before sending Muddy requests." };
  }

  const result = await sendFriendRequest(userId, targetUserId);

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
