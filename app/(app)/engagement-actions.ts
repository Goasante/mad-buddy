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
  streakSummaryLabel,
  type RecapSummary
} from "@/lib/engagement/rules";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getSupabaseServerEnv } from "@/lib/supabase/env";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export type EngagementActionState = { ok: boolean; message: string };

export type EngagementSettings = {
  recapsEnabled: boolean;
  streaksEnabled: boolean;
  achievementsEnabled: boolean;
  streakNotificationsEnabled: boolean;
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
    streaksEnabled: true,
    achievementsEnabled: true,
    streakNotificationsEnabled: true,
    dailyNotificationBudget: 8,
    examModeUntil: null,
    examModeActive: false,
    examModeAllowCloseFriends: true
  };

  const env = getSupabaseServerEnv();
  const userId = await getAuthedUserId();
  if (!env.url || !env.serviceRoleKey || !userId) return fallback;

  const admin = createSupabaseAdminClient();
  const { data } = await admin
    .from("engagement_preferences")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();
  if (!data) return fallback;

  const examUntilMs = data.exam_mode_until ? Date.parse(data.exam_mode_until) : null;
  return {
    recapsEnabled: data.recaps_enabled,
    streaksEnabled: data.streaks_enabled,
    achievementsEnabled: data.achievements_enabled,
    streakNotificationsEnabled: data.streak_notifications_enabled,
    dailyNotificationBudget: data.daily_notification_budget,
    examModeUntil: data.exam_mode_until,
    examModeActive: isExamModeActive(examUntilMs, Date.now()),
    examModeAllowCloseFriends: data.exam_mode_allow_close_friends
  };
}

const settingsSchema = z.object({
  recapsEnabled: z.boolean(),
  streaksEnabled: z.boolean(),
  achievementsEnabled: z.boolean(),
  streakNotificationsEnabled: z.boolean(),
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
      streaks_enabled: parsed.data.streaksEnabled,
      achievements_enabled: parsed.data.achievementsEnabled,
      streak_notifications_enabled: parsed.data.streakNotificationsEnabled,
      daily_notification_budget: clampNotificationBudget(parsed.data.dailyNotificationBudget),
      updated_at: new Date().toISOString()
    },
    { onConflict: "user_id" }
  );
  if (error) return { ok: false, message: "Couldn't save your settings." };
  return { ok: true, message: "Settings saved." };
}

// ---------------------------------------------------------------------------
// Engagement overview: achievements, streaks, latest recap (spec §26, §29)
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
  streaks: Array<{
    streakId: string;
    label: string;
    currentWeeks: number;
    longestWeeks: number;
    status: string;
    pausedUntil: string | null;
  }>;
  recap: {
    periodLabel: string;
    headline: string;
    summary: RecapSummary;
    reflectionPrompt: string;
  } | null;
};

/** Everything here is the viewer's own private data — never anyone else's. */
export async function getEngagementOverviewAction(): Promise<EngagementOverview> {
  const empty: EngagementOverview = { achievements: [], streaks: [], recap: null };
  const env = getSupabaseServerEnv();
  const userId = await getAuthedUserId();
  if (!env.url || !env.serviceRoleKey || !userId) return empty;

  const admin = createSupabaseAdminClient();
  const [definitionsRes, earnedRes, friendshipsRes, recapRes] = await Promise.all([
    admin
      .from("achievement_definitions")
      .select("code, name, description, category")
      .eq("is_active", true)
      .order("category"),
    admin.from("user_achievements").select("achievement_code, earned_at").eq("user_id", userId),
    admin
      .from("friendships")
      .select("id, user_one_id, user_two_id")
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
      .maybeSingle()
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
  let streaks: EngagementOverview["streaks"] = [];
  if (friendships.length > 0) {
    const friendByFriendship = new Map(
      friendships.map((row) => [row.id, row.user_one_id === userId ? row.user_two_id : row.user_one_id])
    );
    const { data: streakRows } = await admin
      .from("friendship_streaks")
      .select("id, friendship_id, current_weeks, longest_weeks, status, paused_until")
      .in(
        "friendship_id",
        friendships.map((row) => row.id)
      )
      .gt("current_weeks", 0);

    const friendIds = [...new Set((streakRows ?? []).map((row) => friendByFriendship.get(row.friendship_id)))].filter(
      (id): id is string => Boolean(id)
    );
    const { data: profiles } = friendIds.length
      ? await admin.from("profiles").select("user_id, full_name").in("user_id", friendIds)
      : { data: [] };
    const nameById = new Map((profiles ?? []).map((row) => [row.user_id, row.full_name]));

    streaks = (streakRows ?? []).map((row) => {
      const friendId = friendByFriendship.get(row.friendship_id);
      const friendName = (friendId && nameById.get(friendId)?.trim()) || "A Muddy";
      return {
        streakId: row.id,
        label: streakSummaryLabel(row.current_weeks, friendName),
        currentWeeks: row.current_weeks,
        longestWeeks: row.longest_weeks,
        status: row.status,
        pausedUntil: row.paused_until
      };
    });
  }

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

  return { achievements, streaks, recap };
}

/** Pausing is free for everyone — spec §18 forbids monetising streaks. */
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
    .maybeSingle();
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
  if (error) return { ok: false, message: "Couldn't start Exam Mode." };

  return {
    ok: true,
    message: `Exam Mode is on until ${new Date(endsAtMs).toLocaleString([], {
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
  if (error) return { ok: false, message: "Couldn't end Exam Mode." };
  return { ok: true, message: "Exam Mode is off." };
}
