export type BuddyScoreCounts = {
  friendships: number;
  completedPlans: number;
  messagesSent: number;
  achievementsEarned: number;
  accountAgeDays: number;
};

export type BuddyScoreBreakdown = {
  label: string;
  points: number;
  maximum: number;
  detail: string;
};

export function calculateBuddyScore(counts: BuddyScoreCounts) {
  const breakdown: BuddyScoreBreakdown[] = [
    { label: "Approved connections", points: Math.min(counts.friendships * 25, 250), maximum: 250, detail: `${counts.friendships} approved` },
    { label: "Completed plans", points: Math.min(counts.completedPlans * 35, 250), maximum: 250, detail: `${counts.completedPlans} completed` },
    { label: "Messages sent", points: Math.min(counts.messagesSent, 200), maximum: 200, detail: `${counts.messagesSent} sent` },
    { label: "Achievements", points: Math.min(counts.achievementsEarned * 50, 250), maximum: 250, detail: `${counts.achievementsEarned} earned` },
    { label: "Account history", points: Math.min(counts.accountAgeDays, 50), maximum: 50, detail: `${counts.accountAgeDays} days` }
  ];
  return { total: breakdown.reduce((sum, item) => sum + item.points, 0), maximum: 1000, breakdown };
}
