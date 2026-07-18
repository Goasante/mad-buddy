import "server-only";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getSupabaseServerEnv } from "@/lib/supabase/env";

/**
 * The Home "Upcoming plans" read model. Mirrors the Plans page's membership
 * rule (plans I participate in, non-removed, plus plans I created; host role
 * counts as going) but stays intentionally light: no polls, no invitee
 * picker, no descriptions, upcoming and still-active only, soonest first. It
 * is a focused read for a single surface, not a second copy of the Plans
 * page's full loader.
 */

export type HomeUpcomingPlan = {
  id: string;
  title: string;
  startAt: string;
  organiserName: string;
  myRsvp: string;
  invitedCount: number;
};

export type UpcomingPlansResult = {
  plans: HomeUpcomingPlan[];
  hasMore: boolean;
};

// Statuses that still describe a plan that is going to happen. draft is
// unpublished; cancelled/completed/expired are done. Kept as a const so a new
// PlanStatus value fails the type check here rather than silently slipping in.
const ACTIVE_STATUSES = ["inviting", "polling", "confirmed"] as const;

export async function loadUpcomingPlans(userId: string, limit = 3): Promise<UpcomingPlansResult> {
  const env = getSupabaseServerEnv();
  if (!env.url || !env.serviceRoleKey) return { plans: [], hasMore: false };

  const admin = createSupabaseAdminClient();
  const nowIso = new Date().toISOString();

  const [{ data: myRows }, { data: createdRows }] = await Promise.all([
    admin
      .from("plan_participants")
      .select("plan_id, rsvp_status, role")
      .eq("user_id", userId)
      .neq("rsvp_status", "removed"),
    admin.from("plans").select("id").eq("creator_id", userId)
  ]);

  const planIds = [
    ...new Set([...(myRows ?? []).map((row) => row.plan_id), ...(createdRows ?? []).map((row) => row.id)])
  ];
  if (planIds.length === 0) return { plans: [], hasMore: false };

  const myRowByPlan = new Map((myRows ?? []).map((row) => [row.plan_id, row]));

  // Fetch one extra so "View all" can be decided without a second count query.
  const { data: planRows } = await admin
    .from("plans")
    .select("id, creator_id, title, start_at, status")
    .in("id", planIds)
    .in("status", [...ACTIVE_STATUSES])
    .not("start_at", "is", null)
    .gte("start_at", nowIso)
    .order("start_at", { ascending: true })
    .limit(limit + 1);

  const rows = planRows ?? [];
  const shown = rows.slice(0, limit);
  if (shown.length === 0) return { plans: [], hasMore: false };

  const shownIds = shown.map((plan) => plan.id);
  const creatorIds = [...new Set(shown.map((plan) => plan.creator_id))];

  const [{ data: participantRows }, { data: creatorProfiles }] = await Promise.all([
    admin
      .from("plan_participants")
      .select("plan_id, rsvp_status")
      .in("plan_id", shownIds)
      .neq("rsvp_status", "removed"),
    admin.from("profiles").select("user_id, full_name").in("user_id", creatorIds)
  ]);

  const invitedCountByPlan = new Map<string, number>();
  for (const row of participantRows ?? []) {
    invitedCountByPlan.set(row.plan_id, (invitedCountByPlan.get(row.plan_id) ?? 0) + 1);
  }
  const creatorNameById = new Map(
    (creatorProfiles ?? []).map((profile) => [profile.user_id, profile.full_name?.trim() || "A Muddy"])
  );

  const plans: HomeUpcomingPlan[] = shown.map((plan) => {
    const myRow = myRowByPlan.get(plan.id);
    const isHost = plan.creator_id === userId || myRow?.role === "host" || myRow?.role === "co_host";
    return {
      id: plan.id,
      title: plan.title,
      startAt: plan.start_at as string,
      organiserName: plan.creator_id === userId ? "You" : creatorNameById.get(plan.creator_id) ?? "A Muddy",
      myRsvp: isHost ? "going" : myRow?.rsvp_status ?? "invited",
      invitedCount: invitedCountByPlan.get(plan.id) ?? 0
    };
  });

  return { plans, hasMore: rows.length > limit };
}
