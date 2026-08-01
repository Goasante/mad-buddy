import { BuddyScorePage } from "@/components/buddy-score/buddy-score-page";
import { loadBuddyScoreAction } from "@/app/(app)/buddy-score-actions";

export const dynamic = "force-dynamic";
const PREVIEW_REWARD_END = "2026-09-01T12:00:00.000Z";
const PREVIEW_GRACE_END = "2026-08-08T12:00:00.000Z";

export default async function BuddyScoreRoute({ searchParams }: { searchParams?: Promise<{ scorePreview?: string }> }) {
  const params = await searchParams;
  const preview = process.env.NODE_ENV !== "production" ? params?.scorePreview : undefined;
  const loaded = await loadBuddyScoreAction();
  const score = preview === "high" ? {
    total: 1125,
    level: { key: "legend", label: "Legend Buddy", minimum: 1000 } as const,
    nextLevel: null,
    pointsToNext: 0,
    progressPercent: 100,
    categories: [{ label: "Connections", points: 420 }, { label: "Plans", points: 320 }, { label: "Safety", points: 210 }, { label: "Account trust", points: 175 }],
    recentActivity: loaded.recentActivity,
    earnedReward: null
  } : preview === "new" ? { ...loaded, total: 0, level: { key: "new", label: "New Buddy", minimum: 0 } as const, nextLevel: { key: "trusted", label: "Trusted Buddy", minimum: 200 } as const, pointsToNext: 200, progressPercent: 0, categories: [], recentActivity: [], earnedReward: null }
    : preview === "near" ? { ...loaded, total: 620, level: { key: "elite", label: "Elite Buddy", minimum: 500 } as const, nextLevel: { key: "legend", label: "Legend Buddy", minimum: 1000 } as const, pointsToNext: 380, progressPercent: 24, earnedReward: null }
      : preview === "plus" || preview === "pro" || preview === "grace" ? { ...loaded, earnedReward: { plan: preview === "pro" ? "buddy_pro" as const : "buddy_plus" as const, status: preview === "grace" ? "grace" as const : "active" as const, expiresAt: PREVIEW_REWARD_END, graceEndsAt: preview === "grace" ? PREVIEW_GRACE_END : null } }
        : loaded;
  return <BuddyScorePage score={score} />;
}
