import "server-only";

import { ACTIVE_ACHIEVEMENT_BY_CODE } from "@/lib/achievements/achievement-catalog";
import { loadBuddyScore, type BuddyScoreData } from "@/lib/engagement/buddy-score-service";

/**
 * Activity counts a caller may already hold. Only facts whose filters are
 * IDENTICAL to Identity's own queries belong here -- sharing a differently
 * filtered count would silently change what the profile reports.
 */
export type SharedActivityCounts = {
  muddyCount?: number;
  momentCount?: number;
};
import { profileIdentityAccess, type ProfileIdentitySummary } from "@/lib/profile/identity";
import type { ViewerRelationship } from "@/lib/profile/rules";
import type { createSupabaseAdminClient } from "@/lib/supabase/admin";

type Admin = ReturnType<typeof createSupabaseAdminClient>;

async function loadOwnActivity(
  admin: Admin,
  userId: string,
  shared: SharedActivityCounts = {}
): Promise<NonNullable<ProfileIdentitySummary["activity"]>> {
  // Friendship and Moment counts may already be loaded by the Profile route.
  // Completed Meetups come from the durable score ledger because operational
  // Meetup rows are intentionally cleaned up after their short retention.
  const [friendships, moments, completedMeetups] = await Promise.all([
    shared.muddyCount !== undefined
      ? Promise.resolve({ count: shared.muddyCount })
      : admin.from("friendships").select("id", { count: "exact", head: true }).or(`user_one_id.eq.${userId},user_two_id.eq.${userId}`).is("ended_at", null),
    shared.momentCount !== undefined
      ? Promise.resolve({ count: shared.momentCount })
      : admin.from("moments").select("id", { count: "exact", head: true }).eq("author_id", userId).in("status", ["active", "expired"]),
    admin.from("buddy_score_ledger").select("id", { count: "exact", head: true }).eq("user_id", userId).eq("event_type", "meetup_completed")
  ]);

  return {
    muddyCount: friendships.count ?? 0,
    momentCount: moments.count ?? 0,
    completedMeetupCount: completedMeetups.count ?? 0
  };
}

export async function loadProfileIdentitySummary(
  admin: Admin,
  userId: string,
  relationship: ViewerRelationship,
  // Optional preloaded score, so a caller that already resolved one (e.g. the
  // Profile route, which also needs it for Journey) does not pay for a second
  // load. Backward compatible: callers that omit it behave exactly as before.
  context: { score?: BuddyScoreData; activity?: SharedActivityCounts } = {}
): Promise<ProfileIdentitySummary> {
  const access = profileIdentityAccess(relationship);
  let achievementsQuery = admin
    .from("user_achievements")
    .select("achievement_code, earned_at")
    .eq("user_id", userId);
  if (relationship !== "self") achievementsQuery = achievementsQuery.eq("hidden", false);

  const [score, achievementsResult, activity] = await Promise.all([
    access.showBuddyScore
      ? context.score
        ? Promise.resolve(context.score)
        : loadBuddyScore(admin, userId)
      : Promise.resolve(null),
    access.showAchievements
      ? achievementsQuery.order("earned_at", { ascending: false })
      : Promise.resolve(null),
    access.showActivity ? loadOwnActivity(admin, userId, context.activity) : Promise.resolve(null)
  ]);

  return {
    buddyScore: score
      ? {
          levelLabel: score.level.label,
          total: access.showExactBuddyScore ? score.total : null,
          progressPercent: access.showExactBuddyScore ? score.progressPercent : null,
          recentActivity: access.showBuddyScoreActivity
            ? score.recentActivity.slice(0, 3).map(({ id, label, points, createdAt }) => ({ id, label, points, createdAt }))
            : null
        }
      : null,
    achievements: achievementsResult
      ? (() => {
          const current = (achievementsResult.data ?? []).flatMap((row) => {
            const definition = ACTIVE_ACHIEVEMENT_BY_CODE.get(row.achievement_code);
            return definition
              ? [{
                  code: row.achievement_code,
                  name: definition.name,
                  iconPath: definition.iconPath,
                  earnedAt: row.earned_at
                }]
              : [];
          });
          return { unlockedCount: current.length, featured: current.slice(0, 3) };
        })()
      : null,
    activity
  };
}
