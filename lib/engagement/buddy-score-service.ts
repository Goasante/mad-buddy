import "server-only";

import { BUDDY_SCORE_RULES, BUDDY_SCORE_RULE_VERSION, buddyScoreProgress, calculateBuddyScoreTotal, resolveBuddyScoreLevel, scoreEventDefinition, type BuddyScoreEventType, type BuddyScoreLevel } from "@/lib/engagement/buddy-score";
import type { createSupabaseAdminClient } from "@/lib/supabase/admin";

type Admin = ReturnType<typeof createSupabaseAdminClient>;
type Candidate = { event_type: Exclude<BuddyScoreEventType, "admin_correction" | "moderation_penalty">; points_delta: number; source_reference: string; metadata: { category: string } };

export type BuddyScoreActivity = {
  id: string;
  eventType: BuddyScoreEventType;
  label: string;
  category: string;
  points: number;
  createdAt: string;
};

export type BuddyScoreData = {
  total: number;
  level: BuddyScoreLevel;
  nextLevel: BuddyScoreLevel | null;
  pointsToNext: number;
  progressPercent: number;
  categories: Array<{ label: string; points: number }>;
  recentActivity: BuddyScoreActivity[];
};

function candidate(eventType: Candidate["event_type"], sourceReference: string): Candidate {
  const rule = BUDDY_SCORE_RULES[eventType];
  return { event_type: eventType, points_delta: rule.points, source_reference: sourceReference, metadata: { category: rule.category } };
}

/** Reconciles trusted canonical records into the append-only ledger. */
export async function reconcileBuddyScore(admin: Admin, userId: string, now = new Date()) {
  const [profile, authUser, friendships, createdPlans, planParticipations, safeArrivals, achievements] = await Promise.all([
    admin.from("profiles").select("full_name, username, bio, avatar_url, created_at").eq("user_id", userId).maybeSingle(),
    admin.auth.admin.getUserById(userId),
    admin.from("friendships").select("id").or(`user_one_id.eq.${userId},user_two_id.eq.${userId}`).is("ended_at", null),
    admin.from("plans").select("id").eq("creator_id", userId).eq("status", "completed"),
    admin.from("plan_participants").select("plan_id").eq("user_id", userId).eq("rsvp_status", "going"),
    admin.from("safe_arrival_sessions").select("id").eq("traveller_id", userId).eq("status", "completed"),
    admin.from("user_achievements").select("id").eq("user_id", userId)
  ]);
  const candidates: Candidate[] = [];
  if (authUser.data.user?.email_confirmed_at) candidates.push(candidate("email_verified", "account:email"));
  const p = profile.data;
  if (p?.full_name && p.username && p.bio && p.avatar_url) candidates.push(candidate("profile_completed", "profile:complete"));
  if (p?.created_at) {
    const quarters = Math.min(8, Math.max(0, Math.floor((now.getTime() - Date.parse(p.created_at)) / (90 * 86_400_000))));
    for (let index = 1; index <= quarters; index += 1) candidates.push(candidate("account_quarter", `account:quarter:${index}`));
  }
  for (const row of friendships.data ?? []) candidates.push(candidate("friendship_accepted", `friendship:${row.id}`));
  const participatedPlanIds = [...new Set((planParticipations.data ?? []).map((row) => row.plan_id))];
  const completedParticipations = participatedPlanIds.length
    ? await admin.from("plans").select("id").in("id", participatedPlanIds).eq("status", "completed")
    : { data: [] };
  const completedPlanIds = new Set([
    ...(createdPlans.data ?? []).map((row) => row.id),
    ...(completedParticipations.data ?? []).map((row) => row.id)
  ]);
  for (const planId of completedPlanIds) candidates.push(candidate("plan_completed", `plan:${planId}`));
  for (const row of safeArrivals.data ?? []) candidates.push(candidate("safe_arrival_completed", `safe-arrival:${row.id}`));
  for (const row of achievements.data ?? []) candidates.push(candidate("achievement_earned", `achievement:${row.id}`));
  if (candidates.length === 0) return;
  await admin.from("buddy_score_ledger").upsert(
    candidates.map((item) => ({ user_id: userId, ...item, rule_version: BUDDY_SCORE_RULE_VERSION })),
    { onConflict: "user_id,event_type,source_reference", ignoreDuplicates: true }
  );
}

