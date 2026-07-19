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
