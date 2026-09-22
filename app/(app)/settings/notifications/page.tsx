import { EmailPreferencesCard } from "@/components/settings/email-preferences-card";
import { NotificationPreferencesPage } from "@/components/settings/notification-preferences-page";
import { PushToggle } from "@/components/settings/push-toggle";
import { emailPreferencesFromNotificationBlob } from "@/lib/email/preferences";
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
  let notificationBlob: unknown = null;
  if (user && env.url && env.serviceRoleKey) {
    const admin = createSupabaseAdminClient();
    const { data } = await admin
      .from("user_preferences")
      .select("notification_preferences")
      .eq("user_id", user.id)
      .maybeSingle();
    notificationBlob = data?.notification_preferences ?? null;
    const blob = notificationBlob;
    if (blob && typeof blob === "object" && "smart" in blob) {
      stored = (blob as { smart: unknown }).smart;
    }
  }

  return (
    <div className="space-y-4">
      <NotificationPreferencesPage initialPreferences={normalizePreferences(stored)} />
      <div className="mr-auto max-w-[640px] space-y-4">
        <EmailPreferencesCard initialPreferences={emailPreferencesFromNotificationBlob(notificationBlob)} />
        <PushToggle />
      </div>
    </div>
  );
}
