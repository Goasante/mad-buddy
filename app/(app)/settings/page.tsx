import { SettingsPageContent } from "@/components/settings/settings-page";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { Json, VisibilityStatus } from "@/lib/supabase/database.types";

function nearbyAlertsFromPreferences(value: Json | undefined) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return true;
  }

  const nearbyAlerts = value.nearbyAlerts;
  return typeof nearbyAlerts === "boolean" ? nearbyAlerts : true;
}

export default async function SettingsPage() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) {
    return <SettingsPageContent />;
  }

  const [profileResult, preferencesResult] = await Promise.all([
    supabase.from("profiles").select("visibility_status").eq("user_id", user.id).maybeSingle(),
    supabase.from("user_preferences").select("notification_preferences").eq("user_id", user.id).maybeSingle()
  ]);

  return (
    <SettingsPageContent
      initialVisibilityStatus={(profileResult.data?.visibility_status ?? "visible") as VisibilityStatus}
      initialNearbyAlerts={nearbyAlertsFromPreferences(preferencesResult.data?.notification_preferences)}
    />
  );
}
