"use server";

import { z } from "zod";
import {
  canAdvanceTo,
  canCompleteOnboarding,
  isActivated,
  recommendNextAction,
  resumeStep,
  type Milestone,
  type NextAction,
  type OnboardingStep
} from "@/lib/onboarding/rules";
import { recordMilestone } from "@/lib/onboarding/service";
import { savePrivacySetup } from "@/lib/onboarding/complete";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getSupabaseServerEnv } from "@/lib/supabase/env";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { Database, OnboardingStepName, PermissionResult } from "@/lib/supabase/database.types";

export type OnboardingActionState = { ok: boolean; message: string };

export type OnboardingSnapshot = {
  currentStep: OnboardingStep;
  resumeAt: OnboardingStep;
  profileCompleted: boolean;
  privacyReviewed: boolean;
  visibilityConfigured: boolean;
  firstMuddyAdded: boolean;
  canComplete: boolean;
  activated: boolean;
  nextAction: NextAction;
};

type Admin = ReturnType<typeof createSupabaseAdminClient>;

function missingEnvState(): OnboardingActionState | null {
  const env = getSupabaseServerEnv();
  if (!env.url || !env.serviceRoleKey) {
    return { ok: false, message: "This action needs the server database configuration." };
  }
  return null;
}

async function getAuthedUserId() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
    error
  } = await supabase.auth.getUser();
  return error || !user ? null : user.id;
}

async function loadProgress(admin: Admin, userId: string) {
  const { data } = await admin
    .from("onboarding_progress")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();
  if (data) return data;

  const { data: created } = await admin
    .from("onboarding_progress")
    .insert({ user_id: userId, current_step: "not_started" })
    .select("*")
    .single();
  return created ?? null;
}

async function loadMilestones(admin: Admin, userId: string): Promise<Set<Milestone>> {
  const { data } = await admin.from("activation_milestones").select("milestone").eq("user_id", userId);
  return new Set((data ?? []).map((row) => row.milestone as Milestone));
}

export async function getOnboardingAction(): Promise<OnboardingSnapshot | null> {
  const env = getSupabaseServerEnv();
  if (!env.url || !env.serviceRoleKey) return null;
  const userId = await getAuthedUserId();
  if (!userId) return null;

  const admin = createSupabaseAdminClient();
  const [progress, milestones, friendCount] = await Promise.all([
    loadProgress(admin, userId),
    loadMilestones(admin, userId),
    countFriends(admin, userId)
  ]);
  if (!progress) return null;

  const state = {
    currentStep: progress.current_step as OnboardingStep,
    profileCompleted: Boolean(progress.profile_completed_at),
    privacyReviewed: Boolean(progress.privacy_reviewed_at),
    visibilityConfigured: Boolean(progress.visibility_configured_at),
    firstMuddyAdded: Boolean(progress.first_muddy_added_at) || friendCount > 0
  };

  const { data: pending } = await admin
    .from("friend_requests")
    .select("id")
    .eq("sender_id", userId)
    .eq("status", "pending")
    .limit(1);

  return {
    ...state,
    resumeAt: resumeStep(state),
    canComplete: canCompleteOnboarding(state),
    activated: isActivated(milestones),
    nextAction: recommendNextAction({
      hasFirstMuddy: state.firstMuddyAdded,
      milestones,
      hasPendingRequest: Boolean(pending?.length)
    })
  };
}

async function countFriends(admin: Admin, userId: string): Promise<number> {
  const { count } = await admin
    .from("friendships")
    .select("id", { count: "exact", head: true })
    .or(`user_one_id.eq.${userId},user_two_id.eq.${userId}`);
  return count ?? 0;
}

const stepSchema = z.enum([
  "not_started",
  "profile_started",
  "profile_completed",
  "privacy_reviewed",
  "visibility_configured",
  "location_prompted",
  "first_muddy_added",
  "activated",
  "completed"
]);

/**
 * Advances a step. Progress only moves forward (spec §24), a replayed or
 * out-of-order client event can never rewind someone's onboarding.
 */
