"use server";

import { calculateBuddyScore } from "@/lib/engagement/buddy-score";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getSupabaseServerEnv } from "@/lib/supabase/env";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export type BuddyScoreData = ReturnType<typeof calculateBuddyScore>;

export async function loadBuddyScoreAction(): Promise<BuddyScoreData> {
  const empty = calculateBuddyScore({ friendships: 0, completedPlans: 0, messagesSent: 0, achievementsEarned: 0, accountAgeDays: 0 });
  const env = getSupabaseServerEnv();
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user || !env.url || !env.serviceRoleKey) return empty;
  const admin = createSupabaseAdminClient();
  const [friendships, plans, messages, achievements, profile] = await Promise.all([
    admin.from("friendships").select("id", { count: "exact", head: true }).or(`user_one_id.eq.${user.id},user_two_id.eq.${user.id}`).is("ended_at", null),
    admin.from("plans").select("id", { count: "exact", head: true }).eq("creator_id", user.id).eq("status", "completed"),
    admin.from("messages").select("id", { count: "exact", head: true }).eq("sender_id", user.id).is("deleted_at", null),
    admin.from("user_achievements").select("id", { count: "exact", head: true }).eq("user_id", user.id).eq("hidden", false),
    admin.from("profiles").select("created_at").eq("user_id", user.id).maybeSingle()
  ]);
  const createdAt = profile.data?.created_at ? Date.parse(profile.data.created_at) : Date.now();
  const accountAgeDays = Math.max(0, Math.floor((Date.now() - createdAt) / 86_400_000));
  return calculateBuddyScore({
    friendships: friendships.count ?? 0,
    completedPlans: plans.count ?? 0,
    messagesSent: messages.count ?? 0,
    achievementsEarned: achievements.count ?? 0,
    accountAgeDays
  });
}
