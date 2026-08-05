import "server-only";

import type { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { CURRENT_POLICY_VERSION, SAFE_DEFAULT_PRIVACY_SETUP } from "@/lib/onboarding/rules";
import { logBackendEvent } from "@/lib/observability/logger";

type Admin = ReturnType<typeof createSupabaseAdminClient>;

/**
 * THE canonical onboarding completion primitive.
 *
 * Every entry point that finishes onboarding calls this and nothing else:
 *
 *   - app/(onboarding)/onboarding/actions.ts  (web)
 *   - app/api/onboarding/complete/route.ts    (native)
 *   - app/(app)/onboarding-actions.ts         (step-based V2)
 *   - lib/onboarding/recovery-service.ts      (stranded-account repair)
 *
 * They previously each wrote their own subset of the completion rows, which
 * diverged: the native route never wrote progress, privacy or is_onboarded at
 * all, so a native user who finished onboarding stayed stranded forever.
 *
 * Idempotent by construction. Every write is an upsert keyed on user_id or a
 * flag set to the value it should already hold, so running it twice — or
 * concurrently from two entry points — cannot duplicate a row.
 *
 * RECOVERABLE, never destructive. If a write fails it does NOT roll
 * `is_onboarded` back: that rollback is exactly what stranded real accounts in
 * Stage 2. The user's saved profile is preserved and the next visit retries.
 */
export type FinalizeResult =
  | { ok: true }
  | { ok: false; failed: "progress" | "profile" | "privacy"; recoverable: true };

export async function finalizeOnboarding(
  admin: Admin,
  userId: string,
  options: { skippedOptional?: boolean } = {}
): Promise<FinalizeResult> {
  const nowIso = new Date().toISOString();

  const [progressResult, profileResult, privacyResult] = await Promise.all([
    admin.from("onboarding_progress").upsert(
      {
        user_id: userId,
        current_step: "completed",
        profile_completed_at: nowIso,
        privacy_reviewed_at: nowIso,
        visibility_configured_at: nowIso,
        completed_at: nowIso,
        ...(options.skippedOptional === undefined ? {} : { skipped_optional: options.skippedOptional }),
        updated_at: nowIso
      },
      { onConflict: "user_id" }
    ),
    admin
      .from("profiles")
      .update({
        is_onboarded: true,
        // The product rule: every new account starts hidden unless the safe
        // default says otherwise. Applied identically at every entry point, so
        // no path can produce a more visible account than another.
        visibility_status: SAFE_DEFAULT_PRIVACY_SETUP.glowAudience === "hidden" ? "ghost" : "visible"
      })
      .eq("user_id", userId),
    admin.from("privacy_setup_versions").upsert(
      {
        user_id: userId,
        policy_version: CURRENT_POLICY_VERSION,
        setup_completed_at: nowIso,
        last_reviewed_at: nowIso,
        updated_at: nowIso
      },
      { onConflict: "user_id" }
    )
  ]);

  const failures: Array<{ label: "progress" | "profile" | "privacy"; error: unknown }> = [
    { label: "progress", error: progressResult.error },
    { label: "profile", error: profileResult.error },
    { label: "privacy", error: privacyResult.error }
  ];

  const failed = failures.find((entry) => entry.error);
  if (!failed) return { ok: true };

  logBackendEvent("error", {
    action: "onboarding.finalize",
    statusCode: 500,
    userId,
    errorType: `finalize_${failed.label}_failed`
  });

  return { ok: false, failed: failed.label, recoverable: true };
}

/**
 * The one message shown when finalization fails.
 *
 * Says what is true: the profile is safe, and reopening the app resumes —
 * lib/onboarding/recovery-service finishes provisioning automatically for an
 * account whose data shows it already completed the form.
 */
export const FINALIZE_RECOVERABLE_MESSAGE =
  "Your profile was saved, but setup could not finish. Reopen the app to continue.";
