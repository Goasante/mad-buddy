"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getSupabaseBrowserEnv, getSupabaseServerEnv } from "@/lib/supabase/env";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export type SettingsActionState = {
  ok: boolean;
  message: string;
};

const deleteAccountSchema = z.object({
  confirmed: z.literal(true),
  reason: z.string().trim().max(240).optional()
});

const visibilitySchema = z.enum(["visible", "ghost", "app_open_only"]);

const notificationPreferenceSchema = z.object({
  nearbyAlerts: z.boolean()
});

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

async function removeAvatarFolder(userId: string) {
  const admin = createSupabaseAdminClient();
  const { data } = await admin.storage.from("avatars").list(userId);
  const files = data?.map((file) => `${userId}/${file.name}`) ?? [];

  if (files.length > 0) {
    await admin.storage.from("avatars").remove(files);
  }
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

  await admin.rpc("prepare_deleted_user_reports", { target_user_id: userId });
  await removeAvatarFolder(userId);

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
    return { ok: false, message: failedDeletion.error.message };
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
    return { ok: false, message: auditError.message };
  }

  const { error: authDeleteError } = await admin.auth.admin.deleteUser(userId);

  if (authDeleteError) {
    return { ok: false, message: authDeleteError.message };
  }

  redirect("/signup");
}

export async function updateVisibilityStatusAction(input: unknown): Promise<SettingsActionState> {
  const parsed = visibilitySchema.safeParse(input);

  if (!parsed.success) {
    return { ok: false, message: "Choose a valid visibility setting." };
  }

  const user = await getAuthedUser();

  if (!user) {
    return { ok: false, message: "Log in before changing privacy settings." };
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from("profiles")
    .update({ visibility_status: parsed.data })
    .eq("user_id", user.id);

  if (error) {
    return { ok: false, message: error.message };
  }

  return { ok: true, message: "Visibility setting saved." };
}

export async function updateNotificationPreferenceAction(input: unknown): Promise<SettingsActionState> {
  const parsed = notificationPreferenceSchema.safeParse(input);

  if (!parsed.success) {
    return { ok: false, message: "Choose a valid notification setting." };
  }

  const user = await getAuthedUser();

  if (!user) {
    return { ok: false, message: "Log in before changing notification settings." };
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.from("user_preferences").upsert({
    user_id: user.id,
    notification_preferences: {
      nearbyAlerts: parsed.data.nearbyAlerts,
      updatedAt: new Date().toISOString()
    }
  });

  if (error) {
    return { ok: false, message: error.message };
  }

  return { ok: true, message: "Notification preference saved." };
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

  if (error) return { ok: false, message: error.message };
  return { ok: true, message: "Notification settings saved." };
}
