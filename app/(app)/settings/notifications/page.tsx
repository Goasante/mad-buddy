import { NotificationPreferencesPage } from "@/components/settings/notification-preferences-page";
import { normalizePreferences } from "@/lib/notifications/preferences";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getSupabaseServerEnv } from "@/lib/supabase/env";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function SettingsNotificationsPage() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  const env = getSupabaseServerEnv();
  let stored: unknown = null;
  if (user && env.url && env.serviceRoleKey) {
    const admin = createSupabaseAdminClient();
    const { data } = await admin
      .from("user_preferences")
      .select("notification_preferences")
      .eq("user_id", user.id)
      .maybeSingle();
    const blob = data?.notification_preferences;
    if (blob && typeof blob === "object" && "smart" in blob) {
      stored = (blob as { smart: unknown }).smart;
    }
  }

  return <NotificationPreferencesPage initialPreferences={normalizePreferences(stored)} />;
}
