import "server-only";

import {
  effectivePlan,
  resolveEntitlements,
  serializeLimit,
  type BillingState,
  type Entitlements,
  type EntitlementOverride,
  type NumericEntitlementKey
} from "@/lib/billing/entitlements";
import { resolveEffectivePlanMap } from "@/lib/billing/effective-plans";
import type { createSupabaseAdminClient } from "@/lib/supabase/admin";
import type { SubscriptionPlan, SubscriptionStatus } from "@/lib/supabase/database.types";
import { loadActiveTrialAccess } from "@/lib/trials/service";
import { legacyTierOf } from "@/lib/supabase/database.types";

/**
 * Entitlement service (spec §10, §82). The single server-side path from a user
 * to what they may do. Every protected operation should resolve through here
 * rather than reading `subscriptions.plan` directly, so grace periods, expiry,
 * and overrides are always honoured.
 */

type Admin = ReturnType<typeof createSupabaseAdminClient>;

/** Request-time server clock for entitlement and membership presentation. */
export function billingServerNowMs(): number {
  return Date.now();
}

export async function loadBillingState(admin: Admin, userId: string): Promise<BillingState> {
  const nowIso = new Date().toISOString();
  const [{ data }, trial, rewardResult] = await Promise.all([
    admin
      .from("subscriptions")
      .select("plan, status, current_period_end, grace_ends_at")
      .eq("user_id", userId)
      .maybeSingle(),
    loadActiveTrialAccess(admin, userId),
    admin.from("earned_premium_rewards").select("id,reward_plan,granted_at,expires_at,grace_ends_at").eq("user_id", userId).in("status", ["active", "grace"]).lte("granted_at", nowIso).or(`expires_at.gt.${nowIso},grace_ends_at.gt.${nowIso}`).order("granted_at", { ascending: false }).limit(1).maybeSingle()
  ]);
  const reward = rewardResult.data;

  if (!data) {
    return {
      plan: "free",
      status: "free",
      periodEndMs: null,
      graceEndsMs: null,
      trialId: trial?.id ?? null,
      trialPlan: trial?.plan ?? null,
      trialStartedAtMs: trial?.startedAtMs ?? null,
      trialEndsAtMs: trial?.endsAtMs ?? null,
      earnedRewardId: reward?.id ?? null,
      earnedPlan: reward?.reward_plan ?? null,
      earnedStartsAtMs: reward?.granted_at ? Date.parse(reward.granted_at) : null,
      earnedEndsAtMs: reward?.expires_at ? Date.parse(reward.expires_at) : null,
      earnedGraceEndsAtMs: reward?.grace_ends_at ? Date.parse(reward.grace_ends_at) : null
    };
  }

  return {
    plan: data.plan as SubscriptionPlan,
    status: data.status as SubscriptionStatus,
    periodEndMs: data.current_period_end ? Date.parse(data.current_period_end) : null,
    graceEndsMs: data.grace_ends_at ? Date.parse(data.grace_ends_at) : null,
    trialId: trial?.id ?? null,
    trialPlan: trial?.plan ?? null,
    trialStartedAtMs: trial?.startedAtMs ?? null,
    trialEndsAtMs: trial?.endsAtMs ?? null,
    earnedRewardId: reward?.id ?? null,
    earnedPlan: reward?.reward_plan ?? null,
    earnedStartsAtMs: reward?.granted_at ? Date.parse(reward.granted_at) : null,
    earnedEndsAtMs: reward?.expires_at ? Date.parse(reward.expires_at) : null,
    earnedGraceEndsAtMs: reward?.grace_ends_at ? Date.parse(reward.grace_ends_at) : null
  };
}

/**
 * Batched effective-plan lookup for identity surfaces. This avoids N+1
 * billing queries while retaining the exact paid, grace, expiry, and trial
 * semantics used by entitlement enforcement.
 */
