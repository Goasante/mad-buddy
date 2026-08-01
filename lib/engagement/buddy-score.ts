export const BUDDY_SCORE_RULE_VERSION = 1;

export const BUDDY_SCORE_LEVELS = [
  { key: "new", label: "New Buddy", minimum: 0 },
  { key: "trusted", label: "Trusted Buddy", minimum: 200 },
  { key: "elite", label: "Elite Buddy", minimum: 500 },
  { key: "legend", label: "Legend Buddy", minimum: 1000 }
] as const;

export const BUDDY_SCORE_RULES = {
  email_verified: { points: 50, category: "Account trust", label: "Verified email" },
  profile_completed: { points: 50, category: "Account trust", label: "Completed profile" },
  account_quarter: { points: 25, category: "Account trust", label: "Account history" },
  friendship_accepted: { points: 20, category: "Connections", label: "Approved Muddy" },
  plan_completed: { points: 40, category: "Plans", label: "Completed plan" },
  safe_arrival_completed: { points: 30, category: "Safety", label: "Safe Arrival completed" },
  achievement_earned: { points: 25, category: "Achievements", label: "Achievement earned" }
} as const;

export type BuddyScoreEventType = keyof typeof BUDDY_SCORE_RULES | "admin_correction" | "moderation_penalty";
export type BuddyScoreLevel = (typeof BUDDY_SCORE_LEVELS)[number];

export function resolveBuddyScoreLevel(score: number): BuddyScoreLevel {
  const safeScore = Math.max(0, Math.trunc(score));
  return [...BUDDY_SCORE_LEVELS].reverse().find((level) => safeScore >= level.minimum) ?? BUDDY_SCORE_LEVELS[0];
}

export function buddyScoreProgress(score: number) {
  const current = resolveBuddyScoreLevel(score);
  const currentIndex = BUDDY_SCORE_LEVELS.findIndex((level) => level.key === current.key);
  const next = BUDDY_SCORE_LEVELS[currentIndex + 1] ?? null;
  if (!next) return { current, next, pointsToNext: 0, percent: 100 };
  const earnedInLevel = Math.max(0, score - current.minimum);
  const span = next.minimum - current.minimum;
  return {
    current,
    next,
    pointsToNext: Math.max(0, next.minimum - score),
    percent: Math.min(100, Math.round((earnedInLevel / span) * 100))
  };
}

export function scoreEventDefinition(eventType: BuddyScoreEventType) {
  if (eventType === "admin_correction") return { category: "Corrections", label: "Score correction" };
  if (eventType === "moderation_penalty") return { category: "Trust and safety", label: "Confirmed moderation outcome" };
  return BUDDY_SCORE_RULES[eventType];
}

export function modelBuddyScorePace() {
  return {
    trusted: "Several genuine connections plus a complete, verified account",
    elite: "Sustained participation over several months",
    legend: "A rare, long-term record of trusted participation"
  } as const;
}
