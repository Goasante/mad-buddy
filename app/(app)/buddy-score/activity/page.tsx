import { ActivityHistoryPage } from "@/components/buddy-score/activity-history-page";
import { loadBuddyScoreAction } from "@/app/(app)/buddy-score-actions";

export const dynamic = "force-dynamic";

export default async function BuddyScoreActivityRoute() {
  const progress = await loadBuddyScoreAction();
  return <ActivityHistoryPage progress={progress} />;
}
