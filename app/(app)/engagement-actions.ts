"use server";

import { z } from "zod";
import {
  RECAP_REFLECTION_PROMPT,
  clampNotificationBudget,
  examModeEndsAtMs,
  isExamModeActive,
  pauseUntilMs,
  recapHeadline,
  sanitizeRecapSummary,
  type RecapSummary
} from "@/lib/engagement/rules";
import { LIFE_MILESTONES_FLAG, isFeatureEnabled } from "@/lib/features/feature-flags";
import { loadMilestoneViewsForUser, type MilestoneView } from "@/lib/life/milestone-service";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getSupabaseServerEnv } from "@/lib/supabase/env";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export type EngagementActionState = { ok: boolean; message: string; endsAt?: string };

export type EngagementSettings = {
  recapsEnabled: boolean;
  milestonesAvailable: boolean;
  milestonesEnabled: boolean;
  achievementsEnabled: boolean;
  milestoneRemindersEnabled: boolean;
  dailyNotificationBudget: number;
  examModeUntil: string | null;
  examModeActive: boolean;
  examModeAllowCloseFriends: boolean;
};

function missingEnvState(): EngagementActionState | null {
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

export async function getEngagementSettingsAction(): Promise<EngagementSettings> {
  const fallback: EngagementSettings = {
    recapsEnabled: true,
    milestonesAvailable: false,
    milestonesEnabled: true,
    achievementsEnabled: true,
    milestoneRemindersEnabled: true,
    dailyNotificationBudget: 8,
    examModeUntil: null,
    examModeActive: false,
    examModeAllowCloseFriends: true
  };

  const env = getSupabaseServerEnv();
  const userId = await getAuthedUserId();
  if (!env.url || !env.serviceRoleKey || !userId) return fallback;

  const admin = createSupabaseAdminClient();
  const [preferencesResult, milestonesAvailable] = await Promise.all([
    admin
      .from("engagement_preferences")
      .select("*")
      .eq("user_id", userId)
      .maybeSingle(),
    isFeatureEnabled(admin, LIFE_MILESTONES_FLAG)
  ]);
  const data = preferencesResult.data;
  if (!data) return { ...fallback, milestonesAvailable };

  const examUntilMs = data.exam_mode_until ? Date.parse(data.exam_mode_until) : null;
  return {
    recapsEnabled: data.recaps_enabled,
    milestonesAvailable,
    // Legacy DB column names are retained for rollout compatibility. The
    // product semantics are factual milestones, not streaks.
    milestonesEnabled: data.streaks_enabled,
    achievementsEnabled: data.achievements_enabled,
    milestoneRemindersEnabled: data.streak_notifications_enabled,
    dailyNotificationBudget: data.daily_notification_budget,
    examModeUntil: data.exam_mode_until,
    examModeActive: isExamModeActive(examUntilMs, Date.now()),
    examModeAllowCloseFriends: data.exam_mode_allow_close_friends
  };
}

const settingsSchema = z.object({
  recapsEnabled: z.boolean(),
  milestonesEnabled: z.boolean(),
  achievementsEnabled: z.boolean(),
  milestoneRemindersEnabled: z.boolean(),
  dailyNotificationBudget: z.number().int()
});

/**
 * Every engagement feature is switchable off (spec §41). Nothing here is
 * mandatory, and the notification budget is clamped so a client can only ever
 * request a STRICTER limit than the default (spec §45).
 */
export async function updateEngagementSettingsAction(input: unknown): Promise<EngagementActionState> {
  const missing = missingEnvState();
  if (missing) return missing;

  const parsed = settingsSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Check your settings and try again." };

  const userId = await getAuthedUserId();
  if (!userId) return { ok: false, message: "Log in first." };

  const admin = createSupabaseAdminClient();
  const { error } = await admin.from("engagement_preferences").upsert(
    {
      user_id: userId,
      recaps_enabled: parsed.data.recapsEnabled,
      streaks_enabled: parsed.data.milestonesEnabled,
      achievements_enabled: parsed.data.achievementsEnabled,
      streak_notifications_enabled: parsed.data.milestoneRemindersEnabled,
      daily_notification_budget: clampNotificationBudget(parsed.data.dailyNotificationBudget),
      updated_at: new Date().toISOString()
    },
    { onConflict: "user_id" }
  );
  if (error) return { ok: false, message: "Couldn't save your settings." };
  return { ok: true, message: "Settings saved." };
}

// ---------------------------------------------------------------------------
// Engagement overview: achievements, factual milestones, latest recap
// ---------------------------------------------------------------------------

export type EngagementOverview = {
  achievements: Array<{
    code: string;
    name: string;
    description: string;
    category: string;
    earned: boolean;
    earnedAt: string | null;
  }>;
  milestonesAvailable: boolean;
  milestonesEnabled: boolean;
  milestones: MilestoneView[];
  recap: {
    periodLabel: string;
    headline: string;
    summary: RecapSummary;
    reflectionPrompt: string;
  } | null;
};

/** Everything here is the viewer's own private data, never anyone else's. */
export async function getEngagementOverviewAction(): Promise<EngagementOverview> {
  const empty: EngagementOverview = {
    achievements: [],
    milestonesAvailable: false,
    milestonesEnabled: false,
    milestones: [],
    recap: null
  };
  const env = getSupabaseServerEnv();
  const userId = await getAuthedUserId();
  if (!env.url || !env.serviceRoleKey || !userId) return empty;

  const admin = createSupabaseAdminClient();
  const [definitionsRes, earnedRes, friendshipsRes, recapRes, preferencesRes, milestonesAvailable] = await Promise.all([
    admin
      .from("achievement_definitions")
      .select("code, name, description, category")
      .eq("is_active", true)
      .order("category"),
    admin.from("user_achievements").select("achievement_code, earned_at").eq("user_id", userId),
    admin
      .from("friendships")
      .select("id, user_one_id, user_two_id, created_at")
      .or(`user_one_id.eq.${userId},user_two_id.eq.${userId}`)
      .is("ended_at", null),
    admin
      .from("friendship_recaps")
      .select("period_start, summary_data")
      .eq("user_id", userId)
      .eq("period_type", "monthly")
      .eq("status", "ready")
      .order("period_start", { ascending: false })
      .limit(1)
      .maybeSingle(),
    admin
      .from("engagement_preferences")
      .select("streaks_enabled")
      .eq("user_id", userId)
      .maybeSingle(),
    isFeatureEnabled(admin, LIFE_MILESTONES_FLAG)
  ]);

  const earnedByCode = new Map((earnedRes.data ?? []).map((row) => [row.achievement_code, row.earned_at]));
  const achievements = (definitionsRes.data ?? []).map((definition) => ({
    code: definition.code,
    name: definition.name,
    description: definition.description,
    category: definition.category,
    earned: earnedByCode.has(definition.code),
    earnedAt: earnedByCode.get(definition.code) ?? null
  }));

  const friendships = friendshipsRes.data ?? [];
  const milestonesEnabled = milestonesAvailable && (preferencesRes.data?.streaks_enabled ?? true);
  const milestones = milestonesEnabled
    ? await loadMilestoneViewsForUser(admin, userId, friendships)
    : [];

  let recap: EngagementOverview["recap"] = null;
  if (recapRes.data) {
    const summary = sanitizeRecapSummary((recapRes.data.summary_data ?? {}) as Record<string, unknown>);
    recap = {
      periodLabel: new Date(recapRes.data.period_start).toLocaleDateString([], { month: "long", year: "numeric" }),
      headline: recapHeadline(summary),
      summary,
      reflectionPrompt: RECAP_REFLECTION_PROMPT
    };
  }

  return { achievements, milestonesAvailable, milestonesEnabled, milestones, recap };
}

/** Legacy compatibility for historical streak rows. New UI uses factual milestones. */
export async function pauseStreakAction(streakId: string, weeks: number): Promise<EngagementActionState> {
  const missing = missingEnvState();
  if (missing) return missing;
  if (!z.string().uuid().safeParse(streakId).success) return { ok: false, message: "Streak not found." };

  const userId = await getAuthedUserId();
  if (!userId) return { ok: false, message: "Log in first." };

  const admin = createSupabaseAdminClient();
  const { data: streak } = await admin
    .from("friendship_streaks")
    .select("id, friendship_id")
    .eq("id", streakId)
    .maybeSingle();
  if (!streak) return { ok: false, message: "Streak not found." };

  const { data: friendship } = await admin
    .from("friendships")
    .select("id")
    .eq("id", streak.friendship_id)
    .or(`user_one_id.eq.${userId},user_two_id.eq.${userId}`)
    // Active friendships only: ended_at IS NULL is the canonical definition of "currently Muddies".
    .is("ended_at", null).maybeSingle();
  if (!friendship) return { ok: false, message: "Streak not found." };

  const pausedUntil = new Date(pauseUntilMs(weeks, Date.now())).toISOString();
  const { error } = await admin
    .from("friendship_streaks")
    .update({ status: "paused", paused_until: pausedUntil, updated_at: new Date().toISOString() })
    .eq("id", streakId);
  if (error) return { ok: false, message: "Couldn't pause the streak." };
  return { ok: true, message: "Streak paused. It picks up where it left off." };
}

const examModeSchema = z.object({
  duration: z.enum(["2h", "until_tonight", "1w"]),
  allowCloseFriends: z.boolean().optional()
});

export async function startExamModeAction(input: unknown): Promise<EngagementActionState> {
  const missing = missingEnvState();
  if (missing) return missing;

  const parsed = examModeSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Choose how long." };

  const userId = await getAuthedUserId();
  if (!userId) return { ok: false, message: "Log in first." };

  const endsAtMs = examModeEndsAtMs(parsed.data.duration, Date.now());
  const admin = createSupabaseAdminClient();
  const { error } = await admin.from("engagement_preferences").upsert(
    {
      user_id: userId,
      exam_mode_until: new Date(endsAtMs).toISOString(),
      exam_mode_allow_close_friends: parsed.data.allowCloseFriends ?? true,
      updated_at: new Date().toISOString()
    },
    { onConflict: "user_id" }
  );
  if (error) return { ok: false, message: "Couldn't start Focus Mode." };

  return {
    ok: true,
    endsAt: new Date(endsAtMs).toISOString(),
    message: `Focus Mode is on until ${new Date(endsAtMs).toLocaleString([], {
      weekday: "short",
      hour: "numeric",
      minute: "2-digit"
    })}.`
  };
}

export async function endExamModeAction(): Promise<EngagementActionState> {
  const missing = missingEnvState();
  if (missing) return missing;

  const userId = await getAuthedUserId();
  if (!userId) return { ok: false, message: "Log in first." };

  const admin = createSupabaseAdminClient();
  const { error } = await admin
    .from("engagement_preferences")
    .upsert(
      { user_id: userId, exam_mode_until: null, updated_at: new Date().toISOString() },
      { onConflict: "user_id" }
    );
  if (error) return { ok: false, message: "Couldn't end Focus Mode." };
  return { ok: true, message: "Focus Mode is off." };
}
