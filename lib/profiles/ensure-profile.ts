import "server-only";

import type { User } from "@supabase/supabase-js";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export async function ensureProfileForUser(user: User) {
  const admin = createSupabaseAdminClient();
  const { data: existingProfile } = await admin
    .from("profiles")
    .select("user_id, visibility_status, full_name")
    .eq("user_id", user.id)
    .maybeSingle();

  if (existingProfile) {
    return existingProfile;
  }

  const metadata = user.user_metadata;
  const emailPrefix = user.email?.split("@")[0] ?? "muddy";
  const usernameBase =
    typeof metadata?.username === "string" && metadata.username.length >= 3
      ? metadata.username
      : emailPrefix;
  const username = `${usernameBase.toLowerCase().replace(/[^a-z0-9_]/g, "_").slice(0, 16)}_${user.id.slice(0, 6)}`;
  const fullName =
    typeof metadata?.full_name === "string" && metadata.full_name.trim()
      ? metadata.full_name.trim()
      : "Mad Buddy user";

  const { data: profile, error } = await admin
    .from("profiles")
    .upsert({
      user_id: user.id,
      full_name: fullName,
      username,
      visibility_status: "visible",
      is_onboarded: false
    })
    .select("user_id, visibility_status, full_name")
    .single();

  if (error) {
    throw error;
  }

  return profile;
}
