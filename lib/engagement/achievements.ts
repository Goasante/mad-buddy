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
/**
 * Achievement DEFINITIONS are non-personal reference data -- the same public
 * criteria for every user (spec §32) -- so one lookup can answer for a whole
 * batch. The nightly jobs grant count-based achievements per user, which
 * re-read the identical definition row once per user; a 10,000-user tick
 * fetched the same two rows 20,000 times.
 *
 * Deliberately NOT a shared server cache. It is a short-lived, process-local
 * memo of PUBLIC criteria, holding no user data and keyed by nothing
 * viewer-specific, so it cannot leak between people. The TTL keeps an Admin
 * edit to a definition taking effect promptly without a deploy.
 */
const DEFINITION_TTL_MS = 60_000;
const definitionMemo = new Map<
  string,
  { value: { criteria_value: number; is_active: boolean } | null; expiresAt: number }
>();

async function loadAchievementDefinition(admin: Admin, code: string) {
  const cached = definitionMemo.get(code);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  const { data } = await admin
    .from("achievement_definitions")
    .select("criteria_value, is_active")
    .eq("code", code)
    .maybeSingle();

  definitionMemo.set(code, { value: data ?? null, expiresAt: Date.now() + DEFINITION_TTL_MS });
  return data ?? null;
}

export async function grantCountAchievement(
  admin: Admin,
  userId: string,
  code: string,
  count: number
): Promise<void> {
  try {
    const definition = await loadAchievementDefinition(admin, code);
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
      // Active friendships only: ended_at IS NULL is the canonical definition of "currently Muddies".
      .or(`user_one_id.eq.${userId},user_two_id.eq.${userId}`).is("ended_at", null);
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
