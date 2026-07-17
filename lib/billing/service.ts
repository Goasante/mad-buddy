import "server-only";

import {
  resolveEntitlements,
  serializeLimit,
  type BillingState,
  type Entitlements,
  type EntitlementOverride,
  type NumericEntitlementKey
} from "@/lib/billing/entitlements";
import type { createSupabaseAdminClient } from "@/lib/supabase/admin";
import type { SubscriptionPlan, SubscriptionStatus } from "@/lib/supabase/database.types";

/**
 * Entitlement service (spec §10, §82). The single server-side path from a user
 * to what they may do. Every protected operation should resolve through here
 * rather than reading `subscriptions.plan` directly, so grace periods, expiry,
 * and overrides are always honoured.
 */

type Admin = ReturnType<typeof createSupabaseAdminClient>;

export async function loadBillingState(admin: Admin, userId: string): Promise<BillingState> {
  const { data } = await admin
    .from("subscriptions")
    .select("plan, status, current_period_end, grace_ends_at")
    .eq("user_id", userId)
    .maybeSingle();

  if (!data) {
    return { plan: "free", status: "free", periodEndMs: null, graceEndsMs: null };
  }

  return {
    plan: data.plan as SubscriptionPlan,
    status: data.status as SubscriptionStatus,
    periodEndMs: data.current_period_end ? Date.parse(data.current_period_end) : null,
    graceEndsMs: data.grace_ends_at ? Date.parse(data.grace_ends_at) : null
  };
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
      .or(`user_one_id.eq.${userId},user_two_id.eq.${userId}`),
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

/** API-safe entitlement payload — Infinity becomes null (spec §14). */
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
