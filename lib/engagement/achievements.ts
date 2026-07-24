import "server-only";

import { ACHIEVEMENT_BY_CODE } from "@/lib/achievements/achievement-catalog";
import { createNotification } from "@/lib/notifications/server";
import type { createSupabaseAdminClient } from "@/lib/supabase/admin";

type Admin = ReturnType<typeof createSupabaseAdminClient>;

/**
 * Achievement granting (batch 11 spec §29-§32). Principles encoded here:
 *
 * - Private: grants write only the user's own row; there is no cross-user
 *   read path, so no leaderboard can exist (spec §26).
 * - Switchable: a user with achievements_enabled=false is never granted
 *   anything (spec §41), off means off, not hidden.
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

    // ignoreDuplicates + the (user_id, achievement_code) unique constraint make
    // a re-grant a no-op that returns NO row. .select() therefore returns a row
    // only for a genuinely new unlock — which is exactly when (and the only
    // time) we notify, so an award and its notification can never duplicate,
    // even under concurrent grants.
    const { data: inserted } = await admin
      .from("user_achievements")
      .upsert({ user_id: userId, achievement_code: code }, { onConflict: "user_id,achievement_code", ignoreDuplicates: true })
      .select("id");

    if (inserted && inserted.length > 0) {
      const definition = ACHIEVEMENT_BY_CODE.get(code);
      if (definition) {
        // A real in-app notification for the user's own milestone. It opens the
        // Achievements page via the "achievement:" destination convention. Sent
        // directly (not through the preference/budget engine) because it's a
        // one-off milestone the person opted into via achievements_enabled, and
        // it must not be silently dropped by a daily budget.
        await createNotification(admin, {
          userId,
          type: `achievement:${code}`,
          title: definition.notification.title,
          message: definition.notification.body
        });
      }
    }
  } catch {
    // Best-effort by design.
  }
}

/**
 * Count-based grant: awards `code` only once `count` meets the definition's
 * transparent criteria_value (spec §32, criteria are public reference data).
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

/**
 * Count-backed grants always recount canonical rows after a successful write.
 * They never trust a client counter, and failures stay best-effort so a badge
 * can never break the social action that earned it.
 */
export async function grantFriendshipAchievements(admin: Admin, userId: string): Promise<void> {
  try {
    const { count } = await admin
      .from("friendships")
      .select("id", { count: "exact", head: true })
      .or(`user_one_id.eq.${userId},user_two_id.eq.${userId}`);
    await Promise.all([
      grantAchievement(admin, userId, "first_muddy"),
      grantCountAchievement(admin, userId, "friendly_five", count ?? 0)
    ]);
  } catch {
    // Best-effort by design.
  }
}

export async function grantMomentAchievements(admin: Admin, userId: string): Promise<void> {
  try {
    const { count } = await admin
      .from("moments")
      .select("id", { count: "exact", head: true })
      .eq("author_id", userId);
    await Promise.all([
      grantAchievement(admin, userId, "first_moment"),
      grantCountAchievement(admin, userId, "moment_maker", count ?? 0)
    ]);
  } catch {
    // Best-effort by design.
  }
}

export async function grantSafeTravellerAchievements(admin: Admin, userId: string): Promise<void> {
  try {
    const { count } = await admin
      .from("safe_arrival_sessions")
      .select("id", { count: "exact", head: true })
      .eq("traveller_id", userId)
      .eq("status", "completed");
    await Promise.all([
      grantAchievement(admin, userId, "good_check_in"),
      grantCountAchievement(admin, userId, "safe_traveller", count ?? 0)
    ]);
  } catch {
    // Best-effort by design.
  }
}

export async function grantReliableWatcherAchievement(admin: Admin, userId: string): Promise<void> {
  try {
    const { count } = await admin
      .from("safe_arrival_contacts")
      .select("id", { count: "exact", head: true })
      .eq("contact_user_id", userId)
      .eq("acknowledgement_status", "watching");
    await grantCountAchievement(admin, userId, "reliable_watcher", count ?? 0);
  } catch {
    // Best-effort by design.
  }
}
