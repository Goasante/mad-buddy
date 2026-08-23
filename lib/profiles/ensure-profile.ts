import "server-only";

import type { User } from "@supabase/supabase-js";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export async function ensureProfileForUser(user: User) {
  const admin = createSupabaseAdminClient();
  const { data: existingProfile } = await admin
    .from("profiles")
    .select("user_id, visibility_status, full_name, is_onboarded")
    .eq("user_id", user.id)
    .maybeSingle();

  if (existingProfile) {
    return existingProfile;
  }

  const metadata = user.user_metadata;
  const emailPrefix = user.email?.split("@")[0] ?? "muddy";
  const providerUsername =
    typeof metadata?.preferred_username === "string"
      ? metadata.preferred_username
      : typeof metadata?.user_name === "string"
        ? metadata.user_name
        : typeof metadata?.username === "string"
          ? metadata.username
          : emailPrefix;
  const usernameBase = providerUsername.toLowerCase().replace(/[^a-z0-9_]/g, "_").slice(0, 16) || "muddy";
  const username = `${usernameBase}_${user.id.slice(0, 6)}`;
  const fullName =
    typeof metadata?.full_name === "string" && metadata.full_name.trim()
      ? metadata.full_name.trim()
      : typeof metadata?.name === "string" && metadata.name.trim()
        ? metadata.name.trim()
        : emailPrefix;
  const avatarUrl =
    typeof metadata?.avatar_url === "string"
      ? metadata.avatar_url
      : typeof metadata?.picture === "string"
        ? metadata.picture
        : null;

  const { data: profile, error } = await admin
    .from("profiles")
    .upsert({
      user_id: user.id,
      full_name: fullName,
      username,
      username_normalized: username,
      avatar_url: avatarUrl,
      visibility_status: "ghost",
      is_onboarded: false
    })
    .select("user_id, visibility_status, full_name, is_onboarded")
    .single();

  if (error) {
    throw error;
  }

  return profile;
}

/**
 * The same bootstrap, addressed by user id (MB-GOD-054).
 *
 * WHY THIS EXISTS RATHER THAN A SECOND IMPLEMENTATION. `sendFriendRequest`
 * needs a profile to exist before it can create a relationship, and it holds
 * only a `userId` -- so it grew its own copy of this logic, with different
 * rules: no `username_normalized` (which onboarding's uniqueness check reads),
 * no `avatar_url`, and no `visibility_status: "ghost"`. Two implementations of
 * one job, disagreeing about a person's default visibility.
 *
 * The auth user is fetched ONLY on the miss path. A caller with an existing
 * profile -- the overwhelmingly common case -- pays exactly what it paid
 * before: one existence check. Nothing was added to the hot path.
 *
 * Returns null when the auth user cannot be resolved. A caller that needs a
 * profile to proceed should treat that as a failure rather than inventing one,
 * which is what the duplicated version effectively did by falling back to
 * "Mad Buddy user".
 */
export async function ensureProfileForUserId(userId: string) {
  const admin = createSupabaseAdminClient();
  const { data: existing } = await admin
    .from("profiles")
    .select("user_id, visibility_status, full_name, is_onboarded")
    .eq("user_id", userId)
    .maybeSingle();
  if (existing) return existing;

  const { data: authUser } = await admin.auth.admin.getUserById(userId);
  if (!authUser?.user) return null;
  return ensureProfileForUser(authUser.user);
}
