import "server-only";

import type { User } from "@supabase/supabase-js";
import { ensureProfileForUser } from "@/lib/profiles/ensure-profile";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export async function ensureOAuthAccountForUser(user: User) {
  const profile = await ensureProfileForUser(user);
  const admin = createSupabaseAdminClient();
  const [subscription, preferences] = await Promise.all([
    admin.from("subscriptions").upsert({ user_id: user.id }, { onConflict: "user_id" }),
    admin.from("user_preferences").upsert({ user_id: user.id }, { onConflict: "user_id" })
  ]);

  if (subscription.error) {
    throw subscription.error;
  }

  if (preferences.error) {
    throw preferences.error;
  }

  return profile;
}
