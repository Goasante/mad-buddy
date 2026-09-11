"use server";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { loadMyProgress } from "@/lib/progress/my-progress-service";
import type { MyProgressData } from "@/lib/progress/my-progress";
import { JOURNEY_STEP_IDS } from "@/lib/journey/journey";

export async function loadBuddyScoreAction(): Promise<MyProgressData> {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return {
      score: {
        total: 0,
        level: { key: "new", label: "New Buddy", minimum: 0 },
        nextLevel: { key: "trusted", label: "Trusted Buddy", minimum: 200 },
        pointsToNext: 200,
        progressPercent: 0,
        categories: [],
        recentActivity: []
      },
      profileCompletion: { completed: 0, total: 3, percent: 0 },
      achievements: { unlockedCount: 0, featured: [], recent: [], all: [] },
      milestones: [],
      timeline: [],
      // Never hard-code the Journey length here: pausing/removing a canonical
      // step must update the anonymous fallback automatically too.
      journey: { completedCount: 0, totalCount: JOURNEY_STEP_IDS.length, currentStep: null, steps: [] }
    };
  }
  return loadMyProgress(createSupabaseAdminClient(), user.id);
}
