import "server-only";

import { z } from "zod";

import { loadJourney } from "@/lib/journey/journey-service";
import { consumeRateLimit, rateLimitMessage } from "@/lib/security/rate-limit";
import type { createSupabaseAdminClient } from "@/lib/supabase/admin";
import {
  canApplyForTrustedMember,
  premiumDaysSince,
  trustedMemberEligibility,
  type TrustedMemberStatus
} from "@/lib/trust/trusted-member";

type Admin = ReturnType<typeof createSupabaseAdminClient>;

/**
 * Applying to be a Trusted Member, as a transport-agnostic service.
 *
 * Extracted from app/(app)/trusted-member-actions.ts so the native app can
 * reach the same behaviour through /api/trust/apply. The web Server Actions
 * and the route handlers both call this, so the eligibility recomputation and
 * the rate limit are one implementation rather than two that resemble each
 * other.
 *
 * The badge is APPLIED FOR, never granted automatically. Meeting the bar —
 * long premium tenure plus every journey — earns the right to ask; a human
 * still decides. That gap is what keeps it a mark of standing rather than
 * something a subscription buys.
 *
 * Authentication stays with the caller; this is handed the userId the caller
 * proved and reads only that person's own rows.
 */
export type TrustedMemberApplicationResult = { ok: boolean; message: string };

export type TrustedMemberStanding = {
  eligible: boolean;
  premiumDays: number;
  journeysComplete: number;
  missing: string[];
  status: TrustedMemberStatus | null;
  canApply: boolean;
};

const applySchema = z.object({
  note: z.string().trim().max(500).optional()
});

/**
 * The viewer's own standing: what they have, what is missing, where they are
 * in the queue. Read-only, and only ever about themselves.
 */
export async function getTrustedMemberStanding(
  admin: Admin,
  userId: string
): Promise<TrustedMemberStanding> {
  const [{ data: subscription }, { data: application }, journey] = await Promise.all([
    admin
      .from("subscriptions")
      .select("created_at, status")
      .eq("user_id", userId)
      .maybeSingle(),
    admin
      .from("trusted_member_applications")
      .select("status")
      .eq("user_id", userId)
      .maybeSingle(),
    loadJourney(admin, userId)
  ]);

  // Tenure counts only while the subscription is live. A lapsed one does not
  // keep accruing standing the person is no longer paying for.
  const premiumDays =
    subscription && subscription.status === "active"
      ? premiumDaysSince(subscription.created_at, Date.now())
      : 0;

  const eligibility = trustedMemberEligibility({
    premiumDays,
    journeysComplete: journey.completedCount
  });
  const status = (application?.status as TrustedMemberStatus | undefined) ?? null;

  return {
    ...eligibility,
    status,
    canApply: canApplyForTrustedMember({ eligible: eligibility.eligible, existingStatus: status })
  };
}

/**
 * Submit an application.
 *
 * Upserts on the unique (user_id) constraint so re-applying after a decline
 * updates the existing row rather than queueing a second. The queue is a
 * queue, not a way to ask louder.
 */
export async function applyForTrustedMember(
  admin: Admin,
  userId: string,
  input: unknown
): Promise<TrustedMemberApplicationResult> {
  const parsed = applySchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Keep your note under 500 characters." };

  const rateLimit = await consumeRateLimit({ action: "trusted_member.apply", userId });
  if (!rateLimit.allowed) return { ok: false, message: rateLimitMessage(rateLimit.resetAt) };

  const standing = await getTrustedMemberStanding(admin, userId);

  // Recomputed server-side: the page that offered the button may be stale.
  if (!standing.canApply) {
    if (standing.status === "pending") {
      return { ok: false, message: "Your application is already being reviewed." };
    }
    if (standing.status === "approved") {
      return { ok: false, message: "You're already a Trusted Member." };
    }
    return { ok: false, message: "You're not eligible to apply yet." };
  }

  const nowIso = new Date().toISOString();
  const { error } = await admin
    .from("trusted_member_applications")
    .upsert(
      {
        user_id: userId,
        status: "pending",
        note: parsed.data.note?.trim() || null,
        // Captured, not recomputed at review time: a reviewer weeks later
        // must see what this person qualified on, and an approval has to stay
        // explicable after the numbers have moved.
        premium_days_at_apply: standing.premiumDays,
        journeys_complete_at_apply: standing.journeysComplete,
        // A re-application clears the previous decision rather than carrying
        // a stale reviewer and note alongside a fresh request.
        reviewed_by: null,
        reviewed_at: null,
        review_note: null,
        updated_at: nowIso
      },
      { onConflict: "user_id" }
    );

  if (error) return { ok: false, message: "Couldn't send your application. Try again." };

  return { ok: true, message: "Application sent. We'll let you know." };
}
