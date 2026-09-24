"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { isAppealable, resolveAppealEligibility, type RestrictionType } from "@/lib/admin/governance";
import { consumeRateLimit, rateLimitMessage } from "@/lib/security/rate-limit";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { requireCurrentUserRecord } from "@/lib/supabase/auth";

const appealSchema = z.object({
  restrictionId: z.string().uuid(),
  reason: z.string().trim().min(10).max(2000)
});

export async function submitRestrictionAppealAction(input: unknown): Promise<{ ok: boolean; message: string }> {
  const parsed = appealSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Explain your appeal in at least 10 characters." };
  try {
    const user = await requireCurrentUserRecord();
    const limit = await consumeRateLimit({ action: "support.request", userId: user.id });
    if (!limit.allowed) return { ok: false, message: rateLimitMessage(limit.resetAt) };
    const admin = createSupabaseAdminClient();
    const [{ data: restriction }, { data: existing }] = await Promise.all([
      admin.from("user_restrictions").select("id, restriction_type, created_at").eq("id", parsed.data.restrictionId).eq("user_id", user.id).maybeSingle(),
      admin.from("appeals").select("id").eq("subject_user_id", user.id).eq("source_restriction_id", parsed.data.restrictionId).maybeSingle()
    ]);
    if (!restriction) return { ok: false, message: "That account action is unavailable." };
    const restrictionType = restriction.restriction_type as RestrictionType;
    if (!isAppealable(restrictionType)) return { ok: false, message: "That account action is not appealable." };
    const eligibility = resolveAppealEligibility({
      restriction: restrictionType,
      hasExistingAppeal: Boolean(existing),
      actionAtMs: Date.parse(restriction.created_at),
      nowMs: Date.now()
    });
    if (!eligibility.allowed) {
      return {
        ok: false,
        message: eligibility.reason === "already_appealed" ? "You already appealed this action." : "The appeal window has closed."
      };
    }
    const { error } = await admin.from("appeals").insert({
      subject_user_id: user.id,
      source_restriction_id: restriction.id,
      source_action_id: null,
      reason: parsed.data.reason
    });
    if (error) return { ok: false, message: "The appeal could not be submitted." };
    revalidatePath("/settings/account-status");
    revalidatePath("/admin/appeals");
    return { ok: true, message: "Appeal submitted for review." };
  } catch {
    return { ok: false, message: "Sign in again to continue." };
  }
}
