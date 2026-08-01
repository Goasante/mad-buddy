"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAdminPermission } from "@/lib/admin/access";
import { recordAdminAuditEvent } from "@/lib/admin/service";
import { BUDDY_SCORE_RULE_VERSION } from "@/lib/engagement/buddy-score";
import { reconcileBuddyScore, reconcileBuddyScoreTotal } from "@/lib/engagement/buddy-score-service";
import { revokeEarnedReward } from "@/lib/rewards/earned-premium-service";
import { getSafetyAdminContext } from "@/lib/safety/admin";
import { consumeRateLimit, rateLimitMessage } from "@/lib/security/rate-limit";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export type BuddyScoreAdminState = { ok: boolean; message: string };
const schema = z.object({
  userId: z.string().uuid(),
  points: z.coerce.number().int().min(-500).max(200).refine((value) => value !== 0),
  reason: z.string().trim().min(8).max(300)
});

export async function correctBuddyScoreAction(_state: BuddyScoreAdminState, formData: FormData): Promise<BuddyScoreAdminState> {
  const parsed = schema.safeParse({ userId: formData.get("userId"), points: formData.get("points"), reason: formData.get("reason") });
  if (!parsed.success) return { ok: false, message: "Enter a user ID, a non-zero correction, and a clear reason." };
  const context = await getSafetyAdminContext();
  if (!context.ok) return { ok: false, message: "Admin authentication is required." };
  const admin = createSupabaseAdminClient();
  try { await requireAdminPermission(admin, context, "admin.buddy_score.manage"); } catch { return { ok: false, message: "You do not have permission to adjust Buddy Score." }; }
  const limited = await consumeRateLimit({ action: "admin.mutate", userId: context.userId });
  if (!limited.allowed) return { ok: false, message: rateLimitMessage(limited.resetAt) };
  await reconcileBuddyScore(admin, parsed.data.userId);
  const before = await reconcileBuddyScoreTotal(admin, parsed.data.userId);
  if (!before.reconciled) return { ok: false, message: "The score needs reconciliation before a correction can be added." };
  const sourceReference = `admin:${crypto.randomUUID()}`;
  const audited = await recordAdminAuditEvent(admin, {
    actorId: context.userId,
    action: "buddy_score_correction",
    targetType: "user",
    targetId: parsed.data.userId,
    reason: parsed.data.reason,
    previousState: { score: before.ledgerTotal },
    newState: { delta: parsed.data.points, ruleVersion: BUDDY_SCORE_RULE_VERSION, sourceReference }
  });
  if (!audited) return { ok: false, message: "The audit entry could not be recorded, so no points were changed." };
  const { error } = await admin.from("buddy_score_ledger").insert({
    user_id: parsed.data.userId,
    event_type: "admin_correction",
    points_delta: parsed.data.points,
    source_reference: sourceReference,
    rule_version: BUDDY_SCORE_RULE_VERSION,
    metadata: { category: "Corrections", reason_code: "admin_review" }
  });
  if (error) return { ok: false, message: "The correction could not be added." };
  revalidatePath("/admin/buddy-score");
  revalidatePath("/buddy-score");
  return { ok: true, message: "Score correction recorded." };
}

const revokeRewardSchema = z.object({
  rewardId: z.string().uuid(),
  reason: z.string().trim().min(8).max(300)
});

export async function revokeEarnedRewardAction(_state: BuddyScoreAdminState, formData: FormData): Promise<BuddyScoreAdminState> {
  const parsed = revokeRewardSchema.safeParse({ rewardId: formData.get("rewardId"), reason: formData.get("reason") });
  if (!parsed.success) return { ok: false, message: "Add a clear reason before revoking earned access." };
  const context = await getSafetyAdminContext();
  if (!context.ok) return { ok: false, message: "Admin authentication is required." };
  const admin = createSupabaseAdminClient();
  try { await requireAdminPermission(admin, context, "admin.buddy_score.manage"); } catch { return { ok: false, message: "You do not have permission to revoke earned access." }; }
  const limited = await consumeRateLimit({ action: "admin.mutate", userId: context.userId });
  if (!limited.allowed) return { ok: false, message: rateLimitMessage(limited.resetAt) };

  const { data: reward } = await admin
    .from("earned_premium_rewards")
    .select("id,user_id,reward_plan,source_score_snapshot,status,expires_at,grace_ends_at")
    .eq("id", parsed.data.rewardId)
    .in("status", ["active", "grace"])
    .maybeSingle();
  if (!reward) return { ok: false, message: "This earned reward is no longer active." };
  const audited = await recordAdminAuditEvent(admin, {
    actorId: context.userId,
    action: "earned_premium_reward_revocation_requested",
    targetType: "earned_premium_reward",
    targetId: reward.id,
    reason: parsed.data.reason,
    previousState: { userId: reward.user_id, plan: reward.reward_plan, scoreSnapshot: reward.source_score_snapshot, status: reward.status, expiresAt: reward.expires_at, graceEndsAt: reward.grace_ends_at },
    newState: { status: "revoked" }
  });
  if (!audited) return { ok: false, message: "The audit entry failed, so earned access was not revoked." };
  const revoked = await revokeEarnedReward(admin, { rewardId: reward.id, reason: parsed.data.reason });
  if (!revoked) return { ok: false, message: "Earned access changed before the revocation could be completed." };
  revalidatePath("/admin/buddy-score");
  revalidatePath("/buddy-score");
  return { ok: true, message: "Earned access revoked and recorded." };
}
