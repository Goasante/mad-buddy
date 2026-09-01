import "server-only";

import { loadBuddyScore, type BuddyScoreData } from "@/lib/engagement/buddy-score-service";
import { buildJourney, type JourneyData, type JourneyEvidence } from "@/lib/journey/journey";
import { profileCompletion } from "@/lib/profile/identity";
import type { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getReplayableTours } from "@/lib/tours/service";

type Admin = ReturnType<typeof createSupabaseAdminClient>;

/** Canonical, owner-only Journey projection built entirely from trusted records. */
export async function loadJourney(
  admin: Admin,
  userId: string,
  now = new Date(),
  context: {
    score?: BuddyScoreData;
    profileCompletion?: { completed: number; total: number; percent: number };
  } = {}
): Promise<JourneyData> {
  const [profileResult, friendships, milestones, waves, messages, plans, safeArrivals, moments, score, tours] = await Promise.all([
    context.profileCompletion ? Promise.resolve({ data: null }) : admin.from("profiles").select("avatar_url,bio,mood_status").eq("user_id", userId).maybeSingle(),
    admin.from("friendships").select("id", { count: "exact", head: true }).or(`user_one_id.eq.${userId},user_two_id.eq.${userId}`).is("ended_at", null),
    admin.from("activation_milestones").select("milestone").eq("user_id", userId),
    admin.from("waves").select("id", { count: "exact", head: true }).eq("sender_id", userId),
    admin.from("messages").select("id", { count: "exact", head: true }).eq("sender_id", userId).in("status", ["sent", "delivered", "read"]),
    admin.from("plans").select("id", { count: "exact", head: true }).eq("creator_id", userId).neq("status", "draft"),
    admin.from("safe_arrival_sessions").select("id", { count: "exact", head: true }).eq("traveller_id", userId).eq("status", "completed"),
    admin.from("moments").select("id", { count: "exact", head: true }).eq("author_id", userId).in("status", ["active", "expired"]),
    context.score ? Promise.resolve(context.score) : loadBuddyScore(admin, userId),
    getReplayableTours(userId)
  ]);

  const profile = profileResult.data;
  const completion = context.profileCompletion ?? profileCompletion({ avatarUrl: profile?.avatar_url ?? null, bio: profile?.bio ?? "", moodStatus: profile?.mood_status ?? "" });
  const reached = new Set((milestones.data ?? []).map((row) => row.milestone));
  const evidence: JourneyEvidence = {
    complete_profile: completion.percent === 100,
    add_first_muddy: (friendships.count ?? 0) > 0,
    turn_on_visibility: reached.has("first_glow_enabled"),
    send_first_wave: (waves.count ?? 0) > 0,
    start_first_conversation: (messages.count ?? 0) > 0,
    create_first_plan: (plans.count ?? 0) > 0,
    complete_first_safe_arrival: (safeArrivals.count ?? 0) > 0,
    share_first_moment: (moments.count ?? 0) > 0,
    reach_trusted_buddy: score.total >= 200
  };
  return buildJourney(evidence, new Map(tours.map((tour) => [tour.slug, tour.tourVersionId])));
}
