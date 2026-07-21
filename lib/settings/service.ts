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

export const notificationPreferenceSchema = z.object({
  nearbyAlerts: z.boolean()
});

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
  const { error } = await admin.from("user_preferences").upsert(
    {
      user_id: userId,
      notification_preferences: {
        ...prior,
        nearbyAlerts: parsed.data.nearbyAlerts,
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