export async function loadEffectivePlansForUsers(
  admin: Admin,
  userIds: readonly string[],
  nowMs = Date.now()
): Promise<Map<string, SubscriptionPlan>> {
  const uniqueIds = [...new Set(userIds)].filter(Boolean);
  if (uniqueIds.length === 0) return new Map();

  const nowIso = new Date(nowMs).toISOString();
  const [subscriptionsResult, trialsResult, rewardsResult] = await Promise.all([
    admin
      .from("subscriptions")
      .select("user_id, plan, status, current_period_end, grace_ends_at")
      .in("user_id", uniqueIds),
    admin
      .from("premium_trials")
      .select("id, user_id, plan, trial_started_at, trial_ends_at")
      .in("user_id", uniqueIds)
      .eq("status", "active")
      .lte("trial_started_at", nowIso)
      .gt("trial_ends_at", nowIso)
      .order("trial_started_at", { ascending: false }),
    admin.from("earned_premium_rewards").select("id,user_id,reward_plan,granted_at,expires_at,grace_ends_at").in("user_id", uniqueIds).in("status", ["active", "grace"]).lte("granted_at", nowIso).or(`expires_at.gt.${nowIso},grace_ends_at.gt.${nowIso}`).order("granted_at", { ascending: false })
  ]);

  if (subscriptionsResult.error) {
    return new Map(uniqueIds.map((userId) => [userId, "free" as const]));
  }

  return resolveEffectivePlanMap(
    uniqueIds,
    /* Access rows read as no tier here. `resolveEffectivePlanMap` answers
       "which ladder tier is this person on", and Access is not on the ladder --
       its entitlement comes from lib/access/resolver instead. */
    (subscriptionsResult.data ?? []).map((row) => ({ ...row, plan: legacyTierOf(row.plan) })),
    trialsResult.error ? [] : (trialsResult.data ?? []),
    nowMs,
    rewardsResult.error ? [] : (rewardsResult.data ?? [])
  );
}

/** Effective plan for one identity surface, resolved only on the server. */
export async function loadEffectivePlan(admin: Admin, userId: string, nowMs = Date.now()): Promise<SubscriptionPlan> {
  const state = await loadBillingState(admin, userId);
  return effectivePlan(state, nowMs);
}

async function loadOverrides(admin: Admin, userId: string): Promise<EntitlementOverride[]> {
  const { data } = await admin
    .from("entitlement_overrides")
    .select("entitlement_key, value_type, integer_value, boolean_value, starts_at, ends_at")
    .eq("subject_type", "user")
    .eq("subject_id", userId);

  return (data ?? []).map((row) => ({
    key: row.entitlement_key as EntitlementOverride["key"],
    value: row.value_type === "integer" ? (row.integer_value ?? 0) : Boolean(row.boolean_value),
    startsAtMs: row.starts_at ? Date.parse(row.starts_at) : null,
    endsAtMs: row.ends_at ? Date.parse(row.ends_at) : null
  }));
}

/** Resolves a user's effective entitlements from verified billing state. */
export async function resolveUserEntitlements(
  admin: Admin,
  userId: string,
  nowMs = Date.now()
): Promise<Entitlements> {
  const [state, overrides] = await Promise.all([loadBillingState(admin, userId), loadOverrides(admin, userId)]);
  return resolveEntitlements({ state, overrides, nowMs });
}

export type UsageSnapshot = {
  muddies: number;
  personalCircles: number;
  closeFriends: number;
  activePlans: number;
  privateGroups: number;
};

/** Current usage for the limits we enforce (spec §14). */
export async function calculateUsage(admin: Admin, userId: string): Promise<UsageSnapshot> {
  const [muddies, circles, closeFriends, plans, groups] = await Promise.all([
    admin
      .from("friendships")
      .select("id", { count: "exact", head: true })
      // Active friendships only: ended_at IS NULL is the canonical definition of "currently Muddies".
      .or(`user_one_id.eq.${userId},user_two_id.eq.${userId}`).is("ended_at", null),
    admin
      .from("friend_circles")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .is("archived_at", null),
    admin.from("close_friend_relationships").select("id", { count: "exact", head: true }).eq("owner_id", userId),
    admin
      .from("plans")
      .select("id", { count: "exact", head: true })
      .eq("creator_id", userId)
      .in("status", ["draft", "inviting", "polling", "confirmed"]),
    admin
      .from("conversation_members")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .eq("role", "owner")
      .eq("status", "joined")
  ]);

  return {
    muddies: muddies.count ?? 0,
    personalCircles: circles.count ?? 0,
    closeFriends: closeFriends.count ?? 0,
    activePlans: plans.count ?? 0,
    privateGroups: groups.count ?? 0
  };
}

/** API-safe entitlement payload, Infinity becomes null (spec §14). */
export function serializeEntitlements(entitlements: Entitlements): Record<string, number | boolean | null> {
  const output: Record<string, number | boolean | null> = {};
  for (const [key, value] of Object.entries(entitlements)) {
    output[key] = typeof value === "number" ? serializeLimit(value) : value;
  }
  return output;
}

/**
 * Server-side gate for a capacity-limited operation. Prefer this over reading a
 * plan name: it accounts for grace periods and overrides, and it counts real
 * usage rather than trusting the client (spec §12).
 */
export async function assertWithinLimit(
  admin: Admin,
  userId: string,
  key: NumericEntitlementKey,
  current: number,
  requested = 1
): Promise<{ allowed: boolean; limit: number }> {
  const entitlements = await resolveUserEntitlements(admin, userId);
  const limit = entitlements[key];
  return { allowed: current + requested <= limit, limit };
}
