import type { ViewerRelationship } from "@/lib/profile/rules";

export type ProfileAchievement = {
  code: string;
  name: string;
  iconPath: string | null;
  earnedAt: string;
};

export type ProfileIdentitySummary = {
  buddyScore: {
    levelLabel: string;
    total: number | null;
    progressPercent: number | null;
    recentActivity: Array<{
      id: string;
      label: string;
      points: number;
      createdAt: string;
    }> | null;
  } | null;
  achievements: {
    unlockedCount: number;
    featured: ProfileAchievement[];
  } | null;
  activity: {
    muddyCount: number;
    momentCount: number;
    completedPlanCount: number;
    completedSafeArrivalCount: number;
  } | null;
};

export function profileIdentityAccess(relationship: ViewerRelationship) {
  const isSelf = relationship === "self";
  const isApproved = relationship === "approved_muddy" || relationship === "close_friend";
  return {
    showBuddyScore: true,
    showExactBuddyScore: isSelf,
    showBuddyScoreActivity: isSelf,
    showAchievements: isSelf || isApproved,
    showActivity: isSelf
  };
}

export function profileCompletion(input: { avatarUrl: string | null; bio: string; moodStatus: string }) {
  const completed = [Boolean(input.avatarUrl), Boolean(input.bio.trim()), Boolean(input.moodStatus.trim())].filter(Boolean).length;
  return { completed, total: 3, percent: Math.round((completed / 3) * 100) };
}
