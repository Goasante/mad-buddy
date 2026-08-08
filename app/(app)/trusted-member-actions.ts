"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { loadJourney } from "@/lib/journey/journey-service";
import { consumeRateLimit, rateLimitMessage } from "@/lib/security/rate-limit";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getSupabaseServerEnv } from "@/lib/supabase/env";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  canApplyForTrustedMember,
  premiumDaysSince,
  trustedMemberEligibility,
  type TrustedMemberStatus
} from "@/lib/trust/trusted-member";

/**
 * Applying to be a Trusted Member.
 *
 * The badge is APPLIED FOR, never granted automatically. Meeting the bar —
 * long premium tenure plus every journey — earns the right to ask; a human
 * still decides. That gap is what keeps it a mark of standing rather than
 * something a subscription buys.
 *
 * Eligibility is recomputed HERE at submit time rather than trusted from the
 * client. A page rendered an hour ago may have shown an Apply button that is
 * no longer honest.
 */

type ActionState = { ok: boolean; message: string };

const applySchema = z.object({
  note: z.string().trim().max(500).optional()
});

async function getAuthedUserId(): Promise<string | null> {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
    error
  } = await supabase.auth.getUser();
  return error || !user ? null : user.id;
}

function serverReady(): boolean {
  const env = getSupabaseServerEnv();
  return Boolean(env.url && env.serviceRoleKey);
}

/**
 * The viewer's own standing: what they have, what is missing, where they are
 * in the queue. Read-only, and only ever about themselves.
 */
export async function getTrustedMemberStandingAction(): Promise<{
  eligible: boolean;
  premiumDays: number;
  journeysComplete: number;
  missing: string[];
  status: TrustedMemberStatus | null;
  canApply: boolean;
} | null> {
  if (!serverReady()) return null;
  const userId = await getAuthedUserId();
  if (!userId) return null;

  const admin = createSupabaseAdminClient();
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
export async function applyForTrustedMemberAction(input: unknown): Promise<ActionState> {
  if (!serverReady()) {
    return { ok: false, message: "This action needs the server database configuration." };
  }

  const parsed = applySchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Keep your note under 500 characters." };

  const userId = await getAuthedUserId();
  if (!userId) return { ok: false, message: "Log in first." };

  const rateLimit = await consumeRateLimit({ action: "trusted_member.apply", userId });
  if (!rateLimit.allowed) return { ok: false, message: rateLimitMessage(rateLimit.resetAt) };

  const standing = await getTrustedMemberStandingAction();
  if (!standing) return { ok: false, message: "Couldn't check your eligibility. Try again." };

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
  const { error } = await createSupabaseAdminClient()
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

  revalidatePath("/profile");
  return { ok: true, message: "Application sent. We'll let you know." };
}
