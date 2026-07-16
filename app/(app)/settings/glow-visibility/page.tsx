import { GlowVisibilityPage } from "@/components/settings/glow-visibility-page";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { VisibilityStatus } from "@/lib/supabase/database.types";

export default async function SettingsGlowVisibilityPage() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  const { data: profile } = user
    ? await supabase.from("profiles").select("visibility_status").eq("user_id", user.id).maybeSingle()
    : { data: null };

  return <GlowVisibilityPage initialVisibilityStatus={(profile?.visibility_status ?? "visible") as VisibilityStatus} />;
}