export async function loadBuddyScore(admin: Admin, userId: string): Promise<BuddyScoreData> {
  await reconcileBuddyScore(admin, userId);
  const { data } = await admin.from("buddy_score_ledger").select("id,event_type,points_delta,metadata,created_at").eq("user_id", userId).order("created_at", { ascending: false });
  const rows = data ?? [];
  const total = calculateBuddyScoreTotal(rows);
  const progress = buddyScoreProgress(total);
  const categoryMap = new Map<string, number>();
  const activities = rows.map((row) => {
    const definition = scoreEventDefinition(row.event_type as BuddyScoreEventType);
    categoryMap.set(definition.category, (categoryMap.get(definition.category) ?? 0) + row.points_delta);
    return { id: row.id, eventType: row.event_type as BuddyScoreEventType, label: definition.label, category: definition.category, points: row.points_delta, createdAt: row.created_at };
  });
  return {
    total,
    level: progress.current,
    nextLevel: progress.next,
    pointsToNext: progress.pointsToNext,
    progressPercent: progress.percent,
    categories: [...categoryMap].map(([label, points]) => ({ label, points })).sort((a, b) => b.points - a.points),
    recentActivity: activities.slice(0, 12)
  };
}

/**
 * Read-only Buddy Score level, for surfaces that want to *display* the level
 * without paying for a full loadBuddyScore().
 *
 * Deliberately does NOT call reconcileBuddyScore(): that runs seven queries
 * and INSERTs ledger rows, which is far too much work — and a write — for a
 * label. This reads the existing ledger and resolves the level from it, so a
 * display surface can never mutate score state. The number is whatever the
 * ledger already says; /buddy-score remains the canonical page that
 * reconciles and shows the full breakdown.
 */
export async function loadBuddyScoreLevel(admin: Admin, userId: string): Promise<BuddyScoreLevel> {
  const { data } = await admin.from("buddy_score_ledger").select("points_delta").eq("user_id", userId);
  return resolveBuddyScoreLevel(calculateBuddyScoreTotal(data ?? []));
}

export async function reconcileBuddyScoreTotal(admin: Admin, userId: string) {
  const [{ data: rows }, { data: rpcRows }] = await Promise.all([
    admin.from("buddy_score_ledger").select("points_delta").eq("user_id", userId),
    admin.rpc("buddy_score_total", { target_user_id: userId })
  ]);
  const ledgerTotal = (rows ?? []).reduce((sum, row) => sum + row.points_delta, 0);
  const rpcTotal = Number(Array.isArray(rpcRows) ? rpcRows[0]?.score_total ?? 0 : 0);
  return { reconciled: ledgerTotal === rpcTotal, ledgerTotal, rpcTotal };
}

const CONFIRMED_MODERATION_PENALTIES: Record<string, number> = {
  warn_user: -25,
  rate_limit_user: -50,
  suspend_feature: -60,
  temporary_suspension: -100,
  permanent_suspension: -250
};

/** Reports never score. Only a completed moderation decision may call this. */
export async function recordConfirmedModerationPenalty(admin: Admin, input: { userId: string; reportId: string; actionType: string }) {
  const points = CONFIRMED_MODERATION_PENALTIES[input.actionType];
  if (!points) return { recorded: false, reason: "not_penalized" as const };
  const { error } = await admin.from("buddy_score_ledger").upsert({
    user_id: input.userId,
    event_type: "moderation_penalty",
    points_delta: points,
    source_reference: `moderation:${input.reportId}:${input.actionType}`,
    rule_version: BUDDY_SCORE_RULE_VERSION,
    metadata: { category: "Trust and safety", reason_code: input.actionType }
  }, { onConflict: "user_id,event_type,source_reference", ignoreDuplicates: true });
  return { recorded: !error, reason: error ? "write_failed" as const : "confirmed_outcome" as const };
}
