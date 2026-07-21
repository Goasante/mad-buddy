"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
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

async function removeAvatarFolder(userId: string): Promise<string | null> {
  const admin = createSupabaseAdminClient();
  const { data, error: listError } = await admin.storage.from("avatars").list(userId);
  if (listError) return listError.message;

  const files = data?.map((file) => `${userId}/${file.name}`) ?? [];

  if (files.length > 0) {
    const { error: removeError } = await admin.storage.from("avatars").remove(files);
    if (removeError) return removeError.message;
  }

  return null;
}

async function removePrivateMedia(userId: string): Promise<string | null> {
  const admin = createSupabaseAdminClient();
  const { data: assets, error: assetError } = await admin
    .from("media_assets")
    .select("id, storage_key")
    .eq("owner_id", userId);

  if (assetError) return assetError.message;
  if (!assets || assets.length === 0) return null;

  const assetIds = assets.map((asset) => asset.id);
  const { data: variants, error: variantError } = await admin
    .from("media_variants")
    .select("storage_key")
    .in("media_asset_id", assetIds);

  if (variantError) return variantError.message;

  const keys = [
    ...assets.map((asset) => asset.storage_key),
    ...(variants ?? []).map((variant) => variant.storage_key)
  ];

  for (let index = 0; index < keys.length; index += 100) {
    const { error: removeError } = await admin.storage
      .from("media")
      .remove(keys.slice(index, index + 100));
    if (removeError) return removeError.message;
  }

  return null;
}

export async function deleteAccountAction(input: unknown): Promise<SettingsActionState> {
  const missingEnv = missingSupabaseState();

  if (missingEnv) {
    return missingEnv;
  }

  const parsed = deleteAccountSchema.safeParse(input);

  if (!parsed.success) {
    return { ok: false, message: "Confirm deletion before deleting your account." };
  }

  const user = await getAuthedUser();

  if (!user) {
    return { ok: false, message: "Log in before deleting your account." };
  }

  const rateLimit = await consumeRateLimit({ action: "account.delete", userId: user.id });
  if (!rateLimit.allowed) return { ok: false, message: rateLimitMessage(rateLimit.resetAt) };

  const admin = createSupabaseAdminClient();
  const userId = user.id;
  const { data: profile } = await admin
    .from("profiles")
    .select("full_name, username")
    .eq("user_id", userId)
    .maybeSingle();
  const { data: subscription } = await admin
    .from("subscriptions")
    .select("provider, stripe_customer_id, stripe_subscription_id, paystack_customer_code, paystack_subscription_code, plan, status")
    .eq("user_id", userId)
    .maybeSingle();

  const { error: reportPreparationError } = await admin.rpc("prepare_deleted_user_reports", {
    target_user_id: userId
  });
  if (reportPreparationError) {
    return { ok: false, message: "Your account could not be prepared for deletion." };
  }

  const [avatarRemovalError, mediaRemovalError] = await Promise.all([
    removeAvatarFolder(userId),
    removePrivateMedia(userId)
  ]);
  const storageRemovalError = avatarRemovalError ?? mediaRemovalError;
  if (storageRemovalError) {
    return { ok: false, message: "Your stored media could not be removed." };
  }

  const deletions = await Promise.all([
    admin.from("proximity_events").delete().or(`user_id.eq.${userId},friend_id.eq.${userId}`),
    admin.from("notifications").delete().eq("user_id", userId),
    admin.from("meetup_requests").delete().or(`sender_id.eq.${userId},receiver_id.eq.${userId}`),
    admin.from("best_buddies").delete().or(`user_id.eq.${userId},friend_id.eq.${userId}`),
    admin.from("event_modes").delete().eq("user_id", userId),
    admin.from("circle_members").delete().eq("friend_id", userId),
    admin.from("friend_circles").delete().eq("user_id", userId),
    admin.from("privacy_zones").delete().eq("user_id", userId),
    admin.from("user_preferences").delete().eq("user_id", userId),
    admin.from("user_locations").delete().eq("user_id", userId),
    admin.from("blocked_users").delete().or(`blocker_id.eq.${userId},blocked_id.eq.${userId}`),
    admin.from("friend_requests").delete().or(`sender_id.eq.${userId},receiver_id.eq.${userId}`),
    admin.from("friendships").delete().or(`user_one_id.eq.${userId},user_two_id.eq.${userId}`),
    admin.from("subscriptions").delete().eq("user_id", userId),
    admin.from("consent_logs").delete().eq("user_id", userId),
    admin.from("profiles").delete().eq("user_id", userId)
  ]);

  const failedDeletion = deletions.find((result) => result.error);

  if (failedDeletion?.error) {
    return { ok: false, message: "Your account data could not be removed." };
  }

  const billingReference = subscription
    ? JSON.stringify({
        stripeCustomerId: subscription.stripe_customer_id,
        stripeSubscriptionId: subscription.stripe_subscription_id,
        provider: subscription.provider,
        paystackCustomerCode: subscription.paystack_customer_code,
        paystackSubscriptionCode: subscription.paystack_subscription_code,
        plan: subscription.plan,
        status: subscription.status
      })
    : null;

  const deletedUserLabel = profile?.username
    ? `Deleted User (@${profile.username})`
    : profile?.full_name
      ? `Deleted User (${profile.full_name})`
      : "Deleted User";

  const { error: auditError } = await admin.from("deletion_audit_logs").insert({
    user_id: userId,
    deleted_user_label: deletedUserLabel,
    deletion_reason: parsed.data.reason || null,
    retained_billing_reference: billingReference,
    retained_report_reference: "reports anonymized with prepare_deleted_user_reports"
  });

  if (auditError) {
    return { ok: false, message: "The deletion audit record could not be saved." };
  }

  const { error: authDeleteError } = await admin.auth.admin.deleteUser(userId);

  if (authDeleteError) {
    return { ok: false, message: "Your sign-in account could not be removed." };
  }

  redirect("/signup");
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
  const { error } = await supabase.auth.signOut({ scope: "others" });
  return error ? { ok: false, message: "Couldn't log out the other sessions." } : { ok: true, message: "Other sessions logged out." };
}

const smartNotificationPreferencesSchema = z.object({
  categories: z.record(z.string(), z.enum(["all", "close_friends", "in_app_only", "off"])),
  quietHoursEnabled: z.boolean(),
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
