"use server";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { loadMyProgress } from "@/lib/progress/my-progress-service";
import type { MyProgressData } from "@/lib/progress/my-progress";

export async function loadBuddyScoreAction(): Promise<MyProgressData> {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return {
      score: { total: 0, level: { key: "new", label: "New Buddy", minimum: 0 }, nextLevel: { key: "trusted", label: "Trusted Buddy", minimum: 200 }, pointsToNext: 200, progressPercent: 0, categories: [], recentActivity: [], earnedReward: null },
      membership: { plan: "free", planLabel: "Free", source: "free", sourceLabel: "Included with Mad Buddy", statusLabel: "Active", dateLabel: null, dateMs: null },
      profileCompletion: { completed: 0, total: 3, percent: 0 },
      achievements: { unlockedCount: 0, featured: [], recent: [] },
      milestones: [],
      timeline: [],
      journey: { completedCount: 0, totalCount: 10, currentStep: null, steps: [] }
    };
  }
  return loadMyProgress(createSupabaseAdminClient(), user.id);
}
