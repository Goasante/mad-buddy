import "server-only";

import { areApprovedMuddies, isBlockedEitherDirection, isCloseFriend } from "@/lib/social/permissions";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getSupabaseServerEnv } from "@/lib/supabase/env";

/**
 * Muddies who are open to plans right now (active Hangout Mode sessions), for
 * the mobile Home "Muddies open to plans" section. Conservative eligibility:
 * mutual + not blocked + not Ghost Mode, and only all_muddies / close_friends
 * audiences (circle/selected audiences are treated as not-visible here rather
 * than risk leaking). Broad area text only — never location.
 */

type Admin = ReturnType<typeof createSupabaseAdminClient>;

export type OpenToPlan = {
  id: string;
  ownerName: string;
  activityType: string;
  message: string | null;
  broadAreaText: string | null;
  endsAt: string;
};

async function canView(
  admin: Admin,
  viewerId: string,
  session: { owner_id: string; audience_type: string }
): Promise<boolean> {
  const [mutual, blocked] = await Promise.all([
    areApprovedMuddies(admin, session.owner_id, viewerId),
    isBlockedEitherDirection(admin, session.owner_id, viewerId)
  ]);
  if (!mutual || blocked) return false;

  const { data: profile } = await admin
    .from("profiles")
    .select("visibility_status")
    .eq("user_id", session.owner_id)
    .maybeSingle();
  if (profile?.visibility_status === "ghost") return false;

  if (session.audience_type === "all_muddies") return true;
  if (session.audience_type === "close_friends") return isCloseFriend(admin, session.owner_id, viewerId);
  return false;
}

export async function listOpenToPlans(userId: string): Promise<OpenToPlan[]> {
  const env = getSupabaseServerEnv();
  if (!env.url || !env.serviceRoleKey) return [];

  const admin = createSupabaseAdminClient();
  const { data: friendships } = await admin
    .from("friendships")
    .select("user_one_id, user_two_id")
    .or(`user_one_id.eq.${userId},user_two_id.eq.${userId}`)
    .is("ended_at", null);
  const friendIds = (friendships ?? []).map((row) => (row.user_one_id === userId ? row.user_two_id : row.user_one_id));
  if (friendIds.length === 0) return [];

  const { data: sessions } = await admin
    .from("hangout_sessions")
    .select("id, owner_id, activity_type, message, broad_area_text, ends_at, audience_type, status")
    .in("owner_id", friendIds)
    .eq("status", "active")
    .gt("ends_at", new Date().toISOString())
    .order("ends_at", { ascending: true })
    .limit(50);
  if (!sessions?.length) return [];

  const visible: typeof sessions = [];
  for (const session of sessions) {
    if (await canView(admin, userId, session)) visible.push(session);
  }
  if (visible.length === 0) return [];

  const { data: owners } = await admin
    .from("profiles")
    .select("user_id, full_name")
    .in("user_id", [...new Set(visible.map((s) => s.owner_id))]);
  const nameById = new Map((owners ?? []).map((row) => [row.user_id, row.full_name]));

  return visible.map((session) => ({
    id: session.id,
    ownerName: nameById.get(session.owner_id)?.trim() || "A Muddy",
    activityType: session.activity_type,
    message: session.message,
    broadAreaText: session.broad_area_text,
    endsAt: session.ends_at
  }));
}
