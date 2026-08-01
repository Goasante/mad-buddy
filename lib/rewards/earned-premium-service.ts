import "server-only";
import { recordProductEvent } from "@/lib/analytics/track";
import { deliverNotification } from "@/lib/notifications/server";
import { EARNED_REWARD_GRACE_DAYS, EARNED_REWARD_RULES, EARNED_REWARD_RULE_VERSION, decideEarnedRewardLifecycle, eligibleEarnedReward, rewardEndsSoon, rewardGrantKey, type EarnedRewardPlan } from "@/lib/rewards/earned-premium";
import type { createSupabaseAdminClient } from "@/lib/supabase/admin";

type Admin = ReturnType<typeof createSupabaseAdminClient>;
const DAY = 86_400_000;

async function evidenceFor(admin: Admin, userId: string, now: Date) {
  const [profile, authUser, ledger, plans, arrivals, restrictions] = await Promise.all([
    admin.from("profiles").select("created_at").eq("user_id", userId).maybeSingle(),
    admin.auth.admin.getUserById(userId),
    admin.from("buddy_score_ledger").select("points_delta").eq("user_id", userId),
    admin.from("plans").select("id", { count: "exact", head: true }).eq("creator_id", userId).eq("status", "completed"),
    admin.from("safe_arrival_sessions").select("id", { count: "exact", head: true }).eq("traveller_id", userId).eq("status", "completed"),
    admin.from("user_restrictions").select("restriction_type,ends_at").eq("user_id", userId).is("lifted_at", null)
  ]);
  const score = Math.max(0, (ledger.data ?? []).reduce((sum, row) => sum + row.points_delta, 0));
  const serious = (restrictions.data ?? []).some((row) => ["suspended_temporary", "suspended_permanent", "messaging_disabled"].includes(row.restriction_type) && (!row.ends_at || Date.parse(row.ends_at) > now.getTime()));
  return { score, accountAgeDays: profile.data?.created_at ? Math.floor((now.getTime() - Date.parse(profile.data.created_at)) / DAY) : 0, emailVerified: Boolean(authUser.data.user?.email_confirmed_at), plansCompleted: plans.count ?? 0, safeArrivalsCompleted: arrivals.count ?? 0, seriousRestriction: serious };
}

async function notify(admin: Admin, userId: string, type: "unlocked" | "renewed" | "ending" | "grace" | "expired" | "revoked", plan: EarnedRewardPlan, rewardId: string) {
  const name = plan === "buddy_pro" ? "Buddy Pro" : "Buddy Plus";
  const copy = {
    unlocked: [`${name} unlocked`, `You earned temporary ${name} access through trusted participation.`],
    renewed: [`${name} renewed`, `Your earned ${name} access has been renewed.`],
    ending: [`${name} ends soon`, `Your earned ${name} access ends soon. Continued eligibility can renew it.`],
    grace: [`${name} grace period`, `Your earned access is in a short grace period while eligibility is reviewed.`],
    expired: [`Earned access ended`, `Your earned ${name} access has expired.`],
    revoked: [`Earned access revoked`, `Your earned ${name} access ended after a confirmed account restriction.`]
  }[type];
  await deliverNotification(admin, { userId, type: "system_alert", title: copy[0], message: copy[1] });
  const eventName = type === "unlocked" ? (plan === "buddy_pro" ? "earned_pro_unlocked" : "earned_plus_unlocked") : type === "renewed" ? "earned_reward_renewed" : type === "revoked" ? "earned_reward_revoked" : "earned_reward_expired";
  if (type !== "grace" && type !== "ending") await recordProductEvent(admin, { eventName, actorId: userId, resourceType: "earned_premium_rewards", resourceId: rewardId, featureKey: "earned_rewards" });
}

