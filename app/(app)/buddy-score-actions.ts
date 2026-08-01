"use server";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { loadBuddyScore, type BuddyScoreData } from "@/lib/engagement/buddy-score-service";

export async function loadBuddyScoreAction(): Promise<BuddyScoreData> {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return { total: 0, level: { key: "new", label: "New Buddy", minimum: 0 }, nextLevel: { key: "trusted", label: "Trusted Buddy", minimum: 200 }, pointsToNext: 200, progressPercent: 0, categories: [], recentActivity: [], earnedReward: null };
  }
  return loadBuddyScore(createSupabaseAdminClient(), user.id);
}
