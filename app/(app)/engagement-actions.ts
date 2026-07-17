"use server";

import { z } from "zod";
import {
  clampNotificationBudget,
  examModeEndsAtMs,
  isExamModeActive
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
