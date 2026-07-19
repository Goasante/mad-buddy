import { BuddyScorePage } from "@/components/buddy-score/buddy-score-page";
import { loadBuddyScoreAction } from "@/app/(app)/buddy-score-actions";

export const dynamic = "force-dynamic";

export default async function BuddyScoreRoute() {
  const score = await loadBuddyScoreAction();
  return <BuddyScorePage score={score} />;
}
