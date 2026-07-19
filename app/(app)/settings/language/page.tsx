import { LanguageRegionPage } from "@/components/settings/language-region-page";
import { normalizeAppPreferences } from "@/lib/settings/app-preferences";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function SettingsLanguagePage() {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  const { data } = user
    ? await supabase.from("user_preferences").select("app_preferences").eq("user_id", user.id).maybeSingle()
    : { data: null };
  return <LanguageRegionPage initialPreferences={normalizeAppPreferences(data?.app_preferences)} />;
}
