"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { normalizeEmailCommunicationPreferences } from "@/lib/email/preferences";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export type EmailPreferenceActionState = { ok: boolean; message: string };

const emailPreferencesSchema = z.object({
  productUpdates: z.boolean(),
  featureLaunches: z.boolean(),
  communityReminders: z.boolean()
});

export async function updateEmailCommunicationPreferencesAction(
  input: unknown
): Promise<EmailPreferenceActionState> {
  const parsed = emailPreferencesSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Check your email preferences and try again." };

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
    error: authError
  } = await supabase.auth.getUser();
  if (authError || !user) return { ok: false, message: "Log in before changing email preferences." };

  const admin = createSupabaseAdminClient();
  const { data: existing, error: readError } = await admin
    .from("user_preferences")
    .select("notification_preferences")
    .eq("user_id", user.id)
    .maybeSingle();
  if (readError) return { ok: false, message: "Your current email preferences could not be loaded." };

  const prior =
    existing?.notification_preferences && typeof existing.notification_preferences === "object" && !Array.isArray(existing.notification_preferences)
      ? (existing.notification_preferences as Record<string, unknown>)
      : {};

  const email = normalizeEmailCommunicationPreferences(parsed.data);
  const { error } = await admin.from("user_preferences").upsert(
    {
      user_id: user.id,
      notification_preferences: {
        ...prior,
        email,
        updatedAt: new Date().toISOString()
      }
    },
    { onConflict: "user_id" }
  );

  if (error) return { ok: false, message: "Your email preferences could not be saved." };
  revalidatePath("/settings/notifications");
  return { ok: true, message: "Email preferences saved." };
}
