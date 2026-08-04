import "server-only";

import { ACHIEVEMENT_BY_CODE } from "@/lib/achievements/achievement-catalog";
import { resolveMembershipIdentity } from "@/lib/billing/membership";
import { loadBillingState } from "@/lib/billing/service";
import { loadBuddyScore } from "@/lib/engagement/buddy-score-service";
import { profileCompletion } from "@/lib/profile/identity";
import { loadJourney } from "@/lib/journey/journey-service";
import {
  completedProgressMilestones,
  featuredAchievements,
  progressTimeline,
  type MyProgressData,
  type ProgressAchievement
} from "@/lib/progress/my-progress";
import type { createSupabaseAdminClient } from "@/lib/supabase/admin";
import type { MilestoneName } from "@/lib/supabase/database.types";

type Admin = ReturnType<typeof createSupabaseAdminClient>;

/** Owner-only projection for the existing My Progress route. */
export async function loadMyProgress(admin: Admin, userId: string, now = new Date()): Promise<MyProgressData> {
  const [score, billingState, profileResult, achievementResult, milestoneResult] = await Promise.all([
    loadBuddyScore(admin, userId),
    loadBillingState(admin, userId),
    admin.from("profiles").select("avatar_url,bio,mood_status").eq("user_id", userId).maybeSingle(),
    admin.from("user_achievements").select("achievement_code,earned_at").eq("user_id", userId).order("earned_at", { ascending: false }),
    admin.from("activation_milestones").select("milestone,reached_at").eq("user_id", userId).order("reached_at", { ascending: false })
  ]);

  const profile = profileResult.data;
  const achievements: ProgressAchievement[] = (achievementResult.data ?? []).map((row) => {
    const definition = ACHIEVEMENT_BY_CODE.get(row.achievement_code);
    return {
      code: row.achievement_code,
      name: definition?.name ?? "Achievement",
      description: definition?.description ?? "A personal Mad Buddy achievement.",
      iconPath: definition?.iconPath ?? null,
      earnedAt: row.earned_at
    };
  });
  const milestones = completedProgressMilestones(
    (milestoneResult.data ?? []).map((row) => ({ milestone: row.milestone as MilestoneName, reached_at: row.reached_at }))
  );

  const completion = profileCompletion({
    avatarUrl: profile?.avatar_url ?? null,
    bio: profile?.bio ?? "",
    moodStatus: profile?.mood_status ?? ""
  });
  const journey = await loadJourney(admin, userId, now, { score, billingState, profileCompletion: completion });

  return {
    score,
    membership: resolveMembershipIdentity(billingState, now.getTime()),
    profileCompletion: completion,
    achievements: {
      unlockedCount: achievements.length,
      featured: featuredAchievements(achievements),
      recent: achievements.slice(0, 6)
    },
    milestones,
    timeline: progressTimeline(score, achievements),
    journey
  };
}