export async function evaluateEarnedReward(admin: Admin, userId: string, now = new Date()) {
  const evidence = await evidenceFor(admin, userId, now);
  const eligiblePlan = eligibleEarnedReward(evidence);
  const { data: current } = await admin.from("earned_premium_rewards").select("*").eq("user_id", userId).in("status", ["active", "grace"]).order("granted_at", { ascending: false }).limit(1).maybeSingle();
  const decision = decideEarnedRewardLifecycle({
    current: current ? { status: current.status === "grace" ? "grace" : "active", expiresAtMs: Date.parse(current.expires_at), graceEndsAtMs: current.grace_ends_at ? Date.parse(current.grace_ends_at) : null } : null,
    eligiblePlan,
    seriousRestriction: evidence.seriousRestriction,
    nowMs: now.getTime()
  });
  if (current && decision === "revoked") {
    await admin.from("earned_premium_rewards").update({ status: "revoked", revoked_at: now.toISOString(), revoke_reason: "confirmed_serious_restriction", updated_at: now.toISOString() }).eq("id", current.id);
    await notify(admin, userId, "revoked", current.reward_plan, current.id);
    return "revoked" as const;
  }
  if (current && decision === "active") {
    if (rewardEndsSoon(Date.parse(current.expires_at), current.ending_notified_at, now.getTime())) {
      const { data: claimed } = await admin
        .from("earned_premium_rewards")
        .update({ ending_notified_at: now.toISOString(), updated_at: now.toISOString() })
        .eq("id", current.id)
        .is("ending_notified_at", null)
        .select("id")
        .maybeSingle();
      if (claimed) await notify(admin, userId, "ending", current.reward_plan, current.id);
    }
    return "active" as const;
  }
  if (current && decision === "grace") {
    if (current.status !== "grace") {
      const graceEnds = new Date(now.getTime() + EARNED_REWARD_GRACE_DAYS * DAY).toISOString();
      await admin.from("earned_premium_rewards").update({ status: "grace", grace_ends_at: graceEnds, updated_at: now.toISOString() }).eq("id", current.id);
      await notify(admin, userId, "grace", current.reward_plan, current.id);
    }
    return "grace" as const;
  }
  if (current && decision === "expired") {
    await admin.from("earned_premium_rewards").update({ status: "expired", updated_at: now.toISOString() }).eq("id", current.id);
    await notify(admin, userId, "expired", current.reward_plan, current.id);
    return "expired" as const;
  }
  if (decision === "ineligible" || !eligiblePlan) return "ineligible" as const;
  if (current) await admin.from("earned_premium_rewards").update({ status: "expired", updated_at: now.toISOString() }).eq("id", current.id);
  const duration = EARNED_REWARD_RULES[eligiblePlan].durationDays;
  const { data: reward, error } = await admin.from("earned_premium_rewards").upsert({ user_id: userId, reward_plan: eligiblePlan, source_score_snapshot: evidence.score, grant_key: rewardGrantKey(userId, eligiblePlan, now), granted_at: now.toISOString(), expires_at: new Date(now.getTime() + duration * DAY).toISOString(), grace_ends_at: null, rule_version: EARNED_REWARD_RULE_VERSION, status: "active" }, { onConflict: "grant_key", ignoreDuplicates: true }).select("id").maybeSingle();
  if (error || !reward) return "unchanged" as const;
  const grantEvent = current ? "renewed" as const : "unlocked" as const;
  await notify(admin, userId, grantEvent, eligiblePlan, reward.id);
  return grantEvent;
}

export async function processEarnedRewards(admin: Admin) {
  let changed = 0;
  const changedStates = new Set(["unlocked", "renewed", "grace", "expired", "revoked"]);
  const pageSize = 500;
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await admin.from("profiles").select("user_id").is("deleted_at", null).order("user_id").range(offset, offset + pageSize - 1);
    if (error) throw error;
    for (const profile of data ?? []) if (changedStates.has(await evaluateEarnedReward(admin, profile.user_id))) changed += 1;
    if ((data?.length ?? 0) < pageSize) break;
  }
  return changed;
}

export async function revokeEarnedReward(admin: Admin, input: { rewardId: string; reason: string; now?: Date }) {
  const now = input.now ?? new Date();
  const { data: current } = await admin
    .from("earned_premium_rewards")
    .select("id,user_id,reward_plan,status")
    .eq("id", input.rewardId)
    .in("status", ["active", "grace"])
    .maybeSingle();
  if (!current) return null;
  const { data: revoked, error } = await admin
    .from("earned_premium_rewards")
    .update({ status: "revoked", revoked_at: now.toISOString(), revoke_reason: input.reason, updated_at: now.toISOString() })
    .eq("id", current.id)
    .in("status", ["active", "grace"])
    .select("id")
    .maybeSingle();
  if (error || !revoked) return null;
  await notify(admin, current.user_id, "revoked", current.reward_plan, current.id);
  return current;
}
