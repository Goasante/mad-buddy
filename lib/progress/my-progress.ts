import type { MembershipIdentity } from "@/lib/billing/membership";
import type { BuddyScoreData } from "@/lib/engagement/buddy-score-service";
import type { JourneyData } from "@/lib/journey/journey";
import type { MilestoneName } from "@/lib/supabase/database.types";

export type ProgressAchievement = {
  code: string;
  name: string;
  description: string;
  iconPath: string | null;
  earnedAt: string;
};

export type ProgressMilestone = {
  key: MilestoneName;
  label: string;
  reachedAt: string;
};

export type ProgressTimelineItem = {
  id: string;
  kind: "score" | "achievement";
  label: string;
  detail: string;
  points: number | null;
  occurredAt: string;
};

export type MyProgressData = {
  score: BuddyScoreData;
  membership: MembershipIdentity;
  profileCompletion: { completed: number; total: number; percent: number };
  achievements: {
    unlockedCount: number;
    featured: ProgressAchievement[];
    recent: ProgressAchievement[];
  };
  milestones: ProgressMilestone[];
  timeline: ProgressTimelineItem[];
  journey: JourneyData;
};

const MILESTONE_LABELS: Partial<Record<MilestoneName, string>> = {
  email_verified: "Email verified",
  profile_completed: "Profile completed",
  privacy_setup_completed: "Privacy preferences set",
  first_muddy_added: "First Muddy added",
  first_status_created: "First status shared",
  first_wave_sent: "First Wave sent",
  first_glow_enabled: "Glow used for the first time",
  first_plan_created: "First Plan created"
};

export function completedProgressMilestones(
  rows: ReadonlyArray<{ milestone: MilestoneName; reached_at: string }>
): ProgressMilestone[] {
  return rows.flatMap((row) => {
    const label = MILESTONE_LABELS[row.milestone];
    return label ? [{ key: row.milestone, label, reachedAt: row.reached_at }] : [];
  });
}

export function featuredAchievements(achievements: readonly ProgressAchievement[], limit = 3) {
  return achievements.slice(0, limit);
}

export function progressTimeline(
  score: BuddyScoreData,
  achievements: readonly ProgressAchievement[],
  limit = 12
): ProgressTimelineItem[] {
  const scoreItems: ProgressTimelineItem[] = score.recentActivity
    .filter((activity) => activity.eventType !== "achievement_earned")
    .map((activity) => ({
      id: `score:${activity.id}`,
      kind: "score",
      label: activity.label,
      detail: activity.category,
      points: activity.points,
      occurredAt: activity.createdAt
    }));
  const achievementItems: ProgressTimelineItem[] = achievements.map((achievement) => ({
    id: `achievement:${achievement.code}`,
    kind: "achievement",
    label: achievement.name,
    detail: "Achievement unlocked",
    points: null,
    occurredAt: achievement.earnedAt
  }));
  return [...scoreItems, ...achievementItems]
    .sort((left, right) => Date.parse(right.occurredAt) - Date.parse(left.occurredAt))
    .slice(0, limit);
}
