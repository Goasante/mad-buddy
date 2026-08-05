import "server-only";

import type { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { finalizeOnboarding } from "@/lib/onboarding/finalize";
import { decideOnboardingRecovery, type RecoveryDecision } from "@/lib/onboarding/recovery";
import { logBackendEvent } from "@/lib/observability/logger";

type Admin = ReturnType<typeof createSupabaseAdminClient>;

/**
 * Finish provisioning for an account stranded by a failed completion write.
 *
 * Idempotent by construction: every write is an upsert keyed on user_id or a
 * flag set to the value it should already have, so running this twice is a
 * no-op. It never overwrites a completed onboarding (the decision returns
 * "none" for those) and never invents profile content — it only writes the
 * provisioning rows the user already earned by completing the form.
 *
 * Returns the decision so callers can log or branch without re-deriving it.
 */
export async function recoverOnboardingIfStranded(
  admin: Admin,
  userId: string
): Promise<RecoveryDecision> {
  const [{ data: profile }, { data: progress }] = await Promise.all([
    admin
      .from("profiles")
      .select("is_onboarded, username, full_name, bio, mood_status")
      .eq("user_id", userId)
      .maybeSingle(),
    admin
      .from("onboarding_progress")
      .select("user_id, completed_at")
      .eq("user_id", userId)
      .maybeSingle()
  ]);

  const decision = decideOnboardingRecovery(
    profile ?? null,
    progress ? { exists: true, completedAt: progress.completed_at } : null
  );

  if (decision.action !== "finish") return decision;

  // Recovery provisions through the SAME canonical primitive as every normal
  // completion path, so a recovered account is byte-for-byte identical to one
  // that completed onboarding conventionally — same rows, same safe privacy
  // default, same idempotence.
  const finalized = await finalizeOnboarding(admin, userId);
  if (!finalized.ok) {
    // finalizeOnboarding never rolls the flag back, so the account is left
    // exactly as it was and the next visit simply retries this recovery.
    return { action: "none", reason: "recovery write failed; will retry on next visit" };
  }

  logBackendEvent("info", { action: "onboarding.recovery", statusCode: 200, userId });
  return decision;
}
