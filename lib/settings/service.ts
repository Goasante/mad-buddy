import "server-only";

import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import type { Database } from "@/lib/supabase/database.types";

/**
 * Transport-agnostic core settings service. Takes an already-authenticated
 * `userId`; shared by the web Server Actions and the mobile `/api/settings/*`
 * routes. Visibility runs through the caller's RLS-scoped client (cookie for
 * web, bearer for mobile); notification prefs use the service-role client.
 */

export type ServiceResult = { ok: boolean; message: string };

export const visibilitySchema = z.enum(["visible", "ghost", "app_open_only"]);

// Additive: the Pulse quick-settings popover persists three toggles. Any subset
// may be sent; only the provided keys are written into the preferences JSON.
export const notificationPreferenceSchema = z
  .object({
    nearbyAlerts: z.boolean().optional(),
    quietNearby: z.boolean().optional(),
    planAlerts: z.boolean().optional()
  })
  .refine((data) => Object.keys(data).length > 0, { message: "Choose a setting to update." });

export async function updateVisibilityStatus(
  rlsClient: SupabaseClient<Database>,
  userId: string,
  input: unknown
): Promise<ServiceResult> {
  const parsed = visibilitySchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: "Choose a valid visibility setting." };
  }

  const { error } = await rlsClient
    .from("profiles")
    .update({ visibility_status: parsed.data })
    .eq("user_id", userId);

  if (error) {
    return { ok: false, message: "The visibility setting could not be saved." };
  }

  return { ok: true, message: "Visibility setting saved." };
}

/**
 * Save the smart-notification preferences (per-category settings + quiet hours)
 * into `user_preferences.notification_preferences.smart`. Shared with
 * updateSmartNotificationPreferencesAction; the input is normalized so a partial
 * or legacy blob is merged onto the defaults.
 */
export async function saveSmartNotificationPreferences(userId: string, input: unknown): Promise<ServiceResult> {
  const { normalizePreferences } = await import("@/lib/notifications/preferences");
  const normalized = normalizePreferences(input);

  const admin = createSupabaseAdminClient();
  const { data: existing } = await admin
    .from("user_preferences")
    .select("notification_preferences")
    .eq("user_id", userId)
    .maybeSingle();
  const prior =
    existing?.notification_preferences &&
    typeof existing.notification_preferences === "object" &&
    !Array.isArray(existing.notification_preferences)
      ? existing.notification_preferences
      : {};

  const { error } = await admin.from("user_preferences").upsert(
    {
      user_id: userId,
      notification_preferences: { ...prior, smart: normalized, updatedAt: new Date().toISOString() }
    },
    { onConflict: "user_id" }
  );

  if (error) return { ok: false, message: "The notification settings could not be saved." };
  return { ok: true, message: "Notification settings saved." };
}

export async function updateNotificationPreference(
  userId: string,
  input: unknown
): Promise<ServiceResult> {
  const parsed = notificationPreferenceSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: "Choose a valid notification setting." };
  }

  const admin = createSupabaseAdminClient();
  const { data: existing } = await admin
    .from("user_preferences")
    .select("notification_preferences")
    .eq("user_id", userId)
    .maybeSingle();
  const prior =
    existing?.notification_preferences &&
    typeof existing.notification_preferences === "object" &&
    !Array.isArray(existing.notification_preferences)
      ? existing.notification_preferences
      : {};
  const updates: Record<string, boolean> = {};
  if (parsed.data.nearbyAlerts !== undefined) updates.nearbyAlerts = parsed.data.nearbyAlerts;
  if (parsed.data.quietNearby !== undefined) updates.quietNearby = parsed.data.quietNearby;
  if (parsed.data.planAlerts !== undefined) updates.planAlerts = parsed.data.planAlerts;

  const { error } = await admin.from("user_preferences").upsert(
    {
      user_id: userId,
      notification_preferences: {
        ...prior,
        ...updates,
        updatedAt: new Date().toISOString()
      }
    },
    { onConflict: "user_id" }
  );

  if (error) {
    return { ok: false, message: "The notification preference could not be saved." };
  }

  return { ok: true, message: "Notification preference saved." };
}