export async function completeOnboardingStepAction(step: string): Promise<OnboardingActionState> {
  const missing = missingEnvState();
  if (missing) return missing;

  const parsed = stepSchema.safeParse(step);
  if (!parsed.success) return { ok: false, message: "Unknown step." };

  const userId = await getAuthedUserId();
  if (!userId) return { ok: false, message: "Log in first." };

  const admin = createSupabaseAdminClient();
  const progress = await loadProgress(admin, userId);
  if (!progress) return { ok: false, message: "Couldn't load your progress." };

  const current = progress.current_step as OnboardingStep;
  const next = parsed.data as OnboardingStep;

  const nowIso = new Date().toISOString();
  const update: Database["public"]["Tables"]["onboarding_progress"]["Update"] = { updated_at: nowIso };
  if (canAdvanceTo(current, next)) update.current_step = next;

  // Timestamps are set independently of current_step so an out-of-order
  // completion still records the fact it happened.
  if (next === "profile_completed" && !progress.profile_completed_at) update.profile_completed_at = nowIso;
  if (next === "privacy_reviewed" && !progress.privacy_reviewed_at) update.privacy_reviewed_at = nowIso;
  if (next === "visibility_configured" && !progress.visibility_configured_at) {
    update.visibility_configured_at = nowIso;
  }
  if (next === "location_prompted" && !progress.location_prompted_at) update.location_prompted_at = nowIso;
  if (next === "first_muddy_added" && !progress.first_muddy_added_at) update.first_muddy_added_at = nowIso;

  await admin.from("onboarding_progress").update(update).eq("user_id", userId);

  if (next === "profile_completed") await recordMilestone(admin, userId, "profile_completed");
  if (next === "first_muddy_added") await recordMilestone(admin, userId, "first_muddy_added");

  return { ok: true, message: "Progress saved." };
}

/** Records the outcome of the browser prompt. UX signal only (spec §48). */
export async function recordPermissionResultAction(result: string): Promise<OnboardingActionState> {
  const missing = missingEnvState();
  if (missing) return missing;

  const parsed = z
    .enum([
      "not_requested",
      "pre_prompt_viewed",
      "granted",
      "granted_approximate",
      "denied",
      "denied_permanently",
      "revoked",
      "unsupported",
      "error"
    ])
    .safeParse(result);
  if (!parsed.success) return { ok: false, message: "Unknown permission result." };

  const userId = await getAuthedUserId();
  if (!userId) return { ok: false, message: "Log in first." };

  const admin = createSupabaseAdminClient();
  await loadProgress(admin, userId);
  await admin
    .from("onboarding_progress")
    .update({
      location_permission_result: parsed.data as PermissionResult,
      location_prompted_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    })
    .eq("user_id", userId);

  return { ok: true, message: "Saved." };
}

/**
 * Completes onboarding. The server re-validates the required steps rather than
 * trusting the client's "done" (spec §26).
 */
export async function completeOnboardingV2Action(): Promise<OnboardingActionState> {
  const missing = missingEnvState();
  if (missing) return missing;

  const userId = await getAuthedUserId();
  if (!userId) return { ok: false, message: "Log in first." };

  const admin = createSupabaseAdminClient();
  const progress = await loadProgress(admin, userId);
  if (!progress) return { ok: false, message: "Couldn't load your progress." };

  const state = {
    currentStep: progress.current_step as OnboardingStep,
    profileCompleted: Boolean(progress.profile_completed_at),
    privacyReviewed: Boolean(progress.privacy_reviewed_at),
    visibilityConfigured: Boolean(progress.visibility_configured_at),
    firstMuddyAdded: Boolean(progress.first_muddy_added_at)
  };

  if (!canCompleteOnboarding(state)) {
    return { ok: false, message: "Finish your profile and privacy setup first." };
  }

  const nowIso = new Date().toISOString();
  await Promise.all([
    admin
      .from("onboarding_progress")
      .update({ current_step: "completed" as OnboardingStepName, completed_at: nowIso, updated_at: nowIso })
      .eq("user_id", userId),
    // Keep the legacy convenience flag in sync.
    admin.from("profiles").update({ is_onboarded: true }).eq("user_id", userId)
  ]);

  return { ok: true, message: "You're all set." };
}

// ---------------------------------------------------------------------------
// Privacy setup (spec §32, §36)
// ---------------------------------------------------------------------------

export async function savePrivacySetupAction(input: unknown): Promise<OnboardingActionState> {
  const userId = await getAuthedUserId();
  if (!userId) return { ok: false, message: "Log in first." };

  return savePrivacySetup(userId, input);
}
