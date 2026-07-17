import "server-only";

import type { createSupabaseAdminClient } from "@/lib/supabase/admin";

type Admin = ReturnType<typeof createSupabaseAdminClient>;

/**
 * Achievement granting (batch 11 spec §29-§32). Principles encoded here:
 *
 * - Private: grants write only the user's own row; there is no cross-user
 *   read path, so no leaderboard can exist (spec §26).
 * - Switchable: a user with achievements_enabled=false is never granted
 *   anything (spec §41) — off means off, not hidden.
 * - Once: the (user_id, achievement_code) unique constraint plus
 *   ignoreDuplicates makes a re-grant a no-op (spec §32).
 *
 * Callers fire-and-forget from the action that constitutes the criteria;
 * a failed grant must never fail the underlying action.
 */
export async function grantAchievement(admin: Admin, userId: string, code: string): Promise<void> {
  try {
    const { data: prefs } = await admin
      .from("engagement_preferences")
      .select("achievements_enabled")
      .eq("user_id", userId)
      .maybeSingle();
    if (prefs && !prefs.achievements_enabled) return;

    await admin
      .from("user_achievements")
      .upsert({ user_id: userId, achievement_code: code }, { onConflict: "user_id,achievement_code", ignoreDuplicates: true });
  } catch {
    // Best-effort by design.
  }
}

/**
 * Count-based grant: awards `code` only once `count` meets the definition's
 * transparent criteria_value (spec §32 — criteria are public reference data).
 */
export async function grantCountAchievement(
  admin: Admin,
  userId: string,
  code: string,
  count: number
): Promise<void> {
  try {
    const { data: definition } = await admin
      .from("achievement_definitions")
      .select("criteria_value, is_active")
      .eq("code", code)
      .maybeSingle();
    if (!definition?.is_active || count < definition.criteria_value) return;
    await grantAchievement(admin, userId, code);
  } catch {
    // Best-effort by design.
  }
}
