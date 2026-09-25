"use server";

import { z } from "zod";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { deleteAccountForUser } from "@/lib/account/deletion";
import { getSupabaseBrowserEnv, getSupabaseServerEnv } from "@/lib/supabase/env";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { consumeRateLimit, rateLimitMessage } from "@/lib/security/rate-limit";
import { updateNotificationPreference, updateVisibilityStatus } from "@/lib/settings/service";

export type SettingsActionState = {
  ok: boolean;
  message: string;
};

const deleteAccountSchema = z.object({
  confirmed: z.literal(true),
  reason: z.string().trim().max(240).optional()
});

const appPreferencesSchema = z.object({
  language: z.enum(["English (US)", "English (UK)", "Twi", "French"]),
  region: z.enum(["Ghana (GH)", "Nigeria (NG)", "United States (US)", "United Kingdom (UK)"]),
  timeZone: z.enum(["Africa/Accra", "Africa/Lagos", "America/New_York", "Europe/London"]),
  dateFormat: z.enum(["DD MMM YYYY", "MM/DD/YYYY", "DD/MM/YYYY"]),
  timeFormat: z.enum(["12h", "24h"])
});

const feedbackSchema = z.object({
  category: z.enum(["feedback", "suggestion"]),
  rating: z.number().int().min(1).max(5).nullable(),
  message: z.string().trim().max(500)
}).refine((value) => value.rating !== null || value.message.length >= 3);

function missingSupabaseState(): SettingsActionState | null {
  const browserEnv = getSupabaseBrowserEnv();
  const serverEnv = getSupabaseServerEnv();

  if (!browserEnv.url || !browserEnv.anonKey || !serverEnv.serviceRoleKey) {
    return {
      ok: false,
      message: "Supabase URL, publishable key, and service role key are required for account deletion."
    };
  }

  return null;
}

async function getAuthedUser() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
    error
  } = await supabase.auth.getUser();

  if (error || !user) {
    return null;
  }

  return user;
}

export async function deleteAccountAction(input: unknown): Promise<SettingsActionState> {
  const missingEnv = missingSupabaseState();
  if (missingEnv) return missingEnv;

  const parsed = deleteAccountSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Confirm deletion before deleting your account." };

  const user = await getAuthedUser();
  if (!user) return { ok: false, message: "Log in before deleting your account." };

  const rateLimit = await consumeRateLimit({ action: "account.delete", userId: user.id });
  if (!rateLimit.allowed) return { ok: false, message: rateLimitMessage(rateLimit.resetAt) };

  const outcome = await deleteAccountForUser(
    createSupabaseAdminClient(), user.id, parsed.data.reason || null
  );
  if (!outcome.ok) return { ok: false, message: outcome.message };

  // Auth deletion invalidates refresh tokens; local sign-out also removes the
  // SSR session cookie so the browser cannot reopen the app with a stale JWT.
  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut({ scope: "local" });
  return { ok: true, message: "Your account has been deleted." };
}

export async function updateVisibilityStatusAction(input: unknown): Promise<SettingsActionState> {
  const user = await getAuthedUser();

  if (!user) {
    return { ok: false, message: "Log in before changing privacy settings." };
  }

  const supabase = await createSupabaseServerClient();
  return updateVisibilityStatus(supabase, user.id, input);
}

export async function updateNotificationPreferenceAction(input: unknown): Promise<SettingsActionState> {
  const user = await getAuthedUser();

  if (!user) {
    return { ok: false, message: "Log in before changing notification settings." };
  }

  return updateNotificationPreference(user.id, input);
}

export async function updateAppPreferencesAction(input: unknown): Promise<SettingsActionState> {
  const parsed = appPreferencesSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Check your preferences and try again." };
  const user = await getAuthedUser();
  if (!user) return { ok: false, message: "Log in before saving preferences." };
  const admin = createSupabaseAdminClient();
  const { error } = await admin.from("user_preferences").upsert(
    { user_id: user.id, app_preferences: parsed.data },
    { onConflict: "user_id" }
  );
  return error ? { ok: false, message: "Couldn't save your preferences." } : { ok: true, message: "Preferences saved." };
}

export async function submitAppFeedbackAction(input: unknown): Promise<SettingsActionState> {
  const parsed = feedbackSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Add a rating or at least three characters." };
  const user = await getAuthedUser();
  if (!user) return { ok: false, message: "Log in before sending feedback." };
  const { consumeRateLimit, rateLimitMessage } = await import("@/lib/security/rate-limit");
  const limit = await consumeRateLimit({ action: "feedback.submit", userId: user.id });
  if (!limit.allowed) return { ok: false, message: rateLimitMessage(limit.resetAt) };
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.from("app_feedback").insert({
    user_id: user.id,
    category: parsed.data.category,
    rating: parsed.data.category === "feedback" ? parsed.data.rating : null,
    message: parsed.data.message
  });
  return error ? { ok: false, message: "Couldn't send your feedback. Try again." } : { ok: true, message: "Thanks, your feedback was sent." };
}

export async function revokeOtherSessionsAction(): Promise<SettingsActionState> {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, message: "Log in before managing sessions." };
  const claimsResult = typeof supabase.auth.getClaims === "function" ? await supabase.auth.getClaims() : null;
  const currentSessionId =
    claimsResult?.data?.claims && typeof claimsResult.data.claims.session_id === "string"
      ? claimsResult.data.claims.session_id
      : null;
  const { error } = await supabase.auth.signOut({ scope: "others" });
  if (error) return { ok: false, message: "Couldn't log out the other sessions." };
  if (currentSessionId) {
    await createSupabaseAdminClient()
      .from("account_sessions")
      .delete()
      .eq("user_id", user.id)
      .neq("session_id", currentSessionId);
  }
  return { ok: true, message: "Other sessions logged out." };
}

const smartNotificationPreferencesSchema = z.object({
  categories: z.record(z.string(), z.enum(["all", "close_friends", "in_app_only", "off"])),
  quietHoursEnabled: z.boolean(),
  birthdayAnnouncementsEnabled: z.boolean(),
  quietHoursStartMinute: z.number().int().min(0).max(1439),
  quietHoursEndMinute: z.number().int().min(0).max(1439)
});

/**
 * Persists Smart Notification preferences (feature spec batch 4). Stored inside
 * the existing user_preferences.notification_preferences JSON so no migration is
 * needed; the prior blob (e.g. nearbyAlerts) is preserved by reading first.
 */
export async function updateSmartNotificationPreferencesAction(
  input: unknown
): Promise<SettingsActionState> {
  const parsed = smartNotificationPreferencesSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Check your notification settings and try again." };

  const { normalizePreferences } = await import("@/lib/notifications/preferences");
  const normalized = normalizePreferences(parsed.data);

  const user = await getAuthedUser();
  if (!user) return { ok: false, message: "Log in before changing notification settings." };

  const admin = createSupabaseAdminClient();
  const { data: existing } = await admin
    .from("user_preferences")
    .select("notification_preferences")
    .eq("user_id", user.id)
    .maybeSingle();

  const prior =
    existing?.notification_preferences && typeof existing.notification_preferences === "object"
      ? (existing.notification_preferences as Record<string, unknown>)
      : {};

  const { error } = await admin.from("user_preferences").upsert(
    {
      user_id: user.id,
      notification_preferences: {
        ...prior,
        smart: normalized,
        updatedAt: new Date().toISOString()
      }
    },
    { onConflict: "user_id" }
  );

  if (error) return { ok: false, message: "The notification settings could not be saved." };
  return { ok: true, message: "Notification settings saved." };
}
